// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect, it} from 'vitest';
import {EgorpFft} from './EgorpFft';

it('matches the direct complex DFT for a mixed-radix window', () => {
	const size = 15;
	const real = Float64Array.from({length: size}, (_, i) => Math.sin(i * 0.31));
	const imag = Float64Array.from({length: size}, (_, i) => Math.cos(i * 0.73));
	const fft = new EgorpFft(size);
	fft.transform(real, imag);
	for (let k = 0; k < size; k++) {
		let re = 0;
		let im = 0;
		for (let j = 0; j < size; j++) {
			const angle = (-2 * Math.PI * k * j) / size;
			re += real[j] * Math.cos(angle) - imag[j] * Math.sin(angle);
			im += real[j] * Math.sin(angle) + imag[j] * Math.cos(angle);
		}
		expect(fft.real[k]).toBeCloseTo(re, 10);
		expect(fft.imag[k]).toBeCloseTo(im, 10);
	}
});
it('roundtrips the 960-point model window without scale or phase errors', () => {
	const real = Float64Array.from({length: 960}, (_, i) => Math.sin(i * 0.19));
	const imag = Float64Array.from({length: 960}, (_, i) => Math.cos(i * 0.37));
	const fft = new EgorpFft(960);
	fft.transform(real, imag);
	fft.transform(fft.real.slice(), fft.imag.slice(), true);
	for (let i = 0; i < 960; i++) {
		expect(fft.real[i]).toBeCloseTo(real[i], 10);
		expect(fft.imag[i]).toBeCloseTo(imag[i], 10);
	}
});
it('rejects aliased buffers instead of corrupting the transform', () => {
	const fft = new EgorpFft(960);
	expect(() => fft.transform(fft.real)).toThrow('alias');
});
