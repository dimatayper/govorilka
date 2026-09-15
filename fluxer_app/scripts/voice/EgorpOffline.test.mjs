// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {createProcessor, encodeWav, loadWorkletCode, readWav, render} from './EgorpOffline.mjs';

const owned = `${readFileSync(new URL('../../src/features/voice/worklets/EgorpProcessor.js', import.meta.url), 'utf8').replace('export function', 'function')}\nregisterProcessor('test', createEgorpProcessor({AudioWorkletProcessor, sampleRate, initSync, df_create, df_get_frame_length, df_set_atten_lim, df_process_frame}));`;
function fake(overrides = {}) {
	return createProcessor(
		owned,
		{
			initSync() {},
			df_create: () => 1,
			df_get_frame_length: () => 480,
			df_process_frame: (_, frame) => new Float32Array(frame),
			df_set_atten_lim() {},
			...overrides,
		},
		{modelBytes: new Uint8Array()},
	);
}
for (const quantum of [64, 128, 192, 256, 480, 512, 1024]) {
	test(`preserves every sample across ${quantum}-sample quanta with a fixed delay`, () => {
		const {processor, messages} = fake();
		assert.equal(messages[0].type, 'ready');
		const input = Float32Array.from({length: 48000}, (_, i) => Math.sin(i * 0.19) * 0.2);
		const {output} = render(processor, input, quantum, 480);
		assert.deepEqual(output.subarray(0, 480), new Float32Array(480));
		assert.deepEqual(output.subarray(480), input);
	});
}
test('initialization failure is explicit and never leaks unfiltered speech', () => {
	const {processor, messages} = fake({
		df_create() {
			throw new Error('bad model');
		},
	});
	assert.equal(messages[0].type, 'error');
	const {output} = render(processor, new Float32Array(1024).fill(0.5), 128, 0);
	assert.ok(output.every((value) => value === 0));
});
test('runtime model failure and non-finite output are reported once', () => {
	const {processor, messages} = fake({df_process_frame: () => new Float32Array(480).fill(NaN)});
	const {output} = render(processor, new Float32Array(1024).fill(0.5), 128, 0);
	assert.equal(messages.filter((message) => message.type === 'error').length, 1);
	assert.ok(output.every(Number.isFinite));
});
test('disconnected input advances the model and does not replay old audio', () => {
	const {processor} = fake();
	processor.process([[new Float32Array(480).fill(0.25)]], [[new Float32Array(480)]]);
	processor.process([], [[new Float32Array(480)]]);
	const output = new Float32Array(480);
	processor.process([[new Float32Array(480)]], [[output]]);
	assert.ok(output.every((sample) => sample === 0));
});
test('patches the actual pinned bundle and preserves WASM glue', () => {
	const code = loadWorkletCode();
	assert.ok(code.includes('function df_process_frame'));
	assert.ok(code.includes('A fixed F-sample delay'));
	assert.ok(!code.includes('outputAvailable >= 128'));
});
test('roundtrips float WAV without clipping', () => {
	const samples = new Float32Array([0, 0.125, -0.25, 1.1]);
	assert.deepEqual(readWav(encodeWav(samples)), samples);
	assert.throws(() => readWav(encodeWav(samples).subarray(0, 45)), /Truncated/);
});
