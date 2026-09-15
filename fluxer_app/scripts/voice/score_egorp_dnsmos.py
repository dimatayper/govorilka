# SPDX-License-Identifier: AGPL-3.0-or-later
"""Local DNSMOS P.835 / pDNSMOS scoring of aligned public Krisp demo renders.
Uses Microsoft's model, windowing and published polynomial calibration:
https://github.com/microsoft/DNS-Challenge/blob/master/DNSMOS/dnsmos_local.py
No audio upload, no loudness normalization. Predicted MOS is NOT a listening test.
"""
import argparse
import hashlib
import json
from pathlib import Path

import librosa
import numpy as np
import onnxruntime as ort
from evaluate_egorp import measure, read_wav

ort.disable_telemetry_events()
RATE = 16000
LENGTH = 9.01


class Dnsmos:
    def __init__(self, model, personalized=False, fixed_windowing=False):
        self.fixed_windowing = fixed_windowing
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(model), sess_options=options, providers=['CPUExecutionProvider'])
        self.sha256 = hashlib.sha256(Path(model).read_bytes()).hexdigest()
        # Order: speech quality, background quality, overall quality.
        self.calibration = (
            [[-0.01019296, 0.02751166, 1.19576786, -0.24348726],
             [-0.04976499, 0.44276479, -0.1644611, 0.96883132],
             [-0.00533021, 0.005101, 1.18058466, -0.11236046]] if personalized else
            [[-0.08397278, 1.22083953, 0.0052439],
             [-0.13166888, 1.60915514, -0.39604546],
             [-0.06766283, 1.11546468, 0.04602535]]
        )

    def __call__(self, audio, sample_rate=48000):
        if not len(audio) or not np.isfinite(audio).all():
            raise ValueError('Empty or non-finite audio')
        audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=RATE)
        original_length = len(audio)
        required = int(LENGTH * RATE)
        while len(audio) < required:
            audio = np.concatenate([audio, audio])
        # Match the upstream implementation, including its final-window convention.
        hops = int(np.floor(len(audio) / RATE) - LENGTH) + 1
        predictions = []
        for index in range(hops):
            # The published script computes the end with floating-point addition,
            # which makes some windows one sample short and skips them. Reproduce
            # this by default; fixed mode includes every complete integer window.
            end = index * RATE + required if self.fixed_windowing else int((index + LENGTH) * RATE)
            segment = audio[index * RATE:end]
            if len(segment) != required:
                continue
            raw = self.session.run(None, {'input_1': segment.astype(np.float32)[None, :]})[0][0]
            predictions.append([float(np.polyval(poly, score)) for poly, score in zip(self.calibration, raw)])
        if not predictions:
            raise ValueError('No DNSMOS windows')
        scores = np.mean(predictions, axis=0)
        return dict(zip(['SIG', 'BAK', 'OVRL'], map(float, scores))) | {
            'windows': len(predictions), 'repeated_short_clip': original_length < required,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fixed-windowing', action='store_true', help='Use integer window ends instead of reproducing the upstream rounding bug')
    parser.add_argument('--names', nargs='+', default=['keyboard', 'fan', 'dog', 'bgvoice'])
    parser.add_argument('--engines', nargs='+', default=['before', 'after', 'egorp', 'dpdfnet2_48khz_hr', 'dpdfnet8_48khz_hr'])
    args = parser.parse_args()
    scorers = {'DNSMOS': Dnsmos(args.models / 'dnsmos_sig_bak_ovr.onnx', fixed_windowing=args.fixed_windowing),
               'pDNSMOS': Dnsmos(args.models / 'pdnsmos_sig_bak_ovr.onnx', personalized=True, fixed_windowing=args.fixed_windowing)}
    result = {'scope': 'Predicted MOS on public demos; NOT proof of Krisp parity or speaker identity',
              'windowing': 'fixed_integer_length' if args.fixed_windowing else 'upstream_float_end',
              'scoring_models': {key: score.sha256 for key, score in scorers.items()}, 'results': []}
    for sample in args.names:
        reference, _ = read_wav(args.directory / f'{sample}-after.wav')
        for engine in args.engines:
            path = args.directory / f'{sample}-{engine}.wav'
            audio, audio_hash = read_wav(path)
            delay = measure(reference, audio)['delay_samples']
            aligned = audio[delay:delay + len(reference)]
            row = {'sample': sample, 'engine': engine, 'sha256': audio_hash,
                   'alignment_samples': delay, 'sample_count': len(aligned)}
            for name, score in scorers.items():
                row[name] = score(aligned)
            result['results'].append(row)
            args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
            print(sample, engine, 'DNSMOS', row['DNSMOS'], 'pDNSMOS', row['pDNSMOS'], flush=True)


if __name__ == '__main__':
    main()
