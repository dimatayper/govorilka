// SPDX-License-Identifier: AGPL-3.0-or-later
// Test the deployed Worker itself: a separately bundled smoke entry can hide build bugs.
// Usage: node RunEgorpDeployedWorkerSmoke.mjs WORKER_URL PLAYWRIGHT_MODULE CHROME_BINARY
const [workerUrl, playwrightPath, executablePath] = process.argv.slice(2);
const {chromium} = await import(playwrightPath);
const browser = await chromium.launch({executablePath, headless: true});
try {
	const page = await browser.newPage();
	await page.goto(new URL('/', workerUrl).href);
	const result = await page.evaluate(async (url) => {
		const worker = new Worker(url);
		const channel = new MessageChannel();
		let timeout;
		try {
			return await new Promise((resolve, reject) => {
				timeout = setTimeout(() => reject(new Error('Deployed Egorp Worker timed out')), 30000);
				worker.onerror = (event) => reject(new Error(event.message));
				let sequence = 0;
				let energy = 0;
				const sendHop = () => {
					const samples = Float32Array.from(
						{length: 480},
						(_, i) => 0.1 * Math.sin((2 * Math.PI * 220 * (sequence * 480 + i)) / 48000),
					);
					channel.port2.postMessage({type: 'hop', sequence, samples}, [samples.buffer]);
				};
				channel.port2.onmessage = ({data}) => {
					if (data.type !== 'hop' || data.sequence !== sequence || data.samples?.length !== 480) {
						reject(new Error(data.message ?? 'Invalid output hop'));
						return;
					}
					for (const sample of data.samples) {
						if (!Number.isFinite(sample)) {
							reject(new Error('Non-finite output'));
							return;
						}
						energy += sample * sample;
					}
					if (++sequence === 100) {
						if (!(energy > 0)) reject(new Error('Silent output'));
						else resolve({status: 'passed', hops: sequence, energy});
					} else sendHop();
				};
				worker.onmessage = ({data}) => {
					if (data.type === 'error') reject(new Error(data.message));
					else if (data.type === 'ready') sendHop();
				};
				worker.postMessage({type: 'initialize', strength: 100, port: channel.port1}, [channel.port1]);
			});
		} finally {
			clearTimeout(timeout);
			worker.terminate();
			channel.port2.close();
		}
	}, workerUrl);
	console.log(JSON.stringify(result));
} finally {
	await browser.close();
}
