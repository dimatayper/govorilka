# SPDX-License-Identifier: AGPL-3.0-or-later
"""Build a local blinded listening comparison from official Krisp demos and Egorp renders.
The label key is saved outside the public directory; no audio upload or normalization.
"""
import argparse
import hashlib
import json
from pathlib import Path
import secrets
import soundfile as sf
from evaluate_egorp import read_wav, measure


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--key', type=Path, required=True)
    args = parser.parse_args()
    if args.key.resolve().is_relative_to(args.output.resolve()):
        raise ValueError('Keep the label key outside the public comparison directory')
    args.output.mkdir(parents=True, exist_ok=True)
    entries, key = [], []
    labels = {'keyboard': 'Клавиатура', 'fan': 'Вентилятор', 'dog': 'Лай собаки', 'bgvoice': 'Фоновые голоса'}
    for sample, title in labels.items():
        reference, _ = read_wav(args.directory / f'{sample}-after.wav')
        records = []
        for engine in ['after', 'dpdfnet2_48khz_hr']:
            source = args.directory / f'{sample}-{engine}.wav'
            audio, digest = read_wav(source)
            delay = measure(reference, audio)['delay_samples']
            records.append({'engine': engine, 'audio': audio[delay:delay+len(reference)], 'delay': delay, 'sha256': digest})
        secrets.SystemRandom().shuffle(records)
        length = min(len(row['audio']) for row in records)
        entry = {'id': secrets.token_hex(8), 'title': title, 'files': []}
        for index, row in enumerate(records):
            filename = f'{entry["id"]}-{index}.wav'
            target = args.output / filename
            sf.write(target, row['audio'][:length], 48000, subtype='FLOAT')
            entry['files'].append(filename)
            key.append({'id': entry['id'], 'label': 'AB'[index], 'engine': row['engine'],
                        'input_sha256': row['sha256'], 'alignment_samples': row['delay'],
                        'output_sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
        entries.append(entry)
    template = Path(__file__).with_name('EgorpListeningTemplate.html').read_text()
    (args.output / 'index.html').write_text(template.replace('__ENTRIES__', json.dumps(entries, ensure_ascii=False)))
    args.key.write_text(json.dumps({'scope':'Four curated public Krisp demos versus the DPDFNet2 model; not a blinded population study or a full browser capture comparison', 'source':'https://krisp.ai/noise-cancellation/', 'gain_normalization':False, 'key':key},indent=2)+'\n')
    print(args.output / 'index.html')


if __name__ == '__main__':
    main()
