// SPDX-License-Identifier: AGPL-3.0-or-later

import type {DpdfStreamingCore} from './DpdfStreamingCore.ts';

/** Serializes a bounded direct AudioWorklet port; no microphone data crosses the main thread. */
export function startEgorpWorkerSession(
	port: MessagePort,
	core: DpdfStreamingCore,
	strength: number,
	onFailure: (error: Error) => void,
): () => void {
	const queue: Array<{sequence: number; samples: Float32Array}> = [];
	// The candidate model's four-frame lookahead plus STFT contribute 50 ms.
	const dryDelay = Array.from({length: 5}, () => new Float32Array(480));
	const level = Number.isFinite(strength) ? Math.max(0, Math.min(100, strength)) : 80;
	const dryMix = level === 100 ? 0 : 10 ** (-level / 20);
	let expected = 0;
	let running = false;
	let closed = false;
	const close = () => {
		closed = true;
		queue.length = 0;
		port.onmessage = null;
		port.close();
	};
	const fail = (cause: unknown) => {
		if (closed) return;
		const error = cause instanceof Error ? cause : new Error(String(cause));
		port.postMessage({type: 'error', message: error.message});
		close();
		onFailure(error);
	};
	const drain = async () => {
		if (running || closed) return;
		running = true;
		try {
			while (queue.length && !closed) {
				const item = queue.shift()!;
				const output = await core.processHop(item.samples);
				if (closed) break;
				const dry = dryDelay[item.sequence % dryDelay.length];
				for (let i = 0; i < output.length; i++) output[i] = (1 - dryMix) * output[i] + dryMix * dry[i];
				dry.set(item.samples);
				port.postMessage({type: 'hop', sequence: item.sequence, samples: output}, [output.buffer]);
			}
		} catch (error) {
			fail(error);
		} finally {
			running = false;
		}
	};
	port.onmessage = ({data}: MessageEvent) => {
		if (closed) return;
		if (
			data?.type !== 'hop' ||
			data.sequence !== expected ||
			!(data.samples instanceof Float32Array) ||
			data.samples.length !== 480
		) {
			fail(new Error('Invalid Egorp input sequence'));
			return;
		}
		if (queue.length + Number(running) >= 8) {
			fail(new Error('Egorp inference queue overflow'));
			return;
		}
		expected++;
		queue.push(data);
		void drain();
	};
	port.start();
	return close;
}
