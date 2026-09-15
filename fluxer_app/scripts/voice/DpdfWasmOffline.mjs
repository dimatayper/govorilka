// SPDX-License-Identifier: AGPL-3.0-or-later
// Node 24+ strips the same TypeScript core used by the browser worker.
import {readFileSync, writeFileSync} from 'node:fs';
import * as ort from '../../node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs';
import {createDpdfOnnxEngine} from '../../src/features/voice/utils/egorp/DpdfOnnxEngine.ts';
import {encodeWav, readWav} from './EgorpOffline.mjs';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
for (const key of ['--input', '--output', '--model']) if (!args.includes(key)) throw new Error(`Missing ${key}`);
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
const input = readWav(readFileSync(option('--input')));
const start = performance.now();
const engine = await createDpdfOnnxEngine(ort, readFileSync(option('--model')));
const startupMs = performance.now() - start;
try {
	const output = new Float32Array(Math.ceil((input.length + 48000) / 480) * 480);
	const block = new Float32Array(480);
	const timings = [];
	for (let offset = 0; offset < output.length; offset += 480) {
		block.fill(0);
		block.set(input.subarray(offset, offset + 480));
		const begin = performance.now();
		output.set(await engine.core.processHop(block), offset);
		timings.push(performance.now() - begin);
	}
	writeFileSync(option('--output'), encodeWav(output));
	const elapsedMs = timings.reduce((sum, time) => sum + time, 0);
	timings.sort((a, b) => a - b);
	const report = {
		startupMs,
		elapsedMs,
		realTimeFactor: elapsedMs / (output.length / 48),
		p99Ms: timings[Math.floor(timings.length * 0.99)],
		maxMs: timings.at(-1),
		runtime: process.version,
	};
	writeFileSync(`${option('--output')}.json`, `${JSON.stringify(report, null, 2)}\n`);
	console.log(report);
} finally {
	await engine.dispose();
}
