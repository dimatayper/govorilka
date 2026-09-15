// SPDX-License-Identifier: AGPL-3.0-or-later

import {createEgorpTransportProcessor} from '../../worklets/EgorpTransportProcessor.js';

export async function createEgorpWorklet(opts: {
	context: AudioContext;
	strength: number;
	signal?: AbortSignal;
	onRuntimeFailure?: (error: Error) => void;
}): Promise<{node: AudioWorkletNode; dispose: () => void}> {
	opts.signal?.throwIfAborted();
	if (opts.context.sampleRate !== 48000) throw new Error('Egorp requires 48000 Hz');
	const worker = new Worker(new URL('./EgorpInferenceWorker.ts', import.meta.url), {type: 'module'});
	const channel = new MessageChannel();
	let node: AudioWorkletNode | undefined;
	let disposed = false;
	let started = false;
	let failed = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let rejectStartup: (error: unknown) => void = () => undefined;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		worker.terminate();
		channel.port1.close();
		channel.port2.close();
		if (node) {
			node.onprocessorerror = null;
			node.port.postMessage({type: 'destroy'});
			node.port.close();
			node.disconnect();
		}
	};
	const fail = (error: Error) => {
		if (disposed || failed) return;
		failed = true;
		if (started) {
			dispose();
			opts.onRuntimeFailure?.(error);
		} else rejectStartup(error);
	};
	const onAbort = () => rejectStartup(opts.signal?.reason ?? new Error('Egorp startup cancelled'));
	const source = `registerProcessor('egorp-transport', (${createEgorpTransportProcessor.toString()})({AudioWorkletProcessor, sampleRate}));`;
	const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
	try {
		await new Promise<void>((resolve, reject) => {
			rejectStartup = reject;
			timeout = setTimeout(() => reject(new Error('Egorp startup timed out')), 30000);
			opts.signal?.addEventListener('abort', onAbort, {once: true});
			if (opts.signal?.aborted) onAbort();
			worker.onerror = (event) => fail(new Error(event.message || 'Egorp Worker failed'));
			worker.onmessageerror = () => fail(new Error('Egorp Worker message failed'));
			worker.onmessage = ({data}: MessageEvent) => {
				if (data?.type === 'error') fail(new Error(data.message));
				if (data?.type === 'ready' && node && !disposed && !failed) {
					node.port.postMessage({type: 'connect', port: channel.port2}, [channel.port2]);
				}
			};
			void (async () => {
				await opts.context.audioWorklet.addModule(url);
				if (disposed || failed || opts.signal?.aborted) return;
				node = new AudioWorkletNode(opts.context, 'egorp-transport', {
					numberOfInputs: 1,
					numberOfOutputs: 1,
					outputChannelCount: [1],
					channelCount: 1,
					channelCountMode: 'explicit',
				});
				node.onprocessorerror = () => fail(new Error('Egorp audio transport failed'));
				node.port.onmessage = ({data}: MessageEvent) => {
					if (data?.type === 'error') fail(new Error(data.message));
					if (data?.type === 'ready') resolve();
				};
				worker.postMessage({type: 'initialize', strength: opts.strength, port: channel.port1}, [channel.port1]);
			})().catch(reject);
		});
		opts.signal?.throwIfAborted();
		if (!node || failed) throw new Error('Egorp failed to initialize');
		started = true;
		return {node, dispose};
	} catch (error) {
		dispose();
		throw error;
	} finally {
		URL.revokeObjectURL(url);
		clearTimeout(timeout);
		opts.signal?.removeEventListener('abort', onAbort);
	}
}
