// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterEach, describe, expect, it, vi} from 'vitest';
import {createEgorpWorklet} from './CreateEgorpWorklet';

class Port {
	onmessage: ((event: MessageEvent) => void) | null = null;
	close = vi.fn();
	postMessage = vi.fn((data: {type: string}) => {
		if (data.type === 'connect') queueMicrotask(() => this.onmessage?.({data: {type: 'ready'}} as MessageEvent));
	});
}
class WorkerMock {
	static instances: Array<WorkerMock> = [];
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	terminate = vi.fn();
	postMessage = vi.fn(() => queueMicrotask(() => this.onmessage?.({data: {type: 'ready'}} as MessageEvent)));
	constructor() {
		WorkerMock.instances.push(this);
	}
}
class NodeMock {
	port = new Port();
	disconnect = vi.fn();
	onprocessorerror = null;
}
function setup(addModule: () => Promise<void> = vi.fn(async () => undefined)) {
	WorkerMock.instances = [];
	vi.stubGlobal('Worker', WorkerMock);
	vi.stubGlobal('AudioWorkletNode', NodeMock);
	vi.stubGlobal(
		'MessageChannel',
		class {
			port1 = new Port();
			port2 = new Port();
		},
	);
	const revoke = vi.spyOn(URL, 'revokeObjectURL');
	const context = {sampleRate: 48000, audioWorklet: {addModule}} as unknown as AudioContext;
	return {context, revoke};
}
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('Egorp Worker lifecycle', () => {
	it('waits for initialization and owns Worker/worklet cleanup', async () => {
		const f = setup();
		const chain = await createEgorpWorklet({context: f.context, strength: 80});
		expect(f.revoke).toHaveBeenCalledOnce();
		chain.dispose();
		chain.dispose();
		expect(WorkerMock.instances[0].terminate).toHaveBeenCalledOnce();
		expect(chain.node.disconnect).toHaveBeenCalledOnce();
	});
	it('reports runtime failure once and releases the Worker', async () => {
		const f = setup();
		const onRuntimeFailure = vi.fn();
		await createEgorpWorklet({context: f.context, strength: 80, onRuntimeFailure});
		const worker = WorkerMock.instances[0];
		worker.onmessage?.({data: {type: 'error', message: 'deadline'}} as MessageEvent);
		worker.onmessage?.({data: {type: 'error', message: 'deadline'}} as MessageEvent);
		expect(onRuntimeFailure).toHaveBeenCalledOnce();
		expect(worker.terminate).toHaveBeenCalledOnce();
	});
	it('cancels pending module loading without constructing a late processor', async () => {
		let finish!: () => void;
		const f = setup(
			vi.fn(
				() =>
					new Promise<void>((resolve) => {
						finish = resolve;
					}),
			),
		);
		const controller = new AbortController();
		const pending = createEgorpWorklet({context: f.context, strength: 80, signal: controller.signal});
		controller.abort(new Error('cancelled'));
		await expect(pending).rejects.toThrow('cancelled');
		finish();
		await Promise.resolve();
		expect(WorkerMock.instances[0].postMessage).not.toHaveBeenCalled();
		expect(WorkerMock.instances[0].terminate).toHaveBeenCalledOnce();
	});
	it('times out a stalled module load and revokes its Blob URL', async () => {
		vi.useFakeTimers();
		const f = setup(vi.fn(() => new Promise<void>(() => undefined)));
		const pending = createEgorpWorklet({context: f.context, strength: 80});
		const rejected = expect(pending).rejects.toThrow('timed out');
		await vi.advanceTimersByTimeAsync(30000);
		await rejected;
		expect(WorkerMock.instances[0].terminate).toHaveBeenCalledOnce();
		expect(f.revoke).toHaveBeenCalledOnce();
	});
});
