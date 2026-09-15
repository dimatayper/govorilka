# SPDX-License-Identifier: AGPL-3.0-or-later
"""Delay-aligned, full-recording diagnostics, not a perceptual quality/parity gate.
Requires numpy. Input: mono 48 kHz PCM16 or float32 WAV.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import numpy as np


def read_wav(path):
    raw = Path(path).read_bytes()
    if raw[:4] != b'RIFF' or raw[8:12] != b'WAVE':
        raise ValueError('Expected RIFF WAV')
    offset, fmt, data = 12, None, None
    while offset + 8 <= len(raw):
        kind, size = struct.unpack_from('<4sI', raw, offset)
        start = offset + 8
        if start + size > len(raw):
            raise ValueError('Truncated WAV')
        if kind == b'fmt ':
            fmt = struct.unpack_from('<HHIIHH', raw, start)
        if kind == b'data':
            data = raw[start:start + size]
        offset = start + size + size % 2
    if fmt is None or data is None or fmt[1] != 1 or fmt[2] != 48000:
        raise ValueError('Expected mono 48 kHz WAV')
    if fmt[0] == 1 and fmt[5] == 16:
        values = np.frombuffer(data, dtype='<i2').astype(np.float64) / 32768
    elif fmt[0] == 3 and fmt[5] == 32:
        values = np.frombuffer(data, dtype='<f4').astype(np.float64)
    else:
        raise ValueError('Expected PCM16 or float32')
    if not len(values) or not np.isfinite(values).all():
        raise ValueError('Empty or non-finite audio')
    return values, hashlib.sha256(raw).hexdigest()


def measure(clean, output, max_delay=24000):
    # Search only non-negative processing delay. FFT correlation is not circular:
    # padding is at least the sum of lengths minus one.
    size = 1 << (len(clean) + len(output) - 2).bit_length()
    correlation = np.fft.irfft(np.fft.rfft(output, size) * np.conj(np.fft.rfft(clean, size)), size)
    limit = min(max_delay, len(output) - len(clean))
    if limit < 0:
        raise ValueError('Output shorter than clean reference; refusing truncated comparison')
    delay = int(np.argmax(np.abs(correlation[:limit + 1])))
    target = clean - np.mean(clean)
    estimate = output[delay:delay + len(clean)].copy()
    estimate -= np.mean(estimate)
    target_energy = np.dot(target, target)
    if target_energy < 1e-12:
        raise ValueError('Reference contains no measurable speech energy')
    gain = np.dot(estimate, target) / target_energy
    projected = gain * target
    residual = estimate - projected
    ratio_db = lambda a, b: float(10 * np.log10(max(float(a), 1e-20) / max(float(b), 1e-20)))
    return {
        'delay_samples': delay, 'delay_ms': delay / 48,
        'alignment_at_search_boundary': bool(delay == limit and limit > 0),
        'si_sdr_db': ratio_db(np.dot(projected, projected), np.dot(residual, residual)),
        'unscaled_sdr_db': ratio_db(target_energy, np.dot(estimate - target, estimate - target)),
        'speech_projection_gain_db': ratio_db(gain * gain, 1),
        'peak': float(np.max(np.abs(output))),
        'samples_above_full_scale': int(np.sum(np.abs(output) > 1)),
        'compared_samples': len(clean),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clean', required=True)
    parser.add_argument('--noisy', required=True)
    parser.add_argument('--output', action='append', required=True, help='Processed WAV; repeat for comparisons')
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    clean, clean_hash = read_wav(args.clean)
    noisy, noisy_hash = read_wav(args.noisy)
    if len(clean) != len(noisy):
        raise ValueError('Clean and noisy input must have identical lengths')
    baseline = measure(clean, noisy)
    result = {'scope': 'Full-recording intrusive diagnostics; no Krisp parity claim; no perceptual score',
              'clean_sha256': clean_hash, 'noisy_sha256': noisy_hash, 'baseline': baseline, 'outputs': []}
    for path in args.output:
        output, output_hash = read_wav(path)
        metrics = measure(clean, output)
        metrics['si_sdr_improvement_db'] = metrics['si_sdr_db'] - baseline['si_sdr_db']
        result['outputs'].append({'path': path, 'sha256': output_hash, **metrics})
    Path(args.report).write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
