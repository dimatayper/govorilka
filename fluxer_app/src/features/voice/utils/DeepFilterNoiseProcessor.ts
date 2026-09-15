// SPDX-License-Identifier: AGPL-3.0-or-later

import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {createVoiceAudioContext} from '@app/features/voice/engine/VoiceSharedAudioContext';
import VoiceSettings from '@app/features/voice/state/VoiceSettings';
import {DeepFilterNet3Core, DeepFilterNoiseFilterProcessor} from 'deepfilternet3-noise-filter';
import type {LocalAudioTrack} from 'livekit-client';
import {createEgorpWorklet} from './egorp/CreateEgorpWorklet';

const logger = new Logger('DeepFilterNoiseProcessor');
const DEEP_FILTER_MODEL_SAMPLE_RATE = 48000;
const DEFAULT_SUPPRESSION_LEVEL = 80;
const HIGH_PASS_FREQUENCY_HZ = 60;
const HIGH_PASS_Q = Math.SQRT1_2;
const LIMITER_THRESHOLD_DB = -3;
const LIMITER_KNEE_DB = 0;
const LIMITER_RATIO = 20;
const LIMITER_ATTACK_SEC = 0.003;
const LIMITER_RELEASE_SEC = 0.05;

let activeProcessor: DeepFilterNoiseFilterProcessor | null = null;
let activeTrack: LocalAudioTrack | null = null;

export function createDeepFilterProcessor(
	noiseReductionLevel = DEFAULT_SUPPRESSION_LEVEL,
): DeepFilterNoiseFilterProcessor {
	const clampedNoiseReductionLevel = normalizeEgorpStrength(noiseReductionLevel);
	return new DeepFilterNoiseFilterProcessor({
		sampleRate: DEEP_FILTER_MODEL_SAMPLE_RATE,
		noiseReductionLevel: clampedNoiseReductionLevel,
		enabled: true,
		assetConfig: {
			cdnUrl: `${RuntimeConfig.staticCdnEndpoint}/libs/deepfilternet3`,
		},
	});
}

/** Never run a 48 kHz neural model at the capture device's native rate. */
export function resolveDeepFilterAudioContext(
	_sourceContext: AudioContext,
	feedTrack: MediaStreamTrack,
): AudioContext | null {
	const context = createVoiceAudioContext({latencyHint: 'interactive', sampleRate: DEEP_FILTER_MODEL_SAMPLE_RATE});
	if (!context) return null;
	try {
		if (context.sampleRate !== DEEP_FILTER_MODEL_SAMPLE_RATE) throw new Error('Unsupported model sample rate');
		context.createMediaStreamSource(new MediaStream([feedTrack])).disconnect();
		return context;
	} catch (error) {
		logger.info('Egorp cannot connect the microphone at 48 kHz', error);
		void context.close().catch(() => undefined);
		return null;
	}
}

export function normalizeEgorpStrength(level: number): number {
	return Number.isFinite(level) ? Math.max(0, Math.min(100, level)) : DEFAULT_SUPPRESSION_LEVEL;
}

export interface DeepFilterAudioChain {
	processedTrack: MediaStreamTrack;
	inputDestination: MediaStreamAudioDestinationNode;
	dispose: () => Promise<void>;
}

function safeDisconnect(node: AudioNode | null | undefined): void {
	if (!node) return;
	try {
		node.disconnect();
	} catch {}
}

function safeStopTrack(track: MediaStreamTrack | null | undefined): void {
	if (!track) return;
	try {
		track.stop();
	} catch {}
}

export const EGORP_STARTUP_TIMEOUT_MS = 8000;

/** One capture bridge; filtering and peak compression share the model's clock. */
export async function buildDeepFilterAudioChain(opts: {
	audioContext: AudioContext;
	noiseReductionLevel?: number;
	/** Legacy model is retained for regression comparisons. Calls use DPDFNet2. */
	model?: 'dpdfnet2' | 'deepfilternet3';
	signal?: AbortSignal;
	onRuntimeFailure?: (error: Error) => void;
}): Promise<DeepFilterAudioChain> {
	opts.signal?.throwIfAborted();
	const nodes: Array<AudioNode> = [];
	const tracks: Array<MediaStreamTrack> = [];
	let context: AudioContext | null = null;
	let worklet: AudioWorkletNode | undefined;
	let disposed = false;
	let disposeDpdf: (() => void) | undefined;
	const initialization = new AbortController();
	const useDpdf = opts.model !== 'deepfilternet3';
	const core = useDpdf
		? null
		: new DeepFilterNet3Core({
				sampleRate: DEEP_FILTER_MODEL_SAMPLE_RATE,
				noiseReductionLevel: normalizeEgorpStrength(
					opts.noiseReductionLevel ?? VoiceSettings.getDeepFilterNoiseSuppressionLevel(),
				),
				assetConfig: {cdnUrl: `${RuntimeConfig.staticCdnEndpoint}/libs/deepfilternet3`},
			});
	const dispose = async () => {
		if (disposed) return;
		disposed = true;
		initialization.abort();
		disposeDpdf?.();
		if (worklet && !useDpdf) {
			worklet.onprocessorerror = null;
			worklet.port.onmessage = null;
			worklet.port.postMessage({type: 'destroy'});
			worklet.port.close();
		}
		for (const node of nodes) safeDisconnect(node);
		for (const track of tracks) safeStopTrack(track);
		core?.destroy();
		if (context) await context.close().catch((error) => logger.debug('Egorp context cleanup failed', error));
	};
	const destination = (owner: AudioContext): MediaStreamAudioDestinationNode => {
		const node = owner.createMediaStreamDestination();
		nodes.push(node);
		node.channelCount = 1;
		node.channelCountMode = 'explicit';
		const track = node.stream.getAudioTracks()[0];
		if (!track) throw new Error('Egorp produced no audio track');
		tracks.push(track);
		return node;
	};
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	try {
		const inputDestination = destination(opts.audioContext);
		context = resolveDeepFilterAudioContext(opts.audioContext, tracks[0]);
		if (!context) throw new Error('Egorp requires a working 48 kHz AudioWorklet context');
		const modelContext = context;
		const initialize = async () => {
			if (useDpdf) {
				const processor = await createEgorpWorklet({
					context: modelContext,
					strength: normalizeEgorpStrength(
						opts.noiseReductionLevel ?? VoiceSettings.getDeepFilterNoiseSuppressionLevel(),
					),
					signal: initialization.signal,
					onRuntimeFailure: opts.onRuntimeFailure,
				});
				if (disposed) {
					processor.dispose();
					return;
				}
				disposeDpdf = processor.dispose;
				worklet = processor.node;
				nodes.push(worklet);
				if (modelContext.state === 'suspended') await modelContext.resume();
				return;
			}
			if (!core) throw new Error('Missing legacy Egorp model');
			await core.initialize();
			if (disposed) {
				core?.destroy();
				return;
			}
			const node = await core.createAudioWorkletNode(modelContext);
			if (disposed) {
				node.port.close();
				core?.destroy();
				return;
			}
			worklet = node;
			nodes.push(node);
			await new Promise<void>((resolve, reject) => {
				node.onprocessorerror = () => reject(new Error('Egorp model initialization failed'));
				node.port.onmessage = ({data}: MessageEvent) => {
					if (data?.type === 'ready') resolve();
					if (data?.type === 'error') reject(new Error(`Egorp model initialization failed: ${data.message}`));
				};
				node.port.start();
			});
			if (disposed) return;
			if (modelContext.state === 'suspended') await modelContext.resume();
		};
		await Promise.race([
			initialize(),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error('Egorp startup timed out')),
					useDpdf ? 30000 : EGORP_STARTUP_TIMEOUT_MS,
				);
				onAbort = () => reject(opts.signal?.reason);
				opts.signal?.addEventListener('abort', onAbort, {once: true});
				if (opts.signal?.aborted) onAbort();
			}),
		]);
		opts.signal?.throwIfAborted();
		if (!worklet) throw new Error('Egorp produced no audio processor');
		const source = modelContext.createMediaStreamSource(inputDestination.stream);
		nodes.push(source);
		const highPass = modelContext.createBiquadFilter();
		nodes.push(highPass);
		highPass.type = 'highpass';
		highPass.frequency.value = HIGH_PASS_FREQUENCY_HZ;
		highPass.Q.value = HIGH_PASS_Q;
		const limiter = modelContext.createDynamicsCompressor();
		nodes.push(limiter);
		limiter.threshold.value = LIMITER_THRESHOLD_DB;
		limiter.knee.value = LIMITER_KNEE_DB;
		limiter.ratio.value = LIMITER_RATIO;
		limiter.attack.value = LIMITER_ATTACK_SEC;
		limiter.release.value = LIMITER_RELEASE_SEC;
		const output = destination(modelContext);
		source.connect(highPass).connect(worklet).connect(limiter).connect(output);
		let failed = false;
		const reportFailure = () => {
			if (disposed || failed) return;
			failed = true;
			opts.onRuntimeFailure?.(new Error('Egorp audio processor failed'));
		};
		if (!useDpdf) {
			worklet.onprocessorerror = reportFailure;
			worklet.port.onmessage = ({data}: MessageEvent) => {
				if (data?.type === 'error') reportFailure();
			};
		}
		return {inputDestination, processedTrack: tracks[tracks.length - 1], dispose};
	} catch (error) {
		await dispose();
		throw error;
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
		if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
	}
}

export async function applyDeepFilterProcessor(
	track: LocalAudioTrack,
	noiseReductionLevel = VoiceSettings.getDeepFilterNoiseSuppressionLevel(),
): Promise<void> {
	if (!VoiceSettings.getDeepFilterNoiseSuppression()) {
		return;
	}
	try {
		await removeDeepFilterProcessor();
		const processor = createDeepFilterProcessor(noiseReductionLevel);
		await track.setProcessor(processor);
		activeTrack = track;
		activeProcessor = processor;
		logger.info('Applied DeepFilterNet3 noise suppression');
	} catch (error) {
		logger.warn('Failed to apply DeepFilterNet3 noise suppression', error);
		activeTrack = null;
		activeProcessor = null;
	}
}

export async function removeDeepFilterProcessor(track?: LocalAudioTrack): Promise<void> {
	if (activeProcessor) {
		const targetTrack = activeTrack ?? track;
		try {
			if (targetTrack) {
				await targetTrack.stopProcessor();
			}
		} catch (error) {
			logger.warn('Failed to stop DeepFilter processor', error);
		}
		try {
			await activeProcessor.destroy();
		} catch (error) {
			logger.warn('Failed to destroy DeepFilter processor', error);
		}
		activeTrack = null;
		activeProcessor = null;
		logger.debug('Removed DeepFilterNet3 noise suppression');
	}
}

export function setDeepFilterEnabled(enabled: boolean): void {
	if (activeProcessor) {
		const result = activeProcessor.setEnabled(enabled);
		void Promise.resolve(result).catch((error) => {
			logger.warn('Failed to set DeepFilter enabled state', error);
		});
		logger.debug('Set DeepFilter enabled', {enabled});
	}
}

export function isDeepFilterActive(): boolean {
	return activeProcessor != null;
}

export function isDeepFilterAppliedToTrack(track?: LocalAudioTrack | null): boolean {
	return activeProcessor != null && activeTrack === (track ?? null);
}
