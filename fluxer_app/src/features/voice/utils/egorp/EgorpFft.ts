// SPDX-License-Identifier: AGPL-3.0-or-later

/** Preallocated mixed-radix FFT; DPDFNet's 960-point window is not a power of two. */
export class EgorpFft {
	readonly size: number;
	readonly real: Float64Array;
	readonly imag: Float64Array;
	private readonly radix: number;
	private readonly child: EgorpFft | null;
	private readonly scratchReal: Float64Array;
	private readonly scratchImag: Float64Array;
	private readonly cosine: Float64Array;
	private readonly sine: Float64Array;

	constructor(size: number) {
		if (!Number.isInteger(size) || size < 1 || size > 4096) throw new Error('Invalid FFT size');
		this.size = size;
		this.real = new Float64Array(size);
		this.imag = new Float64Array(size);
		this.scratchReal = new Float64Array(size);
		this.scratchImag = new Float64Array(size);
		this.cosine = Float64Array.from({length: size}, (_, i) => Math.cos((2 * Math.PI * i) / size));
		this.sine = Float64Array.from({length: size}, (_, i) => Math.sin((2 * Math.PI * i) / size));
		this.radix = [2, 3, 5].find((factor) => size % factor === 0) ?? size;
		this.child = size > 1 ? new EgorpFft(size / this.radix) : null;
	}

	transform(real: ArrayLike<number>, imag?: ArrayLike<number>, inverse = false): void {
		if (real.length !== this.size || (imag && imag.length !== this.size)) throw new Error('Invalid FFT input length');
		if (real === this.real || real === this.imag || imag === this.real || imag === this.imag) {
			throw new Error('FFT input must not alias output');
		}
		this.run(real, imag, 0, 1, inverse ? 1 : -1);
		if (inverse) {
			for (let i = 0; i < this.size; i++) {
				this.real[i] /= this.size;
				this.imag[i] /= this.size;
			}
		}
	}

	private run(
		real: ArrayLike<number>,
		imag: ArrayLike<number> | undefined,
		offset: number,
		stride: number,
		sign: number,
	): void {
		if (!this.child) {
			this.real[0] = real[offset];
			this.imag[0] = imag?.[offset] ?? 0;
			return;
		}
		const width = this.child.size;
		for (let branch = 0; branch < this.radix; branch++) {
			this.child.run(real, imag, offset + branch * stride, stride * this.radix, sign);
			this.scratchReal.set(this.child.real, branch * width);
			this.scratchImag.set(this.child.imag, branch * width);
		}
		for (let k = 0; k < this.size; k++) {
			let re = 0;
			let im = 0;
			for (let branch = 0; branch < this.radix; branch++) {
				const source = branch * width + (k % width);
				const angle = (branch * k) % this.size;
				const cosine = this.cosine[angle];
				const sine = sign * this.sine[angle];
				re += this.scratchReal[source] * cosine - this.scratchImag[source] * sine;
				im += this.scratchReal[source] * sine + this.scratchImag[source] * cosine;
			}
			this.real[k] = re;
			this.imag[k] = im;
		}
	}
}
