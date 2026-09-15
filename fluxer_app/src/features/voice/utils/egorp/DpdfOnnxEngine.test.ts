// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach, expect, it, vi} from 'vitest';
import {DPDF_MODEL_SHA256, DPDF_STATE_SIZE} from './DpdfModelConfig';
import {createDpdfOnnxEngine, type DpdfOrtModule} from './DpdfOnnxEngine';

class Tensor {
	readonly data: Float32Array;
	dispose = vi.fn();
	constructor(_type: string, data: Float32Array) {
		this.data = data;
	}
}
function runtime() {
	const session = {
		run: vi.fn(async () => ({
			spec_e: new Tensor('float32', new Float32Array(962)),
			state_out: new Tensor('float32', new Float32Array(DPDF_STATE_SIZE)),
		})),
		release: vi.fn(async () => undefined),
	};
	const create = vi.fn(async () => session);
	return {session, create, ort: {Tensor, InferenceSession: {create}} as unknown as DpdfOrtModule};
}
function acceptModelHash() {
	const bytes = Uint8Array.from(DPDF_MODEL_SHA256.match(/../g) ?? [], (value) => Number.parseInt(value, 16));
	vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(bytes.buffer);
}
afterEach(() => vi.restoreAllMocks());
it('rejects a different model before creating an ONNX session', async () => {
	const {ort, create} = runtime();
	await expect(createDpdfOnnxEngine(ort, new Uint8Array([1, 2, 3]))).rejects.toThrow('checksum');
	expect(create).not.toHaveBeenCalled();
});
it('releases output tensors and preserves the next recurrent state', async () => {
	acceptModelHash();
	const {ort, session} = runtime();
	const engine = await createDpdfOnnxEngine(ort, new Uint8Array());
	await engine.core.processHop(new Float32Array(480));
	await engine.core.processHop(new Float32Array(480));
	const first = await session.run.mock.results[0].value;
	expect(first.spec_e.dispose).toHaveBeenCalledTimes(1);
	expect(first.state_out.dispose).not.toHaveBeenCalled();
	engine.core.reset();
	expect(first.state_out.dispose).toHaveBeenCalledTimes(1);
	await engine.dispose();
	await engine.dispose();
	expect(session.release).toHaveBeenCalledTimes(1);
});
it('waits for in-flight inference before releasing the session', async () => {
	acceptModelHash();
	const {ort, session} = runtime();
	let finish!: (value: {spec_e: Tensor; state_out: Tensor}) => void;
	session.run.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const engine = await createDpdfOnnxEngine(ort, new Uint8Array());
	await engine.core.processHop(new Float32Array(480));
	const pending = engine.core.processHop(new Float32Array(480));
	const rejected = expect(pending).rejects.toThrow('disposed');
	const disposal = engine.dispose();
	expect(session.release).not.toHaveBeenCalled();
	const output = {
		spec_e: new Tensor('float32', new Float32Array(962)),
		state_out: new Tensor('float32', new Float32Array(DPDF_STATE_SIZE)),
	};
	finish(output);
	await rejected;
	await disposal;
	expect(output.spec_e.dispose).toHaveBeenCalledTimes(1);
	expect(output.state_out.dispose).toHaveBeenCalledTimes(1);
	expect(session.release).toHaveBeenCalledTimes(1);
});
