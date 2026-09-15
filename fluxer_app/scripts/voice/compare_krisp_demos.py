# SPDX-License-Identifier: AGPL-3.0-or-later
"""Compare local Egorp renders with PUBLIC PROCESSED DEMOS, not clean speech.
The after file defines quiet 10 ms windows (< -50 dBFS). Lower output energy in
these windows alone does not imply higher speech quality or speaker isolation.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from evaluate_egorp import read_wav, measure


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--names', nargs='+', default=['keyboard', 'fan', 'dog', 'bgvoice'])
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    results = []
    for name in args.names:
        stem = Path(args.directory) / name
        noisy, nh = read_wav(f'{stem}-before.wav')
        ref, rh = read_wav(f'{stem}-after.wav')
        out, oh = read_wav(f'{stem}-egorp.wav')
        if len(noisy) != len(ref):
            raise ValueError(f'{name}: source and reference lengths differ')
        metrics = measure(ref, out)
        delay = metrics['delay_samples']
        aligned = out[delay:delay + len(ref)]
        n = len(ref) // 480
        rms = lambda x: np.sqrt(np.mean(x[:n * 480].reshape(n, 480) ** 2, axis=1))
        rr, er, nr = rms(ref), rms(aligned), rms(noisy)
        quiet = rr < 10 ** (-50 / 20)
        def db(values):
            if not len(values):
                return None
            return float(20 * np.log10(max(float(np.sqrt(np.mean(values * values))), 1e-10)))
        results.append({
            'name': name,
            'reference_type': 'Krisp website processed demo, NOT clean speech; version unknown',
            'duration_seconds': len(ref) / 48000,
            'reference_match_si_sdr_db': metrics['si_sdr_db'],
            'alignment_ms': metrics['delay_ms'],
            'reference_quiet_seconds': int(quiet.sum()) / 100,
            'noisy_in_reference_quiet_dbfs': db(nr[quiet]),
            'egorp_in_reference_quiet_dbfs': db(er[quiet]),
            'krisp_in_reference_quiet_dbfs': db(rr[quiet]),
            'hashes': {'noisy': nh, 'reference': rh, 'egorp': oh},
        })
    Path(args.report).write_text(json.dumps(results, indent=2, allow_nan=False) + '\n')
    print(json.dumps(results, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
