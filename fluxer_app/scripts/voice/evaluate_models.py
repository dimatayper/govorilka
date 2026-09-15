# SPDX-License-Identifier: AGPL-3.0-or-later
"""Compare Egorp WASM with pinned DPDFNet candidates on paired 48 kHz WAVs.
Models process noisy AND clean speech to expose over-suppression. This is a small
engineering corpus, not proof of parity with Krisp or a population-wide benchmark.
All inference is local. Dependencies: dpdfnet==0.5.1, pystoi==0.4.1.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import time

import onnxruntime as ort
ort.disable_telemetry_events()
import dpdfnet
import numpy as np
from pystoi import stoi
import soundfile as sf
from evaluate_egorp import measure, read_wav

SR = 48000
HOP = 480


def diagnostics(clean, output):
    result = measure(clean, output)
    offset = result['delay_samples']
    aligned = output[offset:offset + len(clean)]
    result['stoi'] = float(stoi(clean, aligned, SR, extended=False))
    result['estoi'] = float(stoi(clean, aligned, SR, extended=True))
    return result


def stream_render(enhancer, audio):
    enhancer.reset()
    padded = np.pad(audio.astype(np.float32), (0, SR + HOP - len(audio) % HOP))
    output = np.zeros(len(padded), dtype=np.float32)
    times = []
    for start in range(0, len(padded), HOP):
        before = time.perf_counter()
        block = enhancer.process(padded[start:start + HOP], sample_rate=SR)
        times.append(time.perf_counter() - before)
        if len(block) > HOP:
            raise ValueError('Streaming model overproduced; refusing to drop samples')
        output[start:start + len(block)] = block
    if not np.isfinite(output).all():
        raise ValueError('Candidate produced non-finite audio')
    return output, {
        'runtime': 'native ONNX CPU, one inference thread; not comparable to browser scheduling',
        'rtf': sum(times) / (len(padded) / SR), 'p99_ms': float(np.quantile(times, 0.99) * 1000),
        'max_ms': max(times) * 1000, 'hop_ms': 10,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', type=Path, required=True)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--candidates', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--node', default='node')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    pairs = sorted(args.corpus.glob('*_clean.wav'))
    if not pairs:
        raise ValueError('No clean/noisy pairs')
    manifest = {'scope': 'Small public engineering corpus; not Krisp parity',
                'packages': {name: importlib.metadata.version(name) for name in ['dpdfnet', 'onnxruntime', 'pystoi', 'numpy', 'scipy']},
                'platform': platform.platform(), 'models': {}, 'results': []}
    engines = {}
    for name in ['dpdfnet2_48khz_hr', 'dpdfnet8_48khz_hr']:
        model = args.candidates / f'{name}.onnx'
        begin = time.perf_counter()
        # Explicit file prevents any implicit model download.
        engines[name] = dpdfnet.StreamEnhancer(model=name, onnx_path=model)
        manifest['models'][name] = {'sha256': hashlib.sha256(model.read_bytes()).hexdigest(),
                                   'startup_ms': (time.perf_counter() - begin) * 1000}
    def save():
        (args.output / 'report.json').write_text(json.dumps(manifest, indent=2, allow_nan=False) + '\n')
    for clean_path in pairs:
        sample = clean_path.stem.removesuffix('_clean')
        clean, clean_hash = read_wav(clean_path)
        for case in ['noisy', 'clean']:
            input_path = args.corpus / f'{sample}_{case}.wav'
            audio, audio_hash = read_wav(input_path)
            if len(clean) != len(audio):
                raise ValueError(f'Unaligned input pair: {sample}')
            baseline = diagnostics(clean, audio)
            for name in ['egorp', *engines]:
                target = args.output / f'{sample}_{case}_{name}.wav'
                if name == 'egorp':
                    runner = Path(__file__).with_name('EgorpOffline.mjs')
                    subprocess.run([args.node, str(runner), '--input', str(input_path), '--output', str(target),
                                    '--assets', str(args.assets)], check=True, capture_output=True, text=True)
                    output, _ = read_wav(target)
                    timing = json.loads(Path(f'{target}.json').read_text())
                    manifest['models']['egorp'] = timing['hashes'] | {'runtime': 'Node WASM, not browser scheduling'}
                else:
                    output, timing = stream_render(engines[name], audio)
                    sf.write(target, output, SR, subtype='FLOAT')
                scores = diagnostics(clean, output)
                row = {'sample': sample, 'case': case, 'engine': name, 'input_sha256': audio_hash,
                       'clean_sha256': clean_hash, 'scores': scores, 'baseline': baseline, 'timing': timing}
                manifest['results'].append(row)
                save()
                print(f'{sample} {case} {name}: SI-SDR={scores["si_sdr_db"]:.2f} ESTOI={scores["estoi"]:.4f} delay={scores["delay_ms"]:.1f}ms', flush=True)


if __name__ == '__main__':
    main()
