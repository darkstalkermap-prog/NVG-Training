#!/usr/bin/env python3
"""Generate narration, sentence timings, and sim/timeline.js.

Voice: Kokoro neural TTS (kokoro-onnx) when its model files are present, else espeak-ng + MBROLA us2.
  pip install kokoro-onnx soundfile
  Model files (kokoro-v1.0.onnx, voices-v1.0.bin) from
  https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
  placed in $NVG_KOKORO_DIR (default: models/ in the repo root, git-ignored).

Usage: python3 sim/build_audio.py [video_dir]   (default: sim)
Outputs: build/<video>/narration.wav, <video_dir>/narration.m4a, <video_dir>/timeline.js
"""
import json, os, re, subprocess, tempfile, wave
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import sys
SIM = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, "sim")
BUILD = os.path.join(ROOT, "build", os.path.basename(SIM))
KOKORO_DIR = os.environ.get("NVG_KOKORO_DIR", os.path.join(ROOT, "models"))
KOKORO_VOICE = os.environ.get("NVG_VOICE", "am_michael")
ESPEAK_VOICE = "mb-us2"
_kokoro = None
if os.path.exists(os.path.join(KOKORO_DIR, "kokoro-v1.0.onnx")):
    from kokoro_onnx import Kokoro
    _kokoro = Kokoro(os.path.join(KOKORO_DIR, "kokoro-v1.0.onnx"), os.path.join(KOKORO_DIR, "voices-v1.0.bin"))
SR = 24000 if _kokoro else 16000

LEAD, GAP, TAIL = 0.5, 0.3, 0.9
SPEED = int(os.environ.get("NVG_SPEED", "115"))  # percent of normal speaking rate

# Word-level pronunciation fixes applied to Kokoro's phonemes (word -> IPA as the voice produces it).
PHONEME_FIX = {
    "mɑːnˈoʊkjʊlɚ": "mənˈɑːkjəlɚ",  # monocular: muh-NOCK-yuh-ler
    "foʊtˈoʊpɪk": "foʊtˈɑːpɪk",  # photopic: foh-TOP-ik
}

# Caption text -> spoken text. Letters are hyphenated where Kokoro would
# otherwise read a lone "A" as the article "uh" (check with Kokoro.tokenizer.phonemize).
SAY = [
    (r"AN/PVS-14", "A-N P V S fourteen"),
    (r"PVS-14", "P V S fourteen"),
    (r"AR 600-55", "A-R six-hundred fifty-five"),
    (r"AR 385-10", "A-R three-eighty-five ten"),
    (r"DD Form 2977", "D, D, Form twenty-nine seventy-seven"),
    (r"TC 21-60", "T C twenty-one sixty"),
    (r"\bIR\b", "I-R"),
    (r"TC 21-305-2", "T C twenty-one, three-oh-five, dash two"),
    (r"DA Form 5984-E", "D, A, Form fifty-nine eighty-four E"),
    (r"M1075A1", "M ten-seventy-five A-one"),
    (r"NVG-compatible", "N V G compatible"),
    (r"\bNVDs\b", "N V Dees"),
    (r"\bNVD\b", "N V D"),
    (r"\bPMCS\b", "P M C S"),
    (r"\bPLS\b", "P L S"),
    (r"\bSOP\b", "S O P"),
    (r"Don't:", "Don't."),
    (r"Do:", "Do."),
]

def to_speech(s):
    for a, b in SAY:
        s = re.sub(a, b, s)
    return s

def split_sentences(text):
    return [p.strip() for p in re.split(r"(?<=[.!?])\s+", text.strip()) if p.strip()]

_cache = {}
def tts(text, speed, path):
    key = (text, speed)
    if key in _cache:
        return _cache[key]
    if _kokoro:
        ph = _kokoro.tokenizer.phonemize(text, "en-us")
        for a_, b_ in PHONEME_FIX.items():
            ph = ph.replace(a_, b_)
        a, sr = _kokoro.create(ph, voice=KOKORO_VOICE, speed=speed / 100, is_phonemes=True)
        assert sr == SR, sr
        data = (np.clip(a, -1, 1) * 32767).astype(np.int16)
    else:
        subprocess.run(["espeak-ng", "-v", ESPEAK_VOICE, "-s", str(int(speed * 1.6)), "-g", "2", "-w", path, text],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with wave.open(path) as w:
            assert w.getframerate() == SR, w.getframerate()
            data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    # trim leading/trailing silence
    nz = np.where(np.abs(data) > 300)[0]
    if len(nz):
        data = data[max(0, nz[0] - int(SR * 0.012)): nz[-1] + int(SR * 0.025)]
    _cache[key] = data
    return data

def build(speed, tmp, cfg):
    scenes = []
    for sc in cfg["scenes"]:
        sents = []
        for i, s in enumerate(split_sentences(sc["text"])):
            p = os.path.join(tmp, f"{sc['id']}_{i}.wav")
            a = tts(to_speech(s), speed, p)
            sents.append({"text": s, "audio": a, "dur": len(a) / SR})
        speech = sum(x["dur"] for x in sents) + GAP * (len(sents) - 1) + sum(sc.get("pause_after", {}).values())
        scenes.append({**sc, "sents": sents, "base": LEAD + speech + TAIL})
    return scenes

def main():
    cfg = json.load(open(os.path.join(SIM, "scenes.json")))
    target = cfg["target_seconds"]
    os.makedirs(BUILD, exist_ok=True)
    tmp = tempfile.mkdtemp(dir=BUILD)
    print("voice:", f"kokoro/{KOKORO_VOICE}" if _kokoro else f"espeak/{ESPEAK_VOICE}")
    # Speak at a natural fixed pace; the video runs at least target_seconds and
    # grows if the narration needs more time.
    scenes = build(SPEED, tmp, cfg)
    total = sum(s["base"] for s in scenes)
    print(f"speed {SPEED}%: narration needs {total:.1f}s")
    target = max(target, round(total + 0.5))
    slack = (target - total) / len(scenes)
    t = 0.0
    timeline = {"total": target, "scenes": []}
    track = np.zeros(int(target * SR) + SR, dtype=np.float32)
    for sc in scenes:
        dur = sc["base"] + slack
        extra = slack * 0.3  # spare time: a little before speech, the rest lets visuals play out after
        cur = LEAD + extra
        sents = []
        for s in sc["sents"]:
            start_abs = t + cur
            i0 = int(start_abs * SR)
            track[i0:i0 + len(s["audio"])] += s["audio"].astype(np.float32) / 32768.0
            sents.append({"text": s["text"], "start": round(cur, 3), "dur": round(s["dur"], 3)})
            cur += s["dur"] + GAP + sc.get("pause_after", {}).get(str(len(sents) - 1), 0)
        timeline["scenes"].append({k: v for k, v in sc.items() if k not in ("text", "sents", "base")} |
                                  {"start": round(t, 3), "dur": round(dur, 3), "sentences": sents})
        t += dur
    peak = np.max(np.abs(track)) or 1
    track = (track / peak * 0.9 * 32767).astype(np.int16)[: int(target * SR)]
    with wave.open(os.path.join(BUILD, "narration.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(track.tobytes())
    with open(os.path.join(SIM, "timeline.js"), "w") as f:
        f.write("// Generated by sim/build_audio.py - do not edit by hand.\n")
        f.write("window.TIMELINE = " + json.dumps(timeline, indent=1) + ";\n")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(BUILD, "narration.wav"),
                    "-c:a", "aac", "-b:a", "48k", "-ac", "1", os.path.join(SIM, "narration.m4a")], check=True)
    for s in timeline["scenes"]:
        print(f"{s['start']:7.1f}  {s['dur']:5.1f}  {s['id']}")
    print("total", t)

if __name__ == "__main__":
    main()
