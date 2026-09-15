# Egorp (Егорп)

Egorp is the app's local full-band speech denoising mode, using the bundled
DPDFNet2 48 kHz HR model in a dedicated Worker. Select Egorp in Settings → Voice → Noise suppression.
The persisted backend remains `deep_filter`, so saved preferences and rollout
assignments retain compatibility. This is an integration of an existing trained
model, not a newly trained model or a demonstrated equivalent of Krisp.

## Reference research (2026-09-15)

- [Krisp in Discord](https://krisp.ai/discord/): AI suppression integrated into calls.
- [Krisp SDK](https://sdk-docs.krisp.ai/docs/getting-started): real-time models;
  on-device and server deployment are supported.
- [Krisp BVC](https://sdk-docs.krisp.ai/docs/krisp-rtc-bvc-nc): a separate model
  removes competing voices, noise and reverberation without voice enrollment;
  it operates at 32 kHz and is optimized for headsets. These SDK capabilities
  should not all be assumed to be enabled in Discord.
- [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet): open speech enhancement
  using spectral processing and learned multi-frame deep filtering at 48 kHz.
  It supplied the initial baseline model. It does not identify the
  intended speaker and is not a replacement for a dedicated BVC model.

Krisp's exact model weights, training corpus and architecture are not published
in these sources. Its quality cannot be recreated or verified by copying settings.

## Implemented pipeline

Microphone → existing capture echo cancellation and input controls → mono stream
bridge → **48 kHz context: 60 Hz high-pass → Egorp DPDFNet2 Worker → peak compressor**
→ transmitted microphone track. The microphone test uses the same chain.

The previous implementation crossed MediaStreams between each processing stage.
The new implementation keeps filtering and compression on one clock with one
capture bridge. Audio inference stays on-device. The model and ONNX WASM are
bundled as content-hashed application assets; the model SHA-256 is verified
before inference. No new audio upload is introduced.

Startup is bounded to 30 seconds and accepts cancellation (the legacy
DeepFilterNet comparison path retains an eight-second timeout). Late model startup
is discarded after cancellation/timeout. Every owned track, node and context is
released on failure/disposal. Unsupported model rates fail explicitly. A model
startup failure preserves microphone input without neural suppression and is
logged; retry is enabled when suppression configuration changes. Runtime
processor errors trigger the existing voice processor rebuild with this backend
excluded until suppression configuration changes (audio continues without neural
suppression). The capture context belongs to the caller and is never closed here.

Browser noise suppression remains disabled when neural suppression is selected;
echo cancellation remains a separate existing capture setting. No extra hard gate
has been added. A dynamics compressor is not a true-peak brickwall limiter.

## Scope and limits of quality claims

Public Krisp demo pairs and an initial clean/noisy sample have now been measured
(see below). No real-microphone or blind listening results are available.
Unit tests validate wiring and lifetime, not speech quality.
The user accepted the demonstrated model quality (see the acceptance record below).
A broader, independently validated Krisp-parity claim would require:

1. Use identical clean Russian and English speech, including quiet speech,
   word onsets/endings, laughter and multiple speakers. Mix keyboard, fan,
   traffic, dishes, music and competing voices separately at -5/0/5/10/20 dB SNR.
2. Feed the identical mixture through Egorp and the chosen Discord/Krisp version
   using a virtual microphone, fixed capture gain and identical echo/AGC settings.
   Record versions, hardware, microphone, settings and asset hashes.
3. Save unprocessed and both processed outputs. Compensate measured algorithmic
   delay before comparing aligned speech. Avoid output normalization that hides
   voice attenuation; use a separately documented listening-level adjustment.
4. Measure speech distortion (SI-SDR), intelligibility (STOI), noise attenuation
   during speech and pauses, and clean-speech degradation. Perform blind paired
   listening for robotic artifacts, consonant loss and residual transient noise.
5. Measure end-to-end added delay, CPU and underruns during a 30-minute call on
   representative low-end Windows/macOS/Linux and browser devices. Test device
   switching, 44.1/48 kHz capture, muted capture and unavailable model assets.
6. Agree acceptance margins before evaluation. Require no material regression
   against the reference per noise category, especially quiet speech and competing
   voices, plus a measured real-time latency/CPU budget. Report failures rather
   than averaging them away.

Dedicated competing-speaker isolation and incoming-stream suppression are
**not implemented**. General dereverberation and Krisp-level quality are
**not established** by the current measurements. They require additional model
work and evaluation beyond the demonstrated outgoing noise suppression.

## Initial DeepFilterNet baseline evaluation

The owned `EgorpProcessor.js` replaces the pinned library's embedded processor
through `egorp-worklet-loader.cjs`. The loader retains upstream WASM bindings and
fails if the dependency's expected boundaries change. Startup waits for an explicit
model-ready signal; initialization errors no longer silently pass the microphone
through. Model frames are buffered with a fixed 480-sample delay independent of
render-quantum size; disconnected inputs advance with silence. The model's WASM
`target_features` contains `simd128`, so Egorp is marked SIMD-required.

Offline tools run the **actual model and transformed worklet**, using a Node VM.
They do not include the capture high-pass/compressor, browser scheduling or AEC.
Keep evaluation recordings and legacy assets outside source control
(`artifacts/egorp/`). The current DPDF model is bundled under source control.

Assets used (downloaded 2026-09-15 from the upstream CDN):

- `https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3/v2/pkg/df_bg.wasm`
  SHA-256 `e133417d08bee384d8e60de27efa91da3d858920ed800d4794d490a177300600`
- `https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3/v2/models/DeepFilterNet3_onnx.tar.gz`
  SHA-256 `c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616`

The app still expects these assets under its configured static endpoint at
`/libs/deepfilternet3/v2/`. Deployment availability remains to be verified.

From the repository root (Node 18+; evaluation Python requires NumPy):

```sh
node --test fluxer_app/scripts/voice/EgorpOffline.test.mjs
python3 -m unittest discover -s fluxer_app/scripts/voice -p 'test_*.py'
node fluxer_app/scripts/voice/EgorpOffline.mjs --input artifacts/egorp/noisy.wav --output artifacts/egorp/egorp.wav --assets artifacts/egorp/assets
node fluxer_app/scripts/voice/EgorpOffline.mjs --input artifacts/egorp/noisy.wav --output artifacts/egorp/upstream.wav --assets artifacts/egorp/assets --upstream
python3 fluxer_app/scripts/voice/evaluate_egorp.py --clean artifacts/egorp/clean.wav --noisy artifacts/egorp/noisy.wav --output artifacts/egorp/egorp.wav --output artifacts/egorp/upstream.wav --report artifacts/egorp/comparison.json
python3 fluxer_app/scripts/voice/compare_krisp_demos.py --directory artifacts/egorp/krisp --report artifacts/egorp/krisp/comparison.json
```

Inputs must be mono 48 kHz PCM16 or float32 WAV. The renderer appends one second
of tail to preserve the complete delayed result. Output sidecars include SHA-256
hashes, frame size, runtime environment and timing. `--quantum 256` exercises a
non-default render size. `--strength 80` selects the current default.

### Measurements on 2026-09-15

Public [DeepFilterNet sample 1](https://rikorose.github.io/DeepFilterNet-Samples/),
`p232_013_{noisy,clean}.wav`, 3.94 seconds:

| Diagnostic | Noisy | Egorp | Upstream library |
| --- | ---: | ---: | ---: |
| SI-SDR, dB | 6.724 | 15.776 | 15.776 |
| Aligned signal delay, ms | 0 | 40 | 40.667 |
| Speech projection gain, dB | 0.005 | -0.577 | -0.577 |

The neural output is unchanged after alignment; these fixes improve transport and
failure handling, not the neural model's discrimination. Real model outputs at
128- and 256-sample quanta were identical. On this arm64 Mac / Node 24, offline
real-time factor was approximately 0.07–0.08. Individual render calls reached
~11 ms, exceeding the 128-sample 2.67 ms budget: browser underrun testing and
scheduling optimization remain necessary. Average throughput is not a guarantee
of glitch-free live processing.

Public Krisp [noise cancellation demos](https://krisp.ai/noise-cancellation/)
were found without requiring an account. The site's demo code identifies pairs
at `https://krisp.ai/wp-content/themes/krisp-v4/audios/{name}-{before,after}.mp3`,
for `keyboard`, `fan`, `dog`, `bgvoice`. Local copies were decoded to mono 48 kHz
PCM16 identically with macOS `afconvert`; the `before` files were processed by
Egorp with strength 80. Reference algorithm version/settings are not disclosed.

RMS over 10 ms windows where the Krisp reference is below -50 dBFS:

| Demo | Egorp, dBFS | Krisp demo, dBFS |
| --- | ---: | ---: |
| Keyboard | -63.54 | -62.66 |
| Fan | -63.05 | -59.92 |
| Dog | -57.31 | -59.61 |
| Background voices | -65.20 | -63.89 |

These are **quiet-window energy diagnostics only**. They do not measure speech
preservation, overlapping-speaker separation, nor establish parity. In the dog
sample Egorp leaves more energy in those windows. A mute-all algorithm would
score well on this diagnostic, illustrating why listening and clean-reference
speech metrics are also essential. Full-recording reference-match SI-SDR ranges
from 6.58 to 16.00 dB; it measures similarity to the demo, not perceptual quality.

Next evaluation work: reproducible asset delivery; browser real-time capture and
underrun tests; clean-speech and mixed-speaker corpus; blind listening; candidate
models for speaker isolation. The full Krisp-quality goal remains unproven.

## Stronger model evaluation and JavaScript port (2026-09-15)

A candidate selection study now includes six public paired samples from the
DeepFilterNet examples (`p232_013`, `p232_019`, `p232_028`, `p257_003`, `p257_049`,
`p257_212`), each processed both noisy and clean. This is a small development
corpus, not a held-out population benchmark. Exact inputs, environment versions
and results are in `measurements/egorp-evaluation-*` and
`measurements/egorp-candidate-models-2026-09-15.json`.

[DPDFNet](https://github.com/ceva-ip/DPDFNet), Apache-2.0, is a causal enhancement
model with dual-path recurrent blocks. The 48 kHz two-block candidate is the
model now used by Egorp: the eight-block candidate uses
more computation without a consistent quality advantage in this corpus.

| Engine | Noisy SI-SDR, dB | Noisy ESTOI | Clean SI-SDR, dB | Clean ESTOI |
| --- | ---: | ---: | ---: | ---: |
| Legacy Egorp / DeepFilterNet3 | 12.030 | 0.8457 | 28.867 | 0.9691 |
| DPDFNet2 48 kHz HR | 18.134 | 0.8887 | 21.796 | 0.9796 |
| DPDFNet8 48 kHz HR | 17.970 | 0.8881 | 21.707 | 0.9765 |

Tradeoffs must not be hidden by means: on `p232_028` noisy speech DPDFNet2 ESTOI
falls from 0.7107 to 0.6986; on `p257_049` clean speech it falls from 0.9889 to
0.9645. Clean waveform SI-SDR is lower for DPDFNet across the corpus despite
higher average intelligibility. Blends of the two models were also examined;
none establishes a universally superior result or justifies doubling inference
cost. These results do not establish the requested full quality equivalence.

### Local perceptual score against the Krisp demos

Added `score_egorp_dnsmos.py` using the official
[DNSMOS P.835 and pDNSMOS models](https://github.com/microsoft/DNS-Challenge/tree/master/DNSMOS)
and calibration. All evaluation runs locally. Scores use identical source
lengths, compensate processing delay, and do not normalize output loudness.
Public demos have no clean speech reference or disclosed Krisp build/settings.

| Demo | Krisp DNSMOS OVRL | Legacy DF3 | DPDFNet2 | DPDFNet8 |
| --- | ---: | ---: | ---: | ---: |
| Keyboard | 3.472 | 3.178 | 3.476 | 3.442 |
| Fan | 3.053 | 3.295 | 3.382 | 3.404 |
| Dog | 3.209 | 2.820 | 3.352 | 3.336 |
| Background voices | 3.357 | 2.723 | 3.347 | 3.389 |

The table reproduces the official script's floating-point window ends, including
its skipped one-sample-short windows. P.835 and personalized scores match the
official class exactly on the keyboard reference. Integer-window results are
also preserved separately; the background-voice ranking changes with this
choice, reinforcing that small score differences are not quality equivalence.

Full SIG/BAK/OVRL and personalized predictions, hashes and analysis-window
counts are in `measurements/egorp-krisp-dnsmos-2026-09-15.json`. These predicted
scores support further work on DPDFNet2, but do not replace blind listening or
prove isolation of a particular speaker. Four curated demos are insufficient
for a general parity claim.

### Candidate implementation status

`utils/egorp/DpdfStreamingCore.ts` ports the 960-point Vorbis-window STFT,
480-sample hop, overlap-add and state ownership to TypeScript. `EgorpFft.ts`
uses a preallocated mixed-radix FFT, avoiding the incorrect assumption that a
960-point window can use a power-of-two-only transform. `DpdfOnnxEngine.ts`
loads the pinned model through ONNX Runtime Web WASM, checks SHA-256 and keeps
an independent recurrent state per stream. Concurrent processing/reset and
non-finite model output are rejected. The user-facing Egorp selection now uses this model through a dedicated
Worker and the production audio graph. The persisted `deep_filter` key is unchanged.

Model URL:
`https://huggingface.co/Ceva-IP/DPDFNet/resolve/main/onnx/dpdfnet2_48khz_hr.onnx`

Pinned SHA-256:
`7f0575a5cec0ba4ffd8f8bd657e06d007e4ccdd955d76faab922b9d3291dc14b`

On the first paired sample the TypeScript/WASM output differs from the native
Python streaming reference by only `1.20e-7` peak and `1.18e-8` RMS. SI-SDR,
ESTOI and 50 ms signal delay match. The Node WASM real-time factor is 0.158;
p99 hop processing is 2.32 ms, but cold calls reach 15 ms. This belongs in a
Worker with a bounded audio buffer, not inside the audio rendering callback.

Reproduction (Node 24+ for direct TypeScript execution; use the isolated Python
packages recorded in `measurements/egorp-evaluation-requirements.txt`):

```sh
python3 fluxer_app/scripts/voice/evaluate_models.py --corpus artifacts/egorp/corpus --assets artifacts/egorp/assets --candidates artifacts/egorp/candidates --output artifacts/egorp/model-comparison
python3 fluxer_app/scripts/voice/score_egorp_dnsmos.py --directory artifacts/egorp/krisp --models artifacts/egorp/candidates --output artifacts/egorp/krisp/dnsmos.json
node fluxer_app/scripts/voice/DpdfWasmOffline.mjs --input artifacts/egorp/noisy.wav --output artifacts/egorp/candidates/dpdfnet2-js.wav --model artifacts/egorp/candidates/dpdfnet2_48khz_hr.onnx
```

The Worker/AudioWorklet transport, bundled model delivery and voice-path
integration are implemented below. Preserve the clean-speech regression cases
during further tuning; quality parity remains unproven.

### Worker transport implementation (2026-09-15)

The DPDF candidate now includes `EgorpInferenceWorker.ts`,
`EgorpWorkerSession.ts`, `CreateEgorpWorklet.ts`, and the owned
`EgorpTransportProcessor.js`. The model and Apache-2.0 license are included
under `utils/egorp/models`; Rspack emits the model and ONNX WASM as hashed
assets and copies the license to `licenses/DPDFNet.txt`. Inference warms up for 24 hops before resetting state and reporting
ready. Each Worker owns one model state.

Audio travels through a direct MessageChannel between the AudioWorklet and
Worker. Inference is serial, input buffering is bounded to eight hops, and
playback follows a fixed four-hop timeline. The transport adds 40 ms to the
measured 50 ms model delay, before Web Audio/device latency. Missed deadlines,
invalid sequences, non-finite audio and inference errors report a failure;
they cannot silently accumulate delay or pass unfiltered microphone audio.
Strength zero uses dry audio delayed by five model hops to avoid misaligned
mixing; normal strength controls the allowed dry contribution in dB.

Tests cover different render quanta, delayed delivery, stale replies, queue
bounds, cancellation, timeout, and exactly-once Worker disposal. The standalone
production Rspack build succeeds. The temporary approval-service failure was
resolved on retry with the user's existing permission.

Real headless Chrome tests now exercise the production audio graph, including
capture bridging, filtering, Worker/WASM, output track and cleanup at both
48 kHz and 44.1 kHz. Twelve seconds per rate produced finite nonzero audio,
no Worker/deadline errors, and ended output tracks after disposal. Startup took
237.5 ms and 210.5 ms on this machine. Settings/logging are stubbed in the
standalone harness; no microphone hardware or network call was involved.
See `measurements/egorp-browser-graph-2026-09-15.json` for browser version and
raw results. This verifies graph integration, not quality equivalence or
low-end-device performance.

Build without starting a server:

```sh
cd fluxer_app
node scripts/voice/EgorpBrowserSmoke.mjs --build-only
```

When local server execution is available, run the same command without
`--build-only`, open the printed loopback URL in Chrome, and evaluate
`await runEgorpSmoke()`. This exercises real WASM inference, AudioWorklet and
Worker message transport for 12 seconds. Check for an empty `errors` array,
nonzero finite output, and no processor/Worker errors in the browser console.
This is an integration smoke test, not a listening-quality comparison.

### Extended validation

The browser harness accepts a duration and writes a live progress snapshot:

```sh
node scripts/voice/RunEgorpBrowserSmoke.mjs URL PLAYWRIGHT_MODULE CHROME_BINARY OUTPUT_JSON 1800000 48000
```

This requests 30 minutes of continuous processing. The final JSON is written
only after completion; a `.progress.json` file is **not a passing result**.
An audio failure ends the run early and makes the command fail. The progress
reports contain frame counts, output energy and error messages. They do not
measure end-to-end network-call latency or establish low-end-device performance.

The completed separate evaluation uses nine Russian-language clean/noisy pairs from
[Ceva-IP's evaluation set](https://huggingface.co/datasets/Ceva-IP/DPDFNet_EvalSet),
one per noise scene at 0 dB SNR. Inputs are approximately two minutes each.
The source recordings are 16 kHz, resampled to the model's 48 kHz with
`scipy.signal.resample_poly`, without loudness normalization. Consequently this
corpus cannot validate preservation of original high-frequency content above
8 kHz. The set comes from the model authors and is not an independent held-out
comparison with Krisp. Exact sources, resampling and hashes are recorded in
`measurements/egorp-russian-evaluation-inputs-2026-09-15.json`.

### Blinded listening review

`make_blind_comparison.py` builds a local A/B player from the four official
Krisp outputs and the corresponding DPDFNet2 outputs. It randomizes labels,
aligns processing delay, keeps original loudness and exports reviewer ratings.
The original source is https://krisp.ai/noise-cancellation/. The label key is
written outside the public directory. Preserve the key until the ratings have
been interpreted; regenerating a comparison assigns different labels.

```sh
python3 scripts/voice/make_blind_comparison.py --directory ../artifacts/egorp/krisp --output ../artifacts/egorp/browser/listening --key ../artifacts/egorp/listening-key.json
```

Serve this directory with the existing loopback smoke-test server and open
`/listening/index.html`. The smoke build preserves generated listening files in its output folder. Ratings remain in local browser storage until
exported, with no submission endpoint. The Egorp audio here is model output;
it does not include the capture high-pass/compressor or network-call processing.
The controls and layout were verified in the in-app browser. No structured, scored human listening
ratings have been collected, and this four-demo review alone cannot prove
general quality parity.

### User listening acceptance (2026-09-15)

After listening to the local A/B comparison, the user said the result generally
satisfies them if the tested model is ready to embed. Verified that the listening
comparison uses `dpdfnet2_48khz_hr`, and its model file is byte-identical to the
one already wired into the Egorp call path (SHA-256 recorded above). This records
the user's qualitative acceptance, not a formal population-level Krisp parity
claim. The comparison contains raw model output; the call graph additionally
includes capture processing, high-pass filtering and peak compression. Further
model replacement is not needed for this accepted result. The continuous 30-minute soak test subsequently completed successfully.

### Russian evaluation results

All 54 renders completed: nine scenes × clean/noisy input × three evaluated
models. The accepted DPDFNet2 model improves noisy-speech ESTOI over the legacy
DeepFilterNet3 baseline on this corpus. Results retain clean-speech tests, rather
than assuming that a noise-removal score also proves preservation of speech.

| Engine | Noisy SI-SDR, dB | Noisy ESTOI | Clean SI-SDR, dB | Clean ESTOI |
| --- | ---: | ---: | ---: | ---: |
| Legacy DeepFilterNet3 | 8.773 | 0.6899 | 31.055 | 0.9832 |
| Accepted Egorp / DPDFNet2 | 10.758 | 0.7779 | 30.915 | 0.9983 |

Full per-scene results, including the unselected DPDFNet8 candidate, are in
`measurements/egorp-russian-evaluation-results-2026-09-15.json`. Timing was
collected while the separate browser soak was running on the same machine.
No model change follows this evaluation: the user accepted DPDFNet2's listening
result.

The microphone-test path now propagates runtime model errors to stop the test
and cancels model initialization when the test closes. Tests cover late
`getUserMedia` results and late graph completion after cancellation, ensuring
that neither can restart monitoring or retain its tracks.

## Delivery verification (2026-09-15)

- **Name:** Egorp is the displayed name and is searchable in voice settings.
- **Accepted audio model:** the A/B model and bundled call model are byte-identical
  DPDFNet2 48 kHz HR, verified by SHA-256. The user accepted its demonstrated sound.
- **Call path:** the `deep_filter` preference now builds the DPDF Worker chain;
  microphone monitoring uses the same builder. Startup failure preserves input;
  runtime failure rebuilds the voice processor without the failed backend.
- **Browser execution:** real graph tests passed at 48/44.1 kHz, including a
  separate build that applies the application's ES2015 compilation target to
  both TypeScript and JavaScript. See `egorp-browser-es2015-2026-09-15.json`.
- **Continuous processing:** the 30-minute run completed in 1,800,011.7 ms with
  86,401,024 captured frames, zero non-finite samples, zero Worker/deadline errors,
  and an ended output track after disposal. See
  `measurements/egorp-browser-soak-2026-09-15.json`. This run used the original
  ES2022 standalone build; the ES2015 build was separately tested at both rates.
- **Tests:** 91 targeted Vitest cases and 19 actual-worklet Node tests pass.
  Formatting and whitespace checks pass. Full-project TypeScript checking is
  still blocked by pre-existing missing generated modules and unrelated
  screen-sharing test errors; it reports no errors in the changed Egorp or
  microphone-test code. No successful full-application build is claimed.
- **Delivery:** the model and its Apache-2.0 license are included; the application
  build copies the license into `licenses/DPDFNet.txt`. Audio inference remains
  local. No deployment or real microphone/network call was performed.

The delivered result meets the user's listening acceptance. The broader research
criteria above describe limits on claiming universal Krisp equivalence; they are
not a claim that every speaker, noise condition or device has been validated.
