"""Generates candidate narration clips for the product video.

Usage: python tts.py <engine> <script.json> <outdir> [voice] [takes]
  engine  "chatter" (Resemble AI Chatterbox, MIT) or "pocket" (Kyutai Pocket TTS, MIT)
Writes <outdir>/<id>.<take>.wav for every line; pick.py chooses the best take.
Both models are open source and run on CPU.
"""
import json, sys, numpy as np, scipy.io.wavfile as wf, torch

engine, script_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
voice = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] != "-" else None
takes = int(sys.argv[5]) if len(sys.argv) > 5 else 2
only = set(sys.argv[6].split(",")) if len(sys.argv) > 6 and sys.argv[6] else None
script = json.load(open(script_path))
torch.set_num_threads(4)

if engine == "chatter":
    from chatterbox.tts import ChatterboxTTS
    model = ChatterboxTTS.from_pretrained(device="cpu")
    sr = model.sr
    def speak(text, seed):
        torch.manual_seed(seed)
        # Low exaggeration and a low guidance weight give an unhurried, even delivery.
        wav = model.generate(text, audio_prompt_path=voice, exaggeration=0.4, cfg_weight=0.35, temperature=0.7)
        return wav.squeeze().numpy()
else:
    from pocket_tts import TTSModel
    model = TTSModel.load_model()
    sr = model.sample_rate
    state = model.get_state_for_audio_prompt(voice or "bill_boerst")
    def speak(text, seed):
        torch.manual_seed(seed)
        return model.generate_audio(state, text).numpy()

for k, (line_id, text) in enumerate(script.items()):
    if only and line_id not in only:
        continue
    for take in range(takes):
        a = speak(text, 1000 + k * 17 + take * 101).astype(np.float32)
        wf.write(f"{out}/{line_id}.{take}.wav", sr, a)
        print(f"{line_id}.{take} {len(a) / sr:.2f}s", flush=True)
