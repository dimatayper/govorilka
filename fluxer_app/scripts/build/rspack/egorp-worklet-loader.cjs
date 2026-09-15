// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('node:fs');
const path = require('node:path');

module.exports = function egorpWorkletLoader(source) {
	const processorPath = path.resolve(__dirname, '../../../src/features/voice/worklets/EgorpProcessor.js');
	this.addDependency?.(processorPath);
	const literal = /^var workletCode = (".*");$/m;
	const match = source.match(literal);
	if (!match) throw new Error('Egorp: upstream worklet literal changed; review the pinned dependency');
	const worklet = JSON.parse(match[1]);
	const start = worklet.indexOf('    class DeepFilterAudioProcessor extends AudioWorkletProcessor {');
	const end = worklet.indexOf("    registerProcessor('deepfilter-audio-processor', DeepFilterAudioProcessor);");
	if (start < 0 || end <= start) throw new Error('Egorp: upstream processor boundary changed');
	const processor = fs
		.readFileSync(processorPath, 'utf8')
		.replace('export function createEgorpProcessor', 'function createEgorpProcessor');
	const registration =
		'const DeepFilterAudioProcessor = createEgorpProcessor({AudioWorkletProcessor, sampleRate, initSync, df_create, df_get_frame_length, df_set_atten_lim, df_process_frame});';
	const patched = `${worklet.slice(0, start)}${processor}\n${registration}\n${worklet.slice(end)}`;
	return source.replace(literal, () => `var workletCode = ${JSON.stringify(patched)};`);
};
