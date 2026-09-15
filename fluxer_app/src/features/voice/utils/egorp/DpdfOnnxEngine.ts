// SPDX-License-Identifier: AGPL-3.0-or-later

import {DPDF_INITIAL_STATE_PREFIX, DPDF_MODEL_SHA256, DPDF_STATE_SIZE} from './DpdfModelConfig.ts';
import {DpdfStreamingCore} from './DpdfStreamingCore.ts';

export type DpdfOrtModule = typeof import('onnxruntime-web/wasm');

/** Owns one independent recurrent state. Model identity is checked before inference. */
export async function createDpdfOnnxEngine(
	ort: DpdfOrtModule,
	modelBytes: Uint8Array,
): Promise<{
	core: DpdfStreamingCore;
	dispose: () => Promise<void>;
}> {
	const bytes = new Uint8Array(modelBytes);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
	if (hash !== DPDF_MODEL_SHA256) throw new Error('Egorp model checksum mismatch');
	const session = await ort.InferenceSession.create(bytes, {
		executionProviders: ['wasm'],
		graphOptimizationLevel: 'all',
	});
	const newState = () => {
		const values = new Float32Array(DPDF_STATE_SIZE);
		values.set(DPDF_INITIAL_STATE_PREFIX);
		return new ort.Tensor('float32', values, [DPDF_STATE_SIZE]);
	};
	let state: import('onnxruntime-web/wasm').Tensor = newState();
	let disposed = false;
	let pending: Promise<Record<string, import('onnxruntime-web/wasm').Tensor>> | null = null;
	let disposal: Promise<void> | null = null;
	const reset = () => {
		if (disposed) throw new Error('Egorp engine disposed');
		state.dispose();
		state = newState();
	};
	const core = new DpdfStreamingCore(async (spectrum) => {
		if (disposed) throw new Error('Egorp engine disposed');
		const input = new ort.Tensor('float32', spectrum, [1, 1, 481, 2]);
		try {
			pending = session.run({spec: input, state_in: state});
			const output = await pending;
			try {
				if (disposed) throw new Error('Egorp engine disposed during inference');
				if (!(output.spec_e?.data instanceof Float32Array) || !(output.state_out?.data instanceof Float32Array)) {
					throw new Error('Invalid Egorp inference tensor types');
				}
				if (output.state_out.data.length !== DPDF_STATE_SIZE) throw new Error('Invalid Egorp recurrent state');
				const enhanced = new Float32Array(output.spec_e.data);
				state.dispose();
				state = output.state_out;
				return enhanced;
			} catch (error) {
				output.state_out?.dispose();
				throw error;
			} finally {
				output.spec_e?.dispose();
			}
		} finally {
			input.dispose();
			pending = null;
		}
	}, reset);
	return {
		core,
		dispose: () => {
			disposal ??= (async () => {
				disposed = true;
				await pending?.catch(() => undefined);
				state.dispose();
				await session.release();
			})();
			return disposal;
		},
	};
}
