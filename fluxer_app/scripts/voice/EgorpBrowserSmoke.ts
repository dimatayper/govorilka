// SPDX-License-Identifier: AGPL-3.0-or-later
// Standalone browser entry for the real Worker/WASM/AudioWorklet path.
import {buildDeepFilterAudioChain} from '../../src/features/voice/utils/DeepFilterNoiseProcessor';

Object.assign(globalThis, {
	runEgorpSmoke: async (captureRate = 48000, durationMs = 12000) => {
		const errors: Array<string> = [];
		const context = new AudioContext({sampleRate: captureRate, latencyHint: 'interactive'});
		const start = performance.now();
		const {inputDestination, processedTrack, dispose} = await buildDeepFilterAudioChain({
			audioContext: context,
			noiseReductionLevel: 100,
			onRuntimeFailure: (e) => errors.push(e.message),
		});
		const startupMs = performance.now() - start;
		await context.resume();
		const response = await fetch('/noisy.wav');
		const buffer = await context.decodeAudioData(await response.arrayBuffer());
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.loop = true;
		const recorder = context.createScriptProcessor(2048, 1, 1);
		let frames = 0;
		let sum = 0;
		let peak = 0;
		let nonfinite = 0;
		recorder.onaudioprocess = (event) => {
			for (const sample of event.inputBuffer.getChannelData(0)) {
				frames++;
				if (!Number.isFinite(sample)) nonfinite++;
				sum += sample * sample;
				peak = Math.max(peak, Math.abs(sample));
			}
		};
		source.connect(inputDestination);
		const returned = context.createMediaStreamSource(new MediaStream([processedTrack]));
		returned.connect(recorder).connect(context.destination);
		source.start();
		const processingStarted = performance.now();
		await new Promise<void>((resolve) => {
			const timer = setInterval(() => {
				const elapsedMs = performance.now() - processingStarted;
				const progress = {
					captureRate,
					elapsedMs,
					frames,
					rms: Math.sqrt(sum / Math.max(1, frames)),
					peak,
					nonfinite,
					errors: [...errors],
				};
				const report = (globalThis as typeof globalThis & {onEgorpProgress?: (value: unknown) => void}).onEgorpProgress;
				report?.(progress);
				if (elapsedMs >= durationMs || errors.length || nonfinite) {
					clearInterval(timer);
					resolve();
				}
			}, 1000);
		});
		source.stop();
		source.disconnect();
		recorder.disconnect();
		returned.disconnect();
		await dispose();
		await context.close();
		return {
			captureRate,
			durationMs,
			elapsedMs: performance.now() - processingStarted,
			trackState: processedTrack.readyState,
			startupMs,
			frames,
			rms: Math.sqrt(sum / frames),
			peak,
			nonfinite,
			errors,
		};
	},
});
