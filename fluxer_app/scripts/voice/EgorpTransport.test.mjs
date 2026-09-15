// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createEgorpTransportProcessor} from '../../src/features/voice/worklets/EgorpTransportProcessor.js';

function fixture() {
 const messages = [];
 const queued = [];
 class Base { port = {postMessage: (data) => messages.push(data), close() {}}; }
 const Processor = createEgorpTransportProcessor({AudioWorkletProcessor: Base, sampleRate: 48000});
 const node = new Processor();
 const port = {postMessage: (data) => queued.push(data), start() {}, close() {}};
 node.port.onmessage({data: {type: 'connect', port}});
 const flush = () => {while (queued.length) port.onmessage({data: queued.shift()});};
 return {node, messages, port, queued, flush};
}

for (const quantum of [64,128,256,480,512]) {
 test(`fixed sample timeline survives ${quantum}-sample callbacks and Worker jitter`, () => {
  const f = fixture();
  const input = Float32Array.from({length: quantum * 100}, (_, i) => Math.sin(i / 71));
  const rendered = new Float32Array(input.length);
  for (let offset=0; offset<input.length; offset+=quantum) {
   // Deliver asynchronously only every other render callback.
   if ((offset / quantum) % 2 === 0) f.flush();
   const output = new Float32Array(quantum);
   f.node.process([[input.subarray(offset, offset+quantum)]], [[output]]);
   rendered.set(output, offset);
  }
  assert.equal(f.messages.some(m=>m.type==='error'), false);
  assert.deepEqual(rendered.subarray(1920), input.subarray(0,input.length-1920));
 });
}
test('missed deadline emits one error and silence without accumulating latency', () => {
 const f=fixture();
 for(let i=0;i<30;i++) f.node.process([[new Float32Array(128).fill(1)]],[[new Float32Array(128)]]);
 assert.equal(f.messages.filter(m=>m.type==='error').length,1);
 const out=new Float32Array(128).fill(2);
 f.node.process([],[[out]]);
 assert.ok(out.every(v=>v===0));
});
test('replayed Worker frame is rejected', () => {
 const f=fixture();
 f.node.process([[new Float32Array(480)]],[[new Float32Array(480)]]);
 const reply=f.queued[0];
 f.flush();
 f.port.onmessage({data:reply});
 assert.equal(f.messages.filter(m=>m.type==='error').length,1);
});
