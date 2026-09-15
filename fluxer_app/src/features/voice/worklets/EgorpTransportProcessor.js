// SPDX-License-Identifier: AGPL-3.0-or-later

/** No inference here. A fixed timeline bounds latency and rejects stale Worker audio. */
export function createEgorpTransportProcessor({AudioWorkletProcessor, sampleRate}) {
	return class EgorpTransportProcessor extends AudioWorkletProcessor {
		constructor() {
			super();
			this.hop = 480;
			this.capacity = 8;
			this.prefill = 4 * this.hop;
			this.position = 0;
			this.sequence = 0;
			this.input = new Float32Array(this.hop);
			this.output = Array.from({length: this.capacity}, () => new Float32Array(this.hop));
			this.tags = new Float64Array(this.capacity).fill(-1);
			this.pending = 0;
			this.failed = false;
			this.destroyed = false;
			this.workerPort = null;
			this.port.onmessage = ({data}) => {
				if (data?.type === 'destroy') {
					this.destroyed = true;
					this.workerPort?.close();
					this.port.close();
				} else if (data?.type === 'connect' && !this.workerPort && !this.failed) {
					this.workerPort = data.port;
					this.workerPort.onmessage = ({data: reply}) => this.receive(reply);
					this.workerPort.start();
					this.port.postMessage({type: 'ready', transportDelaySamples: this.prefill});
				}
			};
			if (sampleRate !== 48000) this.fail('Egorp transport requires 48000 Hz');
		}

		fail(message) {
			if (this.failed || this.destroyed) return;
			this.failed = true;
			this.port.postMessage({type: 'error', message});
			this.workerPort?.close();
		}

		receive(reply) {
			if (this.failed || this.destroyed) return;
			if (reply?.type === 'error') return this.fail(reply.message);
			if (reply?.type !== 'hop') return this.fail('Unexpected Egorp Worker response');
			const {sequence, samples} = reply;
			const earliest = Math.max(0, Math.floor((this.position - this.prefill) / this.hop));
			if (
				!Number.isSafeInteger(sequence) ||
				sequence < earliest ||
				sequence >= this.sequence ||
				!(samples instanceof Float32Array) ||
				samples.length !== this.hop ||
				this.pending < 1
			) {
				return this.fail('Invalid or late Egorp Worker response');
			}
			const slot = sequence % this.capacity;
			if (this.tags[slot] !== -1) return this.fail('Egorp output buffer overflow');
			for (const value of samples) if (!Number.isFinite(value)) return this.fail('Non-finite Egorp audio');
			this.output[slot].set(samples);
			this.tags[slot] = sequence;
			this.pending--;
		}

		process(inputs, outputs) {
			for (const channel of outputs[0] ?? []) channel.fill(0);
			if (this.destroyed) return false;
			if (this.failed || !this.workerPort) return true;
			const channels = outputs[0];
			if (!channels?.length) return true;
			const input = inputs[0]?.[0];
			for (let i = 0; i < channels[0].length; i++) {
				const sample = input?.[i] ?? 0;
				if (!Number.isFinite(sample)) {
					this.fail('Non-finite Egorp input');
					break;
				}
				this.input[this.position % this.hop] = sample;
				if (this.position >= this.prefill) {
					const playback = this.position - this.prefill;
					const sequence = Math.floor(playback / this.hop);
					const slot = sequence % this.capacity;
					if (this.tags[slot] !== sequence) {
						this.fail('Egorp Worker missed the audio deadline');
						break;
					}
					const value = this.output[slot][playback % this.hop];
					for (const channel of channels) channel[i] = value;
					if (playback % this.hop === this.hop - 1) this.tags[slot] = -1;
				}
				this.position++;
				if (this.position % this.hop === 0) {
					if (this.pending >= this.capacity) {
						this.fail('Egorp Worker input buffer overflow');
						break;
					}
					const samples = this.input;
					this.input = new Float32Array(this.hop);
					this.pending++;
					this.workerPort.postMessage({type: 'hop', sequence: this.sequence++, samples}, [samples.buffer]);
				}
			}
			return true;
		}
	};
}
