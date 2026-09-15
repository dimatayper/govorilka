// SPDX-License-Identifier: AGPL-3.0-or-later
// Usage: node RunEgorpBrowserSmoke.mjs URL PLAYWRIGHT_MODULE CHROME_BINARY OUTPUT_JSON [DURATION_MS] [RATE]
import {writeFile} from 'node:fs/promises';
const [url, playwrightPath, executablePath, output, durationArg, rateArg] = process.argv.slice(2);
const durationMs = Number(durationArg ?? 12000);
if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 3600000) throw new Error('Invalid duration');
const rates = rateArg ? [Number(rateArg)] : [48000,44100];
const {chromium} = await import(playwrightPath);
const browser = await chromium.launch({executablePath, headless: true, args:['--autoplay-policy=no-user-gesture-required']});
try {
 const page = await browser.newPage();
 const pageErrors=[];
 page.on('pageerror',e=>pageErrors.push(e.message));
 await page.exposeFunction('onEgorpProgress', async (progress) => {
  await writeFile(output+'.progress.json', JSON.stringify(progress,null,2)+'\n');
 });
 await page.goto(url);
 const results=[];
 for (const rate of rates) {
  const row=await page.evaluate(({rate,durationMs})=>globalThis.runEgorpSmoke(rate,durationMs),{rate,durationMs});
  results.push(row);
  console.log(JSON.stringify(row));
 }
 const report={browser:await browser.version(),scope:'Production audio graph, real Worker/WASM and AudioWorklet; app settings and logger stubbed. No microphone or live call.',pageErrors,results};
 await writeFile(output,JSON.stringify(report,null,2)+'\n');
 if(pageErrors.length || results.some(r=>r.errors.length || r.nonfinite || r.frames < r.captureRate*(durationMs/1000-1) || !(r.rms>0) || r.trackState!=='ended')) throw new Error('Egorp browser smoke failed');
} finally {await browser.close();}
