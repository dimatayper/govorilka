// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it, vi} from 'vitest';
import type {DpdfStreamingCore} from './DpdfStreamingCore';
import {startEgorpWorkerSession} from './EgorpWorkerSession';

function fixture(processHop: (hop: Float32Array) => Promise<Float32Array>, strength = 100) {
	const port = {onmessage: null as MessagePort['onmessage'], start: vi.fn(), close: vi.fn(), postMessage: vi.fn()};
	const failure = vi.fn();
	const close = startEgorpWorkerSession(
		port as unknown as MessagePort,
		{processHop} as DpdfStreamingCore,
		strength,
		failure,
	);
	const send = (sequence: number) =>
		port.onmessage?.call(
			port as unknown as MessagePort,
			{
				data: {
					type: 'hop',
					sequence,
					samples: new Float32Array(480).fill(sequence + 1),
				},
			} as MessageEvent,
		);
	return {port, failure, close, send};
}

describe('Egorp inference transport', () => {
	it('serializes inference and preserves the sequence during bursts', async () => {
		let concurrent = 0;
		let maximum = 0;
		const f = fixture(async (hop) => {
			maximum = Math.max(maximum, ++concurrent);
			await Promise.resolve();
			concurrent--;
			return hop;
		});
		for (let i = 0; i < 6; i++) f.send(i);
		await vi.waitFor(() => expect(f.port.postMessage).toHaveBeenCalledTimes(6));
		expect(maximum).toBe(1);
		expect(f.port.postMessage.mock.calls.map(([data]) => data.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(f.failure).not.toHaveBeenCalled();
		f.close();
	});

	it('bounds queued audio when inference stalls and reports failure once', () => {
		const f = fixture(() => new Promise(() => undefined));
		for (let i = 0; i < 20; i++) f.send(i);
		expect(f.failure).toHaveBeenCalledTimes(1);
		expect(f.port.close).toHaveBeenCalledOnce();
	});

	it('rejects a missing sequence and suppresses output after disposal', async () => {
		let finish!: (hop: Float32Array) => void;
		const f = fixture(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		f.send(0);
		f.send(2);
		finish(new Float32Array(480));
		await Promise.resolve();
		expect(f.failure).toHaveBeenCalledOnce();
		expect(f.port.postMessage.mock.calls.filter(([data]) => data.type === 'hop')).toHaveLength(0);
	});

	it('aligns strength-zero dry audio to the model delay', async () => {
		const f = fixture(async () => new Float32Array(480).fill(42), 0);
		for (let i = 0; i < 7; i++) f.send(i);
		await vi.waitFor(() => expect(f.port.postMessage).toHaveBeenCalledTimes(7));
		expect(f.port.postMessage.mock.calls.map(([data]) => data.samples[0])).toEqual([0, 0, 0, 0, 0, 1, 2]);
		f.close();
	});
});
