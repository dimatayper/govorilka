// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect, it, vi} from 'vitest';
import {DpdfStreamingCore} from './DpdfStreamingCore';

it('reconstructs speech with identity inference after the overlap warmup', async () => {
	const core = new DpdfStreamingCore(async (spectrum) => spectrum);
	const input = Float32Array.from({length: 480 * 10}, (_, i) => (i < 480 ? 0 : Math.sin(i * 0.07) * 0.2));
	const output = new Float32Array(input.length + 480);
	for (let offset = 0; offset < output.length; offset += 480) {
		const hop = new Float32Array(480);
		hop.set(input.subarray(offset, offset + 480));
		output.set(await core.processHop(hop), offset);
	}
	for (let i = 0; i < input.length; i++) expect(output[i + 480]).toBeCloseTo(input[i], 6);
});
it('rejects concurrent calls and reset during inference', async () => {
	let complete!: (spectrum: Float32Array) => void;
	const core = new DpdfStreamingCore(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	await core.processHop(new Float32Array(480));
	const pending = core.processHop(new Float32Array(480));
	await expect(core.processHop(new Float32Array(480))).rejects.toThrow('Concurrent');
	expect(() => core.reset()).toThrow('during inference');
	complete(new Float32Array(962));
	await pending;
	core.reset();
});
it('requires a fresh state after model failure', async () => {
	const infer = vi.fn(async () => new Float32Array(962).fill(NaN));
	const reset = vi.fn();
	const core = new DpdfStreamingCore(infer, reset);
	await core.processHop(new Float32Array(480));
	await expect(core.processHop(new Float32Array(480))).rejects.toThrow('Non-finite');
	await expect(core.processHop(new Float32Array(480))).rejects.toThrow('reset');
	core.reset();
	expect(reset).toHaveBeenCalledTimes(1);
	expect(await core.processHop(new Float32Array(480))).toEqual(new Float32Array(480));
});
