// SPDX-License-Identifier: AGPL-3.0-or-later
// Embedded by egorp-worklet-loader.cjs inside the upstream WASM glue closure.
// Model/glue remain DeepFilterNet3 (MIT OR Apache-2.0); this processor is owned here.
export function createEgorpProcessor({
	AudioWorkletProcessor,
	sampleRate,
	initSync,
	df_create,
	df_get_frame_length,
	df_set_atten_lim,
	df_process_frame,
}) {
	return class DeepFilterAudioProcessor extends AudioWorkletProcessor {
		constructor(options) {
			super();
			this.ready = false;
			this.destroyed = false;
			this.failed = false;
			this.bypass = false;
			this.position = 0;
			try {
				if (sampleRate !== 48000) throw new Error('Egorp requires 48000 Hz');
				const config = options.processorOptions;
				initSync(config.wasmModule);
				this.handle = df_create(new Uint8Array(config.modelBytes), this.strength(config.suppressionLevel));
				this.frameLength = df_get_frame_length(this.handle);
				if (!Number.isInteger(this.frameLength) || this.frameLength < 1 || this.frameLength > 4800) {
					throw new Error('Invalid Egorp model frame length');
				}
				this.frame = new Float32Array(this.frameLength);
				this.output = new Float32Array(this.frameLength);
				// A fixed F-sample delay bridges any AudioWorklet render quantum without gaps.
				// The bypass path traverses the same delay and keeps the model state warm.
				this.ready = true;
				this.port.onmessage = ({data}) => {
					if (data?.type === 'SET_SUPPRESSION_LEVEL') df_set_atten_lim(this.handle, this.strength(data.value));
					if (data?.type === 'SET_BYPASS') this.bypass = Boolean(data.value);
					if (data?.type === 'destroy') {
						this.destroyed = true;
						this.port.close();
					}
				};
				this.port.postMessage({type: 'ready', frameLength: this.frameLength, sampleRate});
			} catch (error) {
				this.fail(error);
			}
		}

		strength(value) {
			return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 80;
		}

		fail(error) {
			if (this.failed) return;
			this.failed = true;
			this.ready = false;
			this.port.postMessage({type: 'error', message: String(error)});
		}

		process(inputs, outputs) {
			const channels = outputs[0];
			if (!channels?.length) return !this.destroyed;
			for (const channel of channels) channel.fill(0);
			if (this.destroyed) return false;
			if (!this.ready) return true;
			const input = inputs[0]?.[0];
			try {
				for (let i = 0; i < channels[0].length; i++) {
					// Emit the previous frame while accumulating the next one. Missing input
					// is silence, not a frozen clock that replays stale speech on reconnect.
					const value = this.output[this.position];
					for (const channel of channels) channel[i] = value;
					const sample = input?.[i] ?? 0;
					this.frame[this.position++] = Number.isFinite(sample) ? sample : 0;
					if (this.position === this.frameLength) {
						const processed = df_process_frame(this.handle, this.frame);
						if (processed.length !== this.frameLength) throw new Error('Invalid Egorp output frame');
						for (let j = 0; j < processed.length; j++) {
							if (!Number.isFinite(processed[j])) throw new Error('Non-finite Egorp output');
						}
						this.output.set(this.bypass ? this.frame : processed);
						this.position = 0;
					}
				}
			} catch (error) {
				for (const channel of channels) channel.fill(0);
				this.fail(error);
			}
			return true;
		}
	};
}
