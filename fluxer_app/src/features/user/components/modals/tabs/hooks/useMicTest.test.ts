// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercise asynchronous ownership without a DOM or microphone permission prompt.
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {useMicTest} from './useMicTest';

const mocks = vi.hoisted(() => ({graph: vi.fn(), capture: vi.fn(), error: vi.fn(), state: vi.fn()}));
vi.mock('react', () => ({
	useState: (value: unknown) => [value, mocks.state],
	useRef: (current: unknown) => ({current}),
	useCallback: (fn: unknown) => fn,
	useMemo: (fn: () => unknown) => fn(),
	useEffect: () => undefined,
}));
vi.mock('@app/features/permissions/system/commands/MacPermissionsModalCommands', () => ({
	handleMediaPermissionBlocked: vi.fn(),
}));
vi.mock('@app/features/permissions/system/state/MediaPermission', () => ({
	default: {microphoneExplicitlyDenied: false, markMicrophoneExplicitlyDenied: vi.fn()},
}));
vi.mock('@app/features/permissions/system/utils/MacPermissionGate', () => ({
	ensureMacPermission: async () => 'unsupported-platform',
}));
vi.mock('@app/features/platform/utils/AppLogger', () => ({
	Logger: class {
		info() {}
		warn() {}
		error = mocks.error;
	},
}));
vi.mock('./MicTestAudioGraph', () => ({createMicTestAudioGraph: mocks.graph}));
vi.mock('@app/features/voice/utils/noise_suppression/NoiseSuppressionRuntime', () => ({
	readEffectiveNoiseSuppression: () => ({backend: 'deep_filter', suppressionStrength: 80}),
}));
vi.mock('@app/features/voice/utils/noise_suppression/NoiseSuppressionSelection', () => ({
	applyNoiseSuppressionOverride: (profile: unknown) => profile,
}));
vi.mock('@app/features/voice/utils/VoiceProcessingProfile', () => ({
	resolveVoiceProcessing: () => ({
		noiseSuppressionBackend: 'deep_filter',
		deepFilter: true,
		deepFilterNoiseReductionLevel: 80,
	}),
	applyContentHintToTrack: () => undefined,
}));
const settings = {
	inputDeviceId: 'default',
	outputDeviceId: 'default',
	inputVolume: 100,
	outputVolume: 100,
	echoCancellation: true,
	noiseSuppression: false,
	autoGainControl: false,
	deepFilterNoiseSuppression: true,
	deepFilterNoiseSuppressionLevel: 80,
	voiceProcessingMode: 'custom' as const,
};
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return {promise, resolve};
}
function trackStream() {
	const track = {stop: vi.fn()};
	return {track, getTracks: () => [track], getAudioTracks: () => [track]};
}
beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('navigator', {mediaDevices: {getUserMedia: mocks.capture}});
	vi.stubGlobal(
		'AudioContext',
		class {
			state = 'running';
			close = vi.fn(async () => undefined);
			createMediaStreamDestination = () => ({stream: trackStream(), disconnect: vi.fn()});
		},
	);
});
afterEach(() => vi.unstubAllGlobals());

it('stops capture returned after the user cancelled startup', async () => {
	const capture = deferred<ReturnType<typeof trackStream>>();
	mocks.capture.mockReturnValue(capture.promise);
	const hook = useMicTest(settings);
	const started = hook.start();
	await Promise.resolve();
	expect(mocks.capture).toHaveBeenCalledOnce();
	hook.stop();
	const stream = trackStream();
	capture.resolve(stream);
	await started;
	expect(stream.track.stop).toHaveBeenCalledOnce();
	expect(mocks.graph).not.toHaveBeenCalled();
	expect(mocks.error).not.toHaveBeenCalled();
});
it('aborts model loading and disposes a graph that completes after cancellation', async () => {
	const stream = trackStream();
	mocks.capture.mockResolvedValue(stream);
	const pending = deferred<{dispose: ReturnType<typeof vi.fn>}>();
	mocks.graph.mockReturnValue(pending.promise);
	const hook = useMicTest(settings);
	const started = hook.start();
	await vi.waitFor(() => expect(mocks.graph).toHaveBeenCalledOnce());
	const signal = mocks.graph.mock.calls[0][0].signal as AbortSignal;
	hook.stop();
	expect(signal.aborted).toBe(true);
	const graph = {dispose: vi.fn(async () => undefined)};
	pending.resolve(graph);
	await started;
	expect(graph.dispose).toHaveBeenCalledOnce();
	expect(stream.track.stop).toHaveBeenCalledOnce();
	expect(mocks.error).not.toHaveBeenCalled();
});
