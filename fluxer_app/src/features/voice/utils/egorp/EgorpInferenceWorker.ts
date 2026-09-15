// SPDX-License-Identifier: AGPL-3.0-or-later

import {resolveWorkerAssetUrl} from '@app/features/platform/utils/WorkerAssetUrl';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm';
import {createDpdfOnnxEngine} from './DpdfOnnxEngine';
import {startEgorpWorkerSession} from './EgorpWorkerSession';
import modelUrl from './models/dpdfnet2_48khz_hr.onnx';

let initialized = false;
self.onmessage = async ({data}: MessageEvent) => {
	if (data?.type !== 'initialize' || initialized) return;
	initialized = true;
	let engine: Awaited<ReturnType<typeof createDpdfOnnxEngine>> | undefined;
	try {
		const ort = await import('onnxruntime-web/wasm');
		ort.env.wasm.numThreads = 1;
		ort.env.wasm.proxy = false;
		ort.env.wasm.wasmPaths = {wasm: resolveWorkerAssetUrl(ortWasmUrl)};
		const response = await fetch(resolveWorkerAssetUrl(modelUrl));
		if (!response.ok) throw new Error(`Egorp model request failed (${response.status})`);
		engine = await createDpdfOnnxEngine(ort, new Uint8Array(await response.arrayBuffer()));
		// Compile hot paths before the microphone clock starts, then discard warm-up state.
		for (let i = 0; i < 24; i++) await engine.core.processHop(new Float32Array(480));
		engine.core.reset();
		startEgorpWorkerSession(data.port, engine.core, data.strength, (error) => {
			self.postMessage({type: 'error', message: error.message});
			void engine?.dispose();
		});
		self.postMessage({type: 'ready'});
	} catch (error) {
		await engine?.dispose();
		self.postMessage({type: 'error', message: error instanceof Error ? error.message : String(error)});
	}
};
