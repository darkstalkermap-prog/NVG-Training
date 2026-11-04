# NVG-Training
An NVG simulation of Do's and Don'ts: **AN/PVS-14** monocular night vision device while driving the **M1075A1 PLS**, framed by **AR 600-55** (Army Driver and Operator Standardization Program).

**Video:** [`NVG_PVS-14_PLS_Dos_and_Donts.mp4`](NVG_PVS-14_PLS_Dos_and_Donts.mp4) — 5:00, 1280x720, 30 fps, narrated with captions.

**Interactive player:** [`docs/index.html`](docs/index.html) is a single self-contained page (simulation + narration). GitHub shows `.html` files as source, so to play it in a browser either download it and open it locally, or turn on GitHub Pages (Settings → Pages → Deploy from a branch → this branch, `/docs` folder). The page will then be at `https://darkstalkermap-prog.github.io/NVG-Training/`.

| Time | Segment |
|------|---------|
| 0:00 | Title |
| 0:22 | AR 600-55 NVD driver path (license → NVD training per TC 21-305-2 → annotated on DA Form 5984-E → sustainment) |
| 0:58 | DON'T drive unqualified |
| 1:15 | DO PMCS the PVS-14 |
| 1:36 | DO focus correctly (diopter, then objective) |
| 1:55 | DO drive as a crew (A-driver/TC on NVDs, crew brief) |
| 2:15 | DON'T use white light in the cab |
| 2:34 | DO scan constantly (40° FOV) |
| 2:54 | DON'T overdrive your goggles (stopping distance vs. detection range) |
| 3:16 | DON'T stare into bright lights (blooming) |
| 3:33 | DO keep your convoy interval |
| 3:49 | DON'T back without a ground guide |
| 4:06 | DO manage fatigue |
| 4:21 | Recap |
| 4:44 | References / close |

> Training aid only. Speeds and distances in the overdrive scene are illustrative. Verify all content against the current AR 600-55, TC 21-305-2, the vehicle and device TMs, and your unit SOP before using it for instruction.

## How it's built
- `sim/scenes.json` — the script: scene order, DO/DON'T type, on-screen title, references, narration text. Edit this to change wording.
- `sim/build_audio.py` — neural text-to-speech (Kokoro, voice `am_michael`; falls back to espeak-ng if the model isn't present), fits the total to 300 s, writes `build/narration.wav` and `sim/timeline.js` (sentence timings for captions).
- `sim/index.html` — the canvas simulation (NVG tube view with noise/blur/blooming, top-down PLS scenes). Open it in a browser to scrub through interactively.
- `sim/build_artifact.py` — bundles the player, timeline and narration into `docs/index.html`.
- `sim/render.js` — renders every frame deterministically with Playwright/Chromium and encodes the MP4 with ffmpeg (narration + low engine rumble).

## Rebuild
```bash
sudo apt-get install -y ffmpeg espeak-ng
pip install numpy kokoro-onnx soundfile && npm install playwright
# Kokoro voice model (~350 MB, git-ignored):
mkdir -p models && cd models
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
cd ..
python3 sim/build_audio.py
python3 sim/build_artifact.py && cp build/NVG-Sim.html docs/index.html
node sim/render.js            # --fps 30 --workers 4 ; --stills 10,60 for preview JPGs in build/
```
