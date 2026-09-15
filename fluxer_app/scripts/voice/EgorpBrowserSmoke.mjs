// SPDX-License-Identifier: AGPL-3.0-or-later
// Build and serve the actual Egorp worker without the rest of the application.
import {createRequire} from 'node:module';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {createServer} from 'node:http';
const require = createRequire(import.meta.url);
const {rspack} = require('@rspack/core');
const output = resolve('../artifacts/egorp/browser');
await mkdir(output, {recursive: true});
const compiler = rspack({
 mode: 'production', context: process.cwd(), entry: './scripts/voice/EgorpBrowserSmoke.ts',
 output: {path: output, filename: 'entry.js', publicPath: '/', workerPublicPath: '/', workerChunkLoading: 'import-scripts', clean: false},
 resolve: {extensions: ['.ts','.js'], alias: {...Object.fromEntries(['features/app/state/RuntimeConfig','features/platform/utils/AppLogger','features/voice/engine/VoiceSharedAudioContext','features/voice/state/VoiceSettings'].map(name=>['@app/'+name+'$',resolve('scripts/voice/EgorpBrowserEnvironment.ts')])), '@app': resolve('src')}},
 module: {rules: [
  {test: /\.(ts|js)$/, exclude: /node_modules/, loader: 'builtin:swc-loader', options: {jsc: {parser: {syntax:'typescript'}, target:'es2015'}}},
  {test: /\.(wasm|onnx)$/, type: 'asset/resource', generator: {filename:'assets/[name].[contenthash][ext]'}},
 ]},
 plugins: [new rspack.DefinePlugin({'import.meta.env.PUBLIC_BUILD_VERSION':JSON.stringify('dev')})],
});
await new Promise((res,rej)=>compiler.run((err,stats)=>err?rej(err):stats.hasErrors()?rej(new Error(stats.toString({all:false,errors:true}))):res()));
await new Promise(res=>compiler.close(res));
await writeFile(resolve(output,'index.html'), '<!doctype html><html><body>Egorp browser validation<script src="/entry.js"></script></body></html>');
if (process.argv.includes('--build-only')) {
 console.log(JSON.stringify({output, status:'built'}));
 process.exit(0);
}
const server = createServer(async (req,res)=>{
 try {
  const path = req.url === '/noisy.wav' ? resolve('../artifacts/egorp/noisy.wav') : resolve(output, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!path.startsWith(output + '/') && path !== resolve('../artifacts/egorp/noisy.wav')) throw new Error('Invalid path');
  res.setHeader('Content-Type', {'.js':'text/javascript','.wasm':'application/wasm','.html':'text/html','.wav':'audio/wav'}[extname(path)] ?? 'application/octet-stream');
  res.end(await readFile(path));
 } catch {res.statusCode=404;res.end();}
});
await new Promise(res=>server.listen(0,'127.0.0.1',res));
console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,output}));
