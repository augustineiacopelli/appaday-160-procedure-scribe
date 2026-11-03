# Versions

Single source of truth for what Procedure Scribe runs. `package.json` pins the libraries; `models/REVISIONS.json` pins the models; `vendor/MANIFEST.json` holds the SHA-256 of every served file and is checked in CI on every push. The About panel's Diagnostics lists the same values at runtime.

| Component | Version | Served from |
| --- | --- | --- |
| App | v1.0.0 | `index.html`, `sw.js` |
| @huggingface/transformers | 3.8.1 | `vendor/transformers/transformers.min.js` |
| onnxruntime-web (bundled in Transformers.js 3.8.1; wasm files from its dist) | 1.22.0-dev.20250409-89f8206ba4 | `vendor/ort/` |
| @ffmpeg/ffmpeg | 0.12.15 | `vendor/ffmpeg/ffmpeg.js`, `814.ffmpeg.js` |
| @ffmpeg/core (single thread) | 0.12.10 | `vendor/ffmpeg/ffmpeg-core.js`, `.wasm` |
| @ffmpeg/util | 0.12.2 | `vendor/ffmpeg/util.js` (vendored for completeness; the app reads files through WORKERFS and does not call it) |
| docx | 9.10.0 | `vendor/docx/docx.iife.js` |
| @fontsource Big Shoulders Display, Archivo, Space Mono | 5.3.0 | `vendor/fonts/` |

| Model | Upstream | Commit | Files served |
| --- | --- | --- | --- |
| whisper-tiny | onnx-community/whisper-tiny | ff4177021cc41f7db950912b73ea4fdf7d01d8e7 | config, tokenizer, `encoder_model.onnx` (fp32, WebGPU), `encoder_model_quantized.onnx` (q8, WASM), `decoder_model_merged_quantized.onnx` (q8, both) |
| whisper-base | onnx-community/whisper-base | 1846881b6b3a3024392c1eea3ad983695bc23925 | same set |
| whisper-small | not shipped in v1 | none | Deferred until a Hugging Face mirror exists (Open decision 4) |

Runtime configuration decided in Gate 2 (evidence in `spikes/results/`): on a machine with a WebGPU adapter, whisper-base runs its fp32 encoder on WebGPU and its q8 merged decoder on WASM; everything else, including whisper-tiny on every machine, runs q8 on WASM. Transformers.js 4.3.1 failed to load the same local model folder, so the app stays on 3.8.1.

Vendored: 2026-10-14.
Last smoke test passed by hand: 2026-10-14.

## Upgrade procedure

1. On a branch, change the version in `package.json` (Dependabot PRs are never merged directly; they only signal that an upgrade exists).
2. `npm ci && node scripts/vendor.mjs`, then run the Vendor models and fixtures workflow if model files change.
3. Run the Gates workflow and compare `spikes/results/ci-chromium.json` against the previous run: same chunk count, same text.
4. Run the smoke test and `npx playwright test acceptance` against a local server (`BASE_URL=http://127.0.0.1:8080/`).
5. Update this file, merge, and tag a new release. Rolling back means checking out the last good tag and pushing it to `main`.
