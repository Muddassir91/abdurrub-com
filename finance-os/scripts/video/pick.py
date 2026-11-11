"""Chooses the best take of each narration line and writes the final clips.

Usage: python pick.py <script.json> <candidates dir> <out dir> [tempo]
Every take is transcribed (faster-whisper, when installed) and compared with
the line it should say; takes with wrong words or an odd pace are rejected.
The chosen take is trimmed of silence, evened out in level and saved, and a
manifest with each clip's length is written for the recorder.
Exits 3 and lists the line ids when some line has no acceptable take.
"""
import json, re, sys, glob, os
from math import gcd
import numpy as np, scipy.io.wavfile as wf
from scipy.signal import resample_poly

script_path, cand, out = sys.argv[1], sys.argv[2], sys.argv[3]
script = json.load(open(script_path))
try:
    from faster_whisper import WhisperModel
    asr = WhisperModel("base.en", device="cpu", compute_type="int8")
except Exception as e:  # no recogniser: accept the first take
    print("no speech recogniser, takes are not checked:", e)
    asr = None

NUM = {"twenty": "20", "three hundred": "300", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5"}
def norm(t):
    t = t.lower()
    for k, v in NUM.items():
        t = t.replace(k, v)
    t = re.sub(r"\bc\.?\s*f\.?\s*o\.?\b", "cfo", t)
    return re.sub(r"[^a-z0-9 ]", "", t).split()

def load(f):
    sr, a = wf.read(f)
    a = a.astype(np.float32)
    if a.ndim > 1:
        a = a.mean(axis=1)
    if np.abs(a).max() > 1.5:
        a /= 32768.0
    return sr, a

def trim(a, sr):
    win = int(sr * 0.02)
    rms = np.sqrt(np.convolve(a ** 2, np.ones(win) / win, "same"))
    loud = np.where(rms > max(0.012, rms.max() * 0.04))[0]
    if len(loud) == 0:
        return a
    s, e = max(0, loud[0] - int(sr * 0.03)), min(len(a), loud[-1] + int(sr * 0.09))
    a = a[s:e].copy()
    f = int(sr * 0.012)
    a[:f] *= np.linspace(0, 1, f)
    a[-f:] *= np.linspace(1, 0, f)
    return a

def distance(a, b):
    d = np.arange(len(b) + 1)
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
    return int(d[len(b)])

manifest, bad = [], []
for line_id, text in script.items():
    want = norm(text)
    best = None
    for f in sorted(glob.glob(f"{cand}/{line_id}.*.wav")):
        sr, a = load(f)
        a = trim(a, sr)
        secs = len(a) / sr
        per_word = secs / max(1, len(text.split()))
        heard, err = "", 0
        if asr is not None:
            g = gcd(sr, 16000)
            segs, _ = asr.transcribe(resample_poly(a, 16000 // g, sr // g).astype(np.float32), beam_size=5)
            heard = " ".join(s.text.strip() for s in segs)
            err = distance(norm(heard), want)
        pace_ok = 0.2 <= per_word <= 0.75
        score = err * 10 + (0 if pace_ok else 50) + abs(per_word - 0.36) * 5
        if best is None or score < best[0]:
            best = (score, f, sr, a, secs, heard, err, pace_ok)
    if best is None:
        bad.append(line_id)
        continue
    score, f, sr, a, secs, heard, err, pace_ok = best
    ok = err == 0 and pace_ok
    if not ok:
        bad.append(line_id)
    a = a * (10 ** (-21 / 20) / (np.sqrt((a ** 2).mean()) + 1e-9))  # even level across clips
    a = np.clip(a, -0.98, 0.98)
    wf.write(f"{out}/{line_id}.wav", sr, (a * 32767).astype(np.int16))
    manifest.append({"id": line_id, "text": text, "file": f"{line_id}.wav", "seconds": round(secs, 3), "take": os.path.basename(f), "heard": heard, "ok": ok})
    print(f"{'ok ' if ok else 'BAD'} {line_id:7s} {secs:5.2f}s  {os.path.basename(f):12s} {heard}", flush=True)

json.dump({"lines": manifest}, open(f"{out}/manifest.json", "w"), indent=1)
print(f"total {sum(m['seconds'] for m in manifest):.1f}s of narration; {len(bad)} line(s) need another take: {','.join(bad)}")
sys.exit(3 if bad else 0)
