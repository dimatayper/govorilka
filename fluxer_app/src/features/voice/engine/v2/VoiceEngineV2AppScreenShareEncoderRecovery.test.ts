// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import ScreenShareCodecNegotiation from '@app/features/voice/engine/ScreenShareCodecNegotiation';
import {VoiceEngineV2AppScreenShareExecutionAdapter} from '@app/features/voice/engine/v2/VoiceEngineV2AppScreenShareExecutionAdapter';
import type {LocalParticipant, LocalVideoTrack, Room} from 'livekit-client';
import {afterEach, expect, it, vi} from 'vitest';

vi.mock('@app/app/I18n', () => ({default: {_: (value: unknown) => value}}));
vi.mock('@lingui/core/macro', () => ({msg: (value: unknown) => value}));
vi.mock('@app/features/app/components/alerts/GenericErrorModal', () => ({}));
vi.mock('@app/features/ui/commands/ModalCommands', () => ({}));
vi.mock('@app/features/ui/commands/SoundCommands', () => ({}));
vi.mock('@app/features/notification/utils/SoundUtils', () => ({}));
vi.mock('@app/features/voice/commands/VoiceSettingsCommands', () => ({}));
vi.mock('@app/features/voice/utils/ScreenShareUtils', () => ({}));
vi.mock('@app/features/voice/engine/ScreenShareCodecNegotiation', () => ({
	default: {publishLocalCapabilities: vi.fn(), selectScreenShareCodec: vi.fn()},
}));
vi.mock('@app/features/voice/state/VoiceSettings', () => ({default: {getPreferredScreenShareCodec: () => 'auto'}}));
vi.mock('@app/features/voice/state/LocalVoiceState', () => ({default: {}}));
vi.mock('@app/features/voice/engine/v2/VoiceEngineV2AppScreenShareLiveKitFlows', () => ({
	VoiceEngineV2AppScreenShareLiveKitFlows: class {
		republishActiveShareWithCodec = vi.fn();
	},
}));
vi.mock('@app/features/voice/engine/v2/VoiceEngineV2AppScreenShareStateSync', () => ({}));
vi.mock('@app/features/voice/engine/v2/VoiceEngineV2AppScreenShareTrackPlumbing', () => ({
	VoiceEngineV2AppScreenShareTrackPlumbing: class {},
}));
vi.mock('@app/features/voice/engine/voice_screen_share_manager/NativePermissionGate', () => ({}));
vi.mock('@app/features/voice/engine/voice_screen_share_manager/shared', () => ({
	logger: {warn: vi.fn(), error: vi.fn()},
}));
vi.mock('@app/features/voice/utils/CodecCapabilityDetector', () => ({}));
vi.mock('@app/features/voice/utils/NativeAudioCaptureBridge', () => ({}));
vi.mock('@app/features/voice/utils/LinuxScreenShareAudio', () => ({}));

afterEach(() => vi.restoreAllMocks());

it('republishes using the actual encoder codec without a competing negotiation replacement', async () => {
	const adapter = new VoiceEngineV2AppScreenShareExecutionAdapter();
	const track = {mediaStreamTrack: {}} as LocalVideoTrack;
	const participant = {
		getTrackPublication: () => ({videoTrack: track, options: {videoCodec: 'vp9'}}),
	} as unknown as LocalParticipant;
	const room = {localParticipant: participant} as Room;
	vi.spyOn(adapter, 'isScreenShareTrackPublishedInternal').mockReturnValue(true);
	const republish = vi.spyOn(adapter.liveKitFlows, 'republishActiveShareWithCodec').mockImplementation(async () => {
		await adapter.republishActiveScreenShareForNegotiatedCodecInternal(room, 'h264');
		return true;
	});
	await adapter['correctVerifiedScreenShareCodec'](room, participant, track, {
		kind: 'correct-negotiated',
		requested: 'vp9',
		negotiated: ['vp8'],
		alternative: 'vp8',
	});
	expect(republish).toHaveBeenCalledExactlyOnceWith(room, track, 'vp8');
});

it('performs one replacement when recovery also emits a codec selection change', async () => {
	const adapter = new VoiceEngineV2AppScreenShareExecutionAdapter();
	const track = {} as LocalVideoTrack;
	const participant = {
		getTrackPublication: () => ({videoTrack: track, options: {videoCodec: 'vp9'}}),
	} as unknown as LocalParticipant;
	const room = {localParticipant: participant} as Room;
	vi.spyOn(adapter, 'isScreenShareTrackPublishedInternal').mockReturnValue(true);
	vi.spyOn(ScreenShareCodecNegotiation, 'selectScreenShareCodec').mockReturnValue('vp8');
	vi.spyOn(ScreenShareCodecNegotiation, 'publishLocalCapabilities').mockImplementation(async () => {
		await adapter.republishActiveScreenShareForNegotiatedCodecInternal(room, 'vp8');
		return null;
	});
	const republish = vi.spyOn(adapter.liveKitFlows, 'republishActiveShareWithCodec').mockResolvedValue(true);

	await adapter['recoverActiveScreenShareAfterEncoderFailure'](room, participant, track, 'vp9');

	expect(republish).toHaveBeenCalledExactlyOnceWith(room, track, 'vp8');
	await adapter.republishActiveScreenShareForNegotiatedCodecInternal(room, 'vp8');
	expect(republish).toHaveBeenCalledTimes(2);
});

it('bounds codec corrections for the same captured source', async () => {
	const adapter = new VoiceEngineV2AppScreenShareExecutionAdapter();
	const source = {};
	const participant = {} as LocalParticipant;
	const room = {localParticipant: participant} as Room;
	vi.spyOn(adapter, 'isScreenShareTrackPublishedInternal').mockReturnValue(true);
	const republish = vi.spyOn(adapter.liveKitFlows, 'republishActiveShareWithCodec').mockResolvedValue(true);
	const stop = vi.spyOn(adapter, 'stopScreenShareAfterEncoderFailure').mockImplementation(() => undefined);
	for (let attempt = 0; attempt < 2; attempt++) {
		await adapter['correctVerifiedScreenShareCodec'](room, participant, {mediaStreamTrack: source} as LocalVideoTrack, {
			kind: 'correct-negotiated',
			requested: 'vp9',
			negotiated: ['vp8'],
			alternative: 'vp8',
		});
	}
	expect(republish).toHaveBeenCalledTimes(1);
	expect(stop).toHaveBeenCalledTimes(1);
});

it('does not stop a replacement share after the failed track was unpublished', () => {
	const adapter = new VoiceEngineV2AppScreenShareExecutionAdapter();
	vi.spyOn(adapter, 'isScreenShareTrackPublishedInternal').mockReturnValue(false);
	const showModal = vi.spyOn(adapter, 'showScreenShareEndedModalInternal').mockImplementation(() => undefined);
	const stop = vi.spyOn(adapter, 'setScreenShareEnabled');

	adapter['stopScreenShareAfterEncoderFailure'](null, {} as LocalParticipant, {} as LocalVideoTrack, 'vp9', 'stalled');

	expect(showModal).not.toHaveBeenCalled();
	expect(stop).not.toHaveBeenCalled();
});
