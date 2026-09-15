// SPDX-License-Identifier: AGPL-3.0-or-later
// Standalone smoke test substitutes only app settings/logging; audio graph is production code.
export function createVoiceAudioContext(options: AudioContextOptions): AudioContext {
	return new AudioContext(options);
}
export class Logger {
	info() {}
	debug() {}
	warn() {}
}
export default {staticCdnEndpoint: '/unused-legacy-assets', getDeepFilterNoiseSuppressionLevel: () => 80};
