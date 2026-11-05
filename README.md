# NVG-Training
Four narrated training videos (5 to 10 minutes), plus a printable class packet, for driving the **M1075A1 PLS** at night with the **AN/PVS-14**.

| Video | Download | Interactive player |
|-------|----------|--------------------|
| NVG Driving: Do's & Don'ts (AR 600-55) | [MP4](https://github.com/darkstalkermap-prog/NVG-Training/raw/main/NVG_PVS-14_PLS_Dos_and_Donts.mp4) | [`docs/index.html`](docs/index.html) |
| Ground Guiding at Night, with & without NVDs (AR 385-10, TC 21-60) | [MP4](https://github.com/darkstalkermap-prog/NVG-Training/raw/main/NVG_Ground_Guiding_at_Night.mp4) | [`docs/ground-guide.html`](docs/ground-guide.html) |
| NVD Safety (limits, care, batteries, accountability, failure drill, IR discipline, risk) | [MP4](https://github.com/darkstalkermap-prog/NVG-Training/raw/main/NVG_NVD_Safety.mp4) | [`docs/nvd-safety.html`](docs/nvd-safety.html) |
| How-To: Mounting the PVS-14, mount checks, eye health, benefits, Principles of Night Vision + 14-question knowledge check (TC 21-305-2 Quiz 721-500-01.5), about 10 min | [MP4](https://github.com/darkstalkermap-prog/NVG-Training/raw/main/NVG_Mounting_HowTo.mp4) | [`docs/nvg-howto.html`](docs/nvg-howto.html) |

### Class packet (Day 1: classroom, written, familiarization)
- [Instructor lesson plan, stations & GO/NO-GO roster (PDF)](https://github.com/darkstalkermap-prog/NVG-Training/raw/main/class/1_Instructor_Lesson_Plan.pdf)
- [Written exam (PDF)](https://github.com/darkstalkermap-prog/NVG-Training/raw/main/class/2_Written_Exam.pdf)
- [Answer key, instructor only (PDF)](https://github.com/darkstalkermap-prog/NVG-Training/raw/main/class/3_Answer_Key_INSTRUCTOR_ONLY.pdf)

## Video 1: NVG Driving Do's & Don'ts
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

## Video 2: Ground Guiding at Night
| Time | Segment |
|------|---------|
| 0:00 | Title |
| 0:20 | When a ground guide is required (AR 385-10, two guides for the PLS per SOP) |
| 0:47 | DO brief before you move, walk the route |
| 1:11 | DO stay where the driver can see you |
| 1:34 | *Without NVDs:* DO use filtered lights |
| 1:56 | *Without NVDs:* DON'T blind the driver with white light |
| 2:17 | *Without NVDs:* DON'T disappear into the blind spot / hook arm path |
| 2:37 | *With NVDs:* DO use IR chemlights or wands (naked eye vs PVS-14) |
| 3:01 | *With NVDs:* DO signal big and slow (TC 21-60) |
| 3:18 | *With NVDs:* DON'T aim IR light at the driver |
| 3:40 | *With NVDs:* DO keep extra distance when the guide is on NVDs |
| 4:01 | DO stop when sight of the guide is lost |
| 4:19 | Recap |
| 4:45 | References / close |

> The hand-and-arm signals shown are illustrative. Use the signals in TC 21-60 and your unit SOP.

## How it's built
- `sim/engine.js` — shared renderer (NVG tube, naked-eye view, world, PLS drawings, captions, player).
- `sim/ground-guide/` — video 2 (its own `scenes.json`, `index.html`, `timeline.js`, `narration.m4a`).
- `sim/scenes.json` — video 1 script: scene order, DO/DON'T type, on-screen title, references, narration text. Edit this to change wording.
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
python3 sim/build_audio.py                       # video 1
python3 sim/build_audio.py sim/ground-guide      # video 2
python3 sim/build_audio.py sim/nvd-safety        # video 3
python3 sim/build_audio.py sim/nvg-howto         # video 4
python3 sim/build_artifact.py                                         # -> docs/index.html
python3 sim/build_artifact.py sim/ground-guide docs/ground-guide.html
node sim/render.js --dir sim/ground-guide --out NVG_Ground_Guiding_at_Night.mp4
node sim/render.js --dir sim/nvd-safety --out NVG_NVD_Safety.mp4
node sim/render.js --dir sim/nvg-howto --out NVG_Mounting_HowTo.mp4
node sim/render.js            # --fps 30 --workers 4 ; --stills 10,60 for preview JPGs in build/
```
