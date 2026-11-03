# Procedure Scribe | AppADay 160

Turn a dictated audio or video recording into an edited training module, SOP, or lecture outline. The recording is transcribed entirely in the browser by Whisper; the app then builds a ready made prompt you paste into Claude, and turns Claude's Markdown back into Word, Markdown, or plain text.

Live: https://augustineiacopelli.github.io/appaday-160-procedure-scribe/

## How it works

1. **Intake.** Drop or pick an mp4, mov, m4a, mp3, or wav. The type is detected from the extension and MIME together. Recordings over 30 minutes need a second tap. Already have a transcript? Drop a .txt, .vtt, or .srt file instead (Teams and Zoom caption exports work, with speaker names kept) and the app skips straight to Prompt.
2. **Extract.** ffmpeg.wasm reads the file in place (WORKERFS) and pulls out 10 minute segments of 16 kHz mono audio, one segment in memory at a time. If ffmpeg cannot start, files under 100 MB fall back to the browser's own decoder.
3. **Transcribe.** Whisper tiny or base runs in a blob module worker on WebGPU when an adapter exists, otherwise on WASM. Timestamps are offset to absolute time and segments overlap by 5 seconds so no word is lost at a boundary. Copy or download the raw transcript with no network call at all.
4. **Prompt.** Pick Training module, SOP, or Lecture outline. The transcript is wrapped in `<transcript>` tags with rules that treat it as data. Copy the prompt and open Claude, or, if you add an API key in Settings, send it directly.
5. **Finish.** Paste the result, edit it, preview it, and download .docx, .md, or .txt.

## Privacy

There is no upload path. Every runtime request goes to this site (the app, its vendored libraries, and the model files), plus `api.anthropic.com` only when you choose to send with an API key. Nothing you create is written to browser storage; Clear wipes the page, the audio engine, the speech worker, and the key. The service worker caches only the app's own code, and Transformers.js caches model weights.

## Repository

`index.html` (whole app), `sw.js`, `vendor/` (pinned libraries and fonts), `models/` (whisper tiny and base ONNX files at pinned commits), `tests/` (fixtures, smoke and acceptance tests), `scripts/` (vendor, manifest check, fixtures, gates), `spikes/` (Gate 1 and Gate 2 pages and evidence), `.github/` (integrity check, weekly smoke test, gates, vendoring, Dependabot). See `VERSIONS.md` for every pinned version and the upgrade procedure.

## Testing

```
npm ci --ignore-scripts
python3 -m http.server 8080 &
BASE_URL=http://127.0.0.1:8080/ npx playwright test smoke
BASE_URL=http://127.0.0.1:8080/ npx playwright test acceptance
node tests/prompt.unit.mjs && node scripts/verify-manifest.mjs
```

## License

MIT. See `LICENSE`.

Part of [AppADay](https://augustineiacopelli.github.io/appaday/).
