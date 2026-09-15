// SPDX-License-Identifier: AGPL-3.0-or-later

import {EgorpFft} from './EgorpFft.ts';

export const DPDF_SAMPLE_RATE = 48000;
export const DPDF_WINDOW_SIZE = 960;
export const DPDF_HOP_SIZE = 480;
export const DPDF_SPECTRUM_SIZE = 481;

export type DpdfInference = (spectrum: Float32Array) => Promise<Float32Array>;

/** Causal STFT/overlap-add frontend. Run inference in a Worker, never the audio callback. */
export class DpdfStreamingCore {
	private readonly fft = new EgorpFft(DPDF_WINDOW_SIZE);
	private readonly window = Float32Array.from({length: DPDF_WINDOW_SIZE}, (_, i) => {
		const sine = Math.sin((Math.PI * (i + 0.5)) / DPDF_WINDOW_SIZE);
		return Math.sin(0.5 * Math.PI * sine * sine);
	});
	private readonly input = new Float32Array(DPDF_WINDOW_SIZE);
	private readonly windowed = new Float32Array(DPDF_WINDOW_SIZE);
	private readonly overlap = new Float32Array(DPDF_WINDOW_SIZE);
	private readonly spectrum = new Float32Array(DPDF_SPECTRUM_SIZE * 2);
	private readonly inverseReal = new Float64Array(DPDF_WINDOW_SIZE);
	private readonly inverseImag = new Float64Array(DPDF_WINDOW_SIZE);
	private readonly infer: DpdfInference;
	private readonly resetModel: () => void;
	private receivedFirstHop = false;
	private busy = false;
	private failed = false;

	constructor(infer: DpdfInference, resetModel: () => void = () => undefined) {
		this.infer = infer;
		this.resetModel = resetModel;
	}

	reset(): void {
		if (this.busy) throw new Error('Cannot reset Egorp during inference');
		this.resetModel();
		this.input.fill(0);
		this.overlap.fill(0);
		this.receivedFirstHop = false;
		this.failed = false;
	}

	async processHop(hop: Float32Array): Promise<Float32Array> {
		if (this.busy) throw new Error('Concurrent Egorp inference would corrupt model state');
		if (this.failed) throw new Error('Egorp requires reset after inference failure');
		if (hop.length !== DPDF_HOP_SIZE) throw new Error('Egorp expects 480-sample hops');
		for (const sample of hop) if (!Number.isFinite(sample)) throw new Error('Non-finite Egorp input');
		this.busy = true;
		try {
			this.input.copyWithin(0, DPDF_HOP_SIZE);
			this.input.set(hop, DPDF_HOP_SIZE);
			if (!this.receivedFirstHop) {
				this.receivedFirstHop = true;
				return new Float32Array(DPDF_HOP_SIZE);
			}
			for (let i = 0; i < DPDF_WINDOW_SIZE; i++) this.windowed[i] = this.input[i] * this.window[i];
			this.fft.transform(this.windowed);
			for (let k = 0; k < DPDF_SPECTRUM_SIZE; k++) {
				this.spectrum[2 * k] = this.fft.real[k];
				this.spectrum[2 * k + 1] = this.fft.imag[k];
			}
			const enhanced = await this.infer(this.spectrum);
			if (enhanced.length !== this.spectrum.length) throw new Error('Invalid Egorp output spectrum');
			for (const value of enhanced) if (!Number.isFinite(value)) throw new Error('Non-finite Egorp spectrum');
			for (let k = 0; k < DPDF_SPECTRUM_SIZE; k++) {
				this.inverseReal[k] = enhanced[2 * k];
				this.inverseImag[k] = k === 0 || k === DPDF_WINDOW_SIZE / 2 ? 0 : enhanced[2 * k + 1];
				if (k > 0 && k < DPDF_WINDOW_SIZE / 2) {
					this.inverseReal[DPDF_WINDOW_SIZE - k] = this.inverseReal[k];
					this.inverseImag[DPDF_WINDOW_SIZE - k] = -this.inverseImag[k];
				}
			}
			this.fft.transform(this.inverseReal, this.inverseImag, true);
			for (let i = 0; i < DPDF_WINDOW_SIZE; i++) {
				this.overlap[i] += Math.fround(this.fft.real[i] * this.window[i]);
			}
			const result = this.overlap.slice(0, DPDF_HOP_SIZE);
			this.overlap.copyWithin(0, DPDF_HOP_SIZE);
			this.overlap.fill(0, DPDF_HOP_SIZE);
			return result;
		} catch (error) {
			this.failed = true;
			throw error;
		} finally {
			this.busy = false;
		}
	}
}
