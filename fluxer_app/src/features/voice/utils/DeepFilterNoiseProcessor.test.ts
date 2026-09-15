// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {buildDeepFilterAudioChain, EGORP_STARTUP_TIMEOUT_MS, normalizeEgorpStrength} from './DeepFilterNoiseProcessor';

const mocks = vi.hoisted(() => ({
	context: vi.fn(),
	initialize: vi.fn(),
	destroy: vi.fn(),
	node: vi.fn(),
	dpdf: vi.fn(),
}));
vi.mock('./egorp/CreateEgorpWorklet', () => ({createEgorpWorklet: mocks.dpdf}));
vi.mock('@app/features/app/state/RuntimeConfig', () => ({default: {staticCdnEndpoint: '/static'}}));
vi.mock('@app/features/platform/utils/AppLogger', () => ({
	Logger: class {
		info() {}
		debug() {}
		warn() {}
	},
}));
vi.mock('@app/features/voice/state/VoiceSettings', () => ({default: {getDeepFilterNoiseSuppressionLevel: () => 80}}));
vi.mock('@app/features/voice/engine/VoiceSharedAudioContext', () => ({createVoiceAudioContext: mocks.context}));
vi.mock('deepfilternet3-noise-filter', () => ({
	DeepFilterNoiseFilterProcessor: class {},
	DeepFilterNet3Core: class {
		initialize = mocks.initialize;
		destroy = mocks.destroy;
		createAudioWorkletNode = mocks.node;
	},
}));
function node() {
	return {
		connect: vi.fn((target: unknown) => target),
		disconnect: vi.fn(),
		frequency: {value: 0},
		Q: {value: 0},
		threshold: {value: 0},
		knee: {value: 0},
		ratio: {value: 0},
		attack: {value: 0},
		release: {value: 0},
		port: {
			close: vi.fn(),
			postMessage: vi.fn(),
			onmessage: null as null | ((event: {data: {type: string}}) => void),
			start() {
				queueMicrotask(() => this.onmessage?.({data: {type: 'ready'}}));
			},
		},
		onprocessorerror: null as null | (() => void),
	};
}
function context(sampleRate = 48000) {
	const tracks: Array<{stop: ReturnType<typeof vi.fn>}> = [];
	return {
		sampleRate,
		state: 'running',
		tracks,
		close: vi.fn().mockResolvedValue(undefined),
		createMediaStreamSource: vi.fn(node),
		createBiquadFilter: vi.fn(node),
		createDynamicsCompressor: vi.fn(node),
		createMediaStreamDestination: vi.fn(() => {
			const track = {stop: vi.fn()};
			tracks.push(track);
			return {...node(), stream: {getAudioTracks: () => [track]}};
		}),
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.initialize.mockResolvedValue(undefined);
	mocks.node.mockImplementation(async () => node());
	vi.stubGlobal('MediaStream', class {});
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
it('uses one capture bridge and releases only owned resources', async () => {
	const capture = context(44100);
	const model = context();
	mocks.context.mockReturnValue(model);
	const chain = await buildDeepFilterAudioChain({
		model: 'deepfilternet3',
		audioContext: capture as unknown as AudioContext,
	});
	expect(capture.createMediaStreamDestination).toHaveBeenCalledTimes(1);
	expect(capture.createBiquadFilter).not.toHaveBeenCalled();
	expect(model.createBiquadFilter).toHaveBeenCalledTimes(1);
	await chain.dispose();
	await chain.dispose();
	expect(model.close).toHaveBeenCalledTimes(1);
	expect(capture.close).not.toHaveBeenCalled();
	for (const track of [...capture.tracks, ...model.tracks]) expect(track.stop).toHaveBeenCalledTimes(1);
});
it('rejects incorrect model rates and cleans the capture track', async () => {
	const capture = context();
	const model = context(44100);
	mocks.context.mockReturnValue(model);
	await expect(
		buildDeepFilterAudioChain({model: 'deepfilternet3', audioContext: capture as unknown as AudioContext}),
	).rejects.toThrow('48 kHz');
	expect(mocks.initialize).not.toHaveBeenCalled();
	expect(model.close).toHaveBeenCalledTimes(1);
	expect(capture.tracks[0].stop).toHaveBeenCalled();
});
it('times out and discards late initialization', async () => {
	vi.useFakeTimers();
	let finish!: () => void;
	mocks.initialize.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const model = context();
	mocks.context.mockReturnValue(model);
	const pending = buildDeepFilterAudioChain({
		model: 'deepfilternet3',
		audioContext: context() as unknown as AudioContext,
	});
	const rejected = expect(pending).rejects.toThrow('timed out');
	await vi.advanceTimersByTimeAsync(EGORP_STARTUP_TIMEOUT_MS);
	await rejected;
	finish();
	await Promise.resolve();
	expect(mocks.node).not.toHaveBeenCalled();
	expect(model.close).toHaveBeenCalledTimes(1);
});
it('reports processor failure once and detaches on disposal', async () => {
	const worklet = node();
	mocks.node.mockResolvedValue(worklet);
	mocks.context.mockReturnValue(context());
	const failure = vi.fn();
	const chain = await buildDeepFilterAudioChain({
		model: 'deepfilternet3',
		audioContext: context() as unknown as AudioContext,
		onRuntimeFailure: failure,
	});
	worklet.onprocessorerror?.();
	worklet.onprocessorerror?.();
	expect(failure).toHaveBeenCalledTimes(1);
	await chain.dispose();
	expect(worklet.onprocessorerror).toBeNull();
});
it('rejects cancellation before allocating resources', async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(
		buildDeepFilterAudioChain({
			model: 'deepfilternet3',
			audioContext: context() as unknown as AudioContext,
			signal: controller.signal,
		}),
	).rejects.toThrow();
	expect(mocks.context).not.toHaveBeenCalled();
});
it('normalizes invalid model strength', () => {
	expect(normalizeEgorpStrength(NaN)).toBe(80);
	expect(normalizeEgorpStrength(Infinity)).toBe(80);
	expect(normalizeEgorpStrength(-5)).toBe(0);
	expect(normalizeEgorpStrength(120)).toBe(100);
});
it('releases a partial graph when a downstream node fails', async () => {
	const model = context();
	const capture = context();
	mocks.context.mockReturnValue(model);
	model.createDynamicsCompressor.mockImplementation(() => {
		throw new Error('graph failure');
	});
	await expect(
		buildDeepFilterAudioChain({model: 'deepfilternet3', audioContext: capture as unknown as AudioContext}),
	).rejects.toThrow('graph failure');
	expect(model.close).toHaveBeenCalledTimes(1);
	expect(capture.tracks[0].stop).toHaveBeenCalledTimes(1);
	expect(mocks.destroy).toHaveBeenCalledTimes(1);
});
it('cancels pending loading without waiting for the timeout', async () => {
	let finish!: () => void;
	mocks.initialize.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const model = context();
	mocks.context.mockReturnValue(model);
	const controller = new AbortController();
	const pending = buildDeepFilterAudioChain({
		model: 'deepfilternet3',
		audioContext: context() as unknown as AudioContext,
		signal: controller.signal,
	});
	controller.abort(new Error('cancelled'));
	await expect(pending).rejects.toThrow('cancelled');
	finish();
	await Promise.resolve();
	expect(model.close).toHaveBeenCalledTimes(1);
	expect(mocks.node).not.toHaveBeenCalled();
});
it('waits for model readiness and rejects reported initialization errors', async () => {
	const worklet = node();
	worklet.port.start = function () {
		queueMicrotask(() => this.onmessage?.({data: {type: 'error'}}));
	};
	mocks.node.mockResolvedValue(worklet);
	const model = context();
	mocks.context.mockReturnValue(model);
	await expect(
		buildDeepFilterAudioChain({model: 'deepfilternet3', audioContext: context() as unknown as AudioContext}),
	).rejects.toThrow('initialization failed');
	expect(model.createBiquadFilter).not.toHaveBeenCalled();
	expect(model.close).toHaveBeenCalledTimes(1);
	expect(worklet.port.close).toHaveBeenCalledTimes(1);
});

it('uses the bundled DPDF Worker for the default Egorp call path', async () => {
	const capture = context(44100);
	const model = context();
	const dispose = vi.fn();
	const worklet = node();
	mocks.context.mockReturnValue(model);
	mocks.dpdf.mockResolvedValue({node: worklet, dispose});
	const onRuntimeFailure = vi.fn();
	const chain = await buildDeepFilterAudioChain({audioContext: capture as unknown as AudioContext, onRuntimeFailure});
	expect(mocks.initialize).not.toHaveBeenCalled();
	expect(mocks.dpdf).toHaveBeenCalledWith(expect.objectContaining({context: model, strength: 80, onRuntimeFailure}));
	await chain.dispose();
	expect(dispose).toHaveBeenCalledOnce();
	expect(capture.close).not.toHaveBeenCalled();
	expect(model.close).toHaveBeenCalledOnce();
	for (const track of [...capture.tracks, ...model.tracks]) expect(track.stop).toHaveBeenCalledOnce();
});
it('cancels the DPDF Worker and closes the graph if startup fails', async () => {
	const capture = context();
	const model = context();
	mocks.context.mockReturnValue(model);
	let signal: AbortSignal | undefined;
	mocks.dpdf.mockImplementation(async (opts: {signal: AbortSignal}) => {
		signal = opts.signal;
		throw new Error('model failed');
	});
	await expect(buildDeepFilterAudioChain({audioContext: capture as unknown as AudioContext})).rejects.toThrow(
		'model failed',
	);
	expect(signal?.aborted).toBe(true);
	expect(model.close).toHaveBeenCalledOnce();
	expect(capture.tracks[0].stop).toHaveBeenCalledOnce();
});
