// SPDX-License-Identifier: AGPL-3.0-or-later

import type {SVGProps} from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const iconProps = {
	viewBox: '0 0 24 24',
	fill: 'none',
	stroke: 'currentColor',
	strokeLinecap: 'round',
	strokeLinejoin: 'round',
	strokeWidth: 2.25,
	'aria-hidden': true,
} as const;

export function GovorilkaCameraIcon(props: IconProps) {
	return (
		<svg {...iconProps} {...props} data-flx="voice.govorilka-voice-icons.camera-icon">
			<path
				d="M4.75 5h9.5A2.75 2.75 0 0 1 17 7.75v1.18l3.15-2.1A1.2 1.2 0 0 1 22 7.83v8.34a1.2 1.2 0 0 1-1.85 1L17 15.07v1.18A2.75 2.75 0 0 1 14.25 19h-9.5A2.75 2.75 0 0 1 2 16.25v-8.5A2.75 2.75 0 0 1 4.75 5Z"
				fill="currentColor"
				stroke="none"
			/>
		</svg>
	);
}

export function GovorilkaCameraOffIcon(props: IconProps) {
	return (
		<svg {...iconProps} {...props} data-flx="voice.govorilka-voice-icons.camera-off-icon">
			<path
				d="M4.75 5h9.5A2.75 2.75 0 0 1 17 7.75v1.18l3.15-2.1A1.2 1.2 0 0 1 22 7.83v8.34a1.2 1.2 0 0 1-1.85 1L17 15.07v1.18A2.75 2.75 0 0 1 14.25 19h-9.5A2.75 2.75 0 0 1 2 16.25v-8.5A2.75 2.75 0 0 1 4.75 5Z"
				fill="currentColor"
				stroke="none"
			/>
			<path d="M3 3 21 21" stroke="var(--panel-control-bg)" strokeWidth="3.75" />
			<path d="M3 3 21 21" stroke="currentColor" strokeWidth="2.1" />
		</svg>
	);
}

export function GovorilkaScreenShareIcon(props: IconProps) {
	return (
		<svg {...iconProps} {...props} data-flx="voice.govorilka-voice-icons.screen-share-icon">
			<path
				d="M3.5 3h17A2.5 2.5 0 0 1 23 5.5v11a2.5 2.5 0 0 1-2.5 2.5h-17A2.5 2.5 0 0 1 1 16.5v-11A2.5 2.5 0 0 1 3.5 3Z"
				fill="currentColor"
				stroke="none"
			/>
			<path d="M8.5 22h7M12 19v3" />
			<path d="m8.25 11 3.75-3.75L15.75 11M12 7.25v7" stroke="var(--panel-control-bg)" strokeWidth="2.35" />
		</svg>
	);
}

export function GovorilkaAudioProcessingIcon(props: IconProps) {
	return (
		<svg {...iconProps} {...props} data-flx="voice.govorilka-voice-icons.audio-processing-icon">
			<path d="M4 9v6M8 6v12M12 4v16M16 7v10M20 10v4" />
		</svg>
	);
}

export function GovorilkaDisconnectIcon(props: IconProps) {
	return (
		<svg {...iconProps} {...props} data-flx="voice.govorilka-voice-icons.disconnect-icon">
			<path
				d="M3.15 15.8a1.55 1.55 0 0 1-.55-2.35C4.75 10.6 8.15 9 12 9s7.25 1.6 9.4 4.45a1.55 1.55 0 0 1-.55 2.35l-2.65 1.35a1.55 1.55 0 0 1-2.1-.76l-.72-1.6A10.2 10.2 0 0 0 12 14.25c-1.17 0-2.31.18-3.38.54l-.72 1.6a1.55 1.55 0 0 1-2.1.76z"
				fill="currentColor"
				stroke="none"
			/>
		</svg>
	);
}
