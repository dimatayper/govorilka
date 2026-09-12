// SPDX-License-Identifier: AGPL-3.0-or-later

import RuntimeConfig, {DEFAULT_APP_PUBLIC_CONFIG} from '@app/features/app/state/RuntimeConfig';
import GovorilkaPlayerLogo from '@app/media/images/govorilka-player-logo.png';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {type BrandSvgProps, getDataFlx, getImageSizingProps} from './BrandImageUtils';

const APPLICATION_WORDMARK_DESCRIPTOR = msg({
	message: '{productName} wordmark',
	comment: 'Accessible label for the application wordmark.',
});

interface FluxerWordmarkProps extends BrandSvgProps {
	variant?: 'default' | 'monochrome';
}

export const FluxerWordmark = observer(({variant = 'default', ...props}: FluxerWordmarkProps) => {
	const {i18n} = useLingui();
	const productName = RuntimeConfig.productName;
	const ariaLabel = i18n._(APPLICATION_WORDMARK_DESCRIPTOR, {productName});
	if (RuntimeConfig.wordmarkUrl) {
		return (
			<img
				{...getImageSizingProps(props)}
				src={RuntimeConfig.wordmarkUrl}
				alt={ariaLabel}
				data-flx={getDataFlx(props, 'ui.icons.fluxer-wordmark.img')}
			/>
		);
	}
	const style: React.CSSProperties = {
		...(props.style as React.CSSProperties | undefined),
		alignItems: 'center',
		display: 'inline-flex',
		fontWeight: 800,
		lineHeight: 1,
		gap: '0.35em',
	};
	return (
		<span
			className={props.className}
			style={style}
			role="img"
			aria-label={ariaLabel}
			data-variant={variant}
			data-flx={getDataFlx(props, 'ui.icons.fluxer-wordmark.text')}
		>
			{productName === DEFAULT_APP_PUBLIC_CONFIG.branding.product_name && (
				<img src={GovorilkaPlayerLogo} alt="" aria-hidden="true" style={{height: '1.35em', width: '1.35em'}} />
			)}
			{productName}
		</span>
	);
});
