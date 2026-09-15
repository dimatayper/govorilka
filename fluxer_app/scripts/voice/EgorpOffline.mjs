// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs the actual bundled worklet + WASM in a Node VM. This measures model/DSP,
// not browser scheduling, microphone capture, echo cancellation or the compressor.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
export function readWav(bytes) {
	if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
		throw new Error('Expected RIFF WAV');
	let format;
	let data;
	for (let offset = 12; offset + 8 <= bytes.length; ) {
		const kind = bytes.toString('ascii', offset, offset + 4);
		const size = bytes.readUInt32LE(offset + 4);
		const start = offset + 8;
		if (start + size > bytes.length) throw new Error('Truncated WAV chunk');
		if (kind === 'fmt ') {
			if (size < 16) throw new Error('Invalid WAV format');
			format = {
				encoding: bytes.readUInt16LE(start),
				channels: bytes.readUInt16LE(start + 2),
				sampleRate: bytes.readUInt32LE(start + 4),
				bits: bytes.readUInt16LE(start + 14),
			};
		}
		if (kind === 'data') data = bytes.subarray(start, start + size);
		offset = start + size + (size % 2);
	}
	if (!format || !data || format.channels !== 1 || format.sampleRate !== 48000)
		throw new Error('Expected mono 48000 Hz WAV');
	if (!((format.encoding === 1 && format.bits === 16) || (format.encoding === 3 && format.bits === 32)))
		throw new Error('Expected PCM16 or float32 WAV');
	const width = format.bits / 8;
	if (data.length % width) throw new Error('Incomplete WAV sample');
	const samples = new Float32Array(data.length / width);
	for (let i = 0; i < samples.length; i++) {
		samples[i] = width === 2 ? data.readInt16LE(i * width) / 32768 : data.readFloatLE(i * width);
		if (!Number.isFinite(samples[i])) throw new Error('Non-finite input sample');
	}
	return samples;
}
export function encodeWav(samples) {
	// Float WAV avoids clipping/quantizing the benchmark output before evaluation.
	const bytes = Buffer.alloc(44 + samples.length * 4);
	bytes.write('RIFF');
	bytes.writeUInt32LE(bytes.length - 8, 4);
	bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(3, 20);
	bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(48000, 24);
	bytes.writeUInt32LE(192000, 28);
	bytes.writeUInt16LE(4, 32);
	bytes.writeUInt16LE(32, 34);
	bytes.write('data', 36);
	bytes.writeUInt32LE(samples.length * 4, 40);
	for (let i = 0; i < samples.length; i++) bytes.writeFloatLE(samples[i], 44 + i * 4);
	return bytes;
}
export function loadWorkletCode(upstream = false) {
	const modulePath = path.join(appRoot, 'node_modules/deepfilternet3-noise-filter/dist/index.esm.js');
	let source = readFileSync(modulePath, 'utf8');
	if (!upstream) source = require('../build/rspack/egorp-worklet-loader.cjs').call({}, source);
	return JSON.parse(source.match(/^var workletCode = (".*");$/m)[1]);
}
export function createProcessor(code, globals, options) {
	let Processor;
	const messages = [];
	class AudioWorkletProcessor {
		port = {postMessage: (data) => messages.push(data), close() {}, onmessage: null};
	}
	vm.runInNewContext(code, {
		AudioWorkletProcessor,
		sampleRate: 48000,
		console,
		TextDecoder,
		TextEncoder,
		Float32Array,
		Uint8Array,
		WebAssembly,
		registerProcessor: (_, value) => {
			Processor = value;
		},
		...globals,
	});
	const processor = new Processor({processorOptions: options});
	return {processor, messages};
}
export function render(processor, input, quantum = 128, tailSamples = 48000) {
	if (!Number.isInteger(quantum) || quantum < 1 || quantum > 4096) throw new Error('Invalid render quantum');
	const output = new Float32Array(input.length + tailSamples);
	const timings = [];
	const inBlock = new Float32Array(quantum);
	const outBlock = new Float32Array(quantum);
	for (let offset = 0; offset < output.length; offset += quantum) {
		inBlock.fill(0);
		inBlock.set(input.subarray(offset, offset + quantum));
		outBlock.fill(0);
		const start = performance.now();
		processor.process([[inBlock]], [[outBlock]]);
		timings.push(performance.now() - start);
		output.set(outBlock.subarray(0, Math.min(quantum, output.length - offset)), offset);
	}
	const elapsedMs = timings.reduce((sum, value) => sum + value, 0);
	timings.sort((a, b) => a - b);
	return {
		output,
		timing: {
			elapsedMs,
			realTimeFactor: elapsedMs / (output.length / 48),
			quantum,
			quantumBudgetMs: quantum / 48,
			p95Ms: timings[Math.floor(timings.length * 0.95)],
			p99Ms: timings[Math.floor(timings.length * 0.99)],
			maxMs: timings.at(-1),
		},
	};
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function main() {
	const args = process.argv.slice(2);
	const option = (name) => args[args.indexOf(name) + 1];
	for (const name of ['--input', '--output', '--assets']) if (!args.includes(name)) throw new Error(`Missing ${name}`);
	const strength = args.includes('--strength') ? Number(option('--strength')) : 80;
	if (!Number.isFinite(strength) || strength < 0 || strength > 100) throw new Error('Strength must be 0..100');
	const inputBytes = readFileSync(option('--input'));
	const input = readWav(inputBytes);
	if (!input.length) throw new Error('Empty input');
	const wasm = readFileSync(path.join(option('--assets'), 'df_bg.wasm'));
	const model = readFileSync(path.join(option('--assets'), 'DeepFilterNet3_onnx.tar.gz'));
	const code = loadWorkletCode(args.includes('--upstream'));
	const start = performance.now();
	const {processor, messages} = createProcessor(
		code,
		{},
		{
			wasmModule: await WebAssembly.compile(wasm),
			modelBytes: model,
			suppressionLevel: strength,
		},
	);
	const startupMs = performance.now() - start;
	if (messages.some((message) => message.type === 'error')) throw new Error(JSON.stringify(messages));
	if (!args.includes('--upstream') && !messages.some((message) => message.type === 'ready'))
		throw new Error('Model never became ready');
	const {output, timing} = render(processor, input, args.includes('--quantum') ? Number(option('--quantum')) : 128);
	if (messages.some((message) => message.type === 'error')) throw new Error(JSON.stringify(messages));
	writeFileSync(option('--output'), encodeWav(output));
	const report = {
		engine: args.includes('--upstream') ? 'upstream-1.2.1' : 'Egorp',
		strength,
		inputSamples: input.length,
		outputSamples: output.length,
		tailSamples: 48000,
		sampleRate: 48000,
		startupMs,
		timing,
		messages,
		hashes: {input: sha256(inputBytes), wasm: sha256(wasm), model: sha256(model), worklet: sha256(code)},
		node: process.version,
		platform: process.platform,
		architecture: process.arch,
	};
	writeFileSync(`${option('--output')}.json`, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
