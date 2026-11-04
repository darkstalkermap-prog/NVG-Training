# NVG-Training
An NVG simulation of Do's and Don'ts: **AN/PVS-14** monocular night vision device while driving the **M1075A1 PLS**, framed by **AR 600-55** (Army Driver and Operator Standardization Program).

**Video:** [`NVG_PVS-14_PLS_Dos_and_Donts.mp4`](NVG_PVS-14_PLS_Dos_and_Donts.mp4) — 5:00, 1280x720, 30 fps, narrated with captions.

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
- `sim/build_audio.py` — text-to-speech (espeak-ng + MBROLA `us2`), fits the total to 300 s, writes `build/narration.wav` and `sim/timeline.js` (sentence timings for captions).
- `sim/index.html` — the canvas simulation (NVG tube view with noise/blur/blooming, top-down PLS scenes). Open it in a browser to scrub through interactively.
- `sim/render.js` — renders every frame deterministically with Playwright/Chromium and encodes the MP4 with ffmpeg (narration + low engine rumble).

## Rebuild
```bash
sudo apt-get install -y espeak-ng mbrola mbrola-us2 ffmpeg
pip install numpy && npm install playwright
python3 sim/build_audio.py
node sim/render.js            # --fps 30 --workers 4 ; --stills 10,60 for preview JPGs in build/
```
