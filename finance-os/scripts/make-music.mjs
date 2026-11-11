// Composes a royalty-free music bed in three moods (curious -> exciting -> calm)
// using ffmpeg's synthesiser, so no licence applies. Each section has its own
// key, tempo and density; sections are crossfaded and loudness-normalised.
//
//   MUSIC_SECTIONS='[{"mood":"curious","seconds":15},{"mood":"exciting","seconds":18},{"mood":"calm","seconds":14}]' node scripts/make-music.mjs
//   (defaults to 10s of each). MUSIC_NO_MUX=1 skips muxing into public/cfoh-demo.mp4.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const note = (n) => 440 * Math.pow(2, (n - 69) / 12);

const MOODS = {
  // Minor, sparse, slightly tense: the "why".
  curious: { bpm: 84, chords: [[57, 60, 64, 67, 71], [53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60]], barsPerChord: 2, arpStep: 1, arpOctave: 12, arpVol: 0.03, padVol: 0.045, pulseEvery: 2, pulseVol: 0.08, hats: false, lowpass: 1800, echo: "0.7:0.5:260|420:0.3|0.2" },
  // Major, driving, brighter: the "what".
  exciting: { bpm: 116, chords: [[60, 64, 67, 71], [55, 59, 62, 67], [57, 60, 64, 67], [53, 57, 60, 64]], barsPerChord: 1, arpStep: 0.5, arpOctave: 12, arpVol: 0.045, padVol: 0.04, pulseEvery: 1, pulseVol: 0.11, hats: true, lowpass: 5200, echo: "0.6:0.3:120:0.18" },
  // Warm, slow, resolved: the "how".
  calm: { bpm: 76, chords: [[53, 57, 60, 64], [52, 55, 60, 64], [50, 53, 57, 60], [55, 59, 62, 65]], barsPerChord: 2, arpStep: 2, arpOctave: 12, arpVol: 0.028, padVol: 0.05, pulseEvery: 0, pulseVol: 0, hats: false, lowpass: 2300, echo: "0.7:0.4:200|360:0.28|0.16" },
};

function renderSection(mood, seconds, out) {
  const m = MOODS[mood];
  const beat = 60 / m.bpm;
  const bar = beat * 4;
  const chordLen = bar * m.barsPerChord;
  const inputs = [];
  const labels = [];
  let idx = 0;
  const push = (src, filter) => {
    inputs.push("-f", "lavfi", "-i", src);
    labels.push(`[${idx}:a]${filter}[s${idx}]`);
    idx++;
  };
  for (let t = 0; t < seconds; t += chordLen) {
    const chord = m.chords[Math.floor(t / chordLen) % m.chords.length];
    const len = Math.min(chordLen, seconds - t);
    const d = Math.round(t * 1000);
    for (const n of chord) {
      for (const det of [-0.12, 0.12]) {
        const f = note(n) * Math.pow(2, det / 120);
        push(`sine=frequency=${f.toFixed(3)}:duration=${len.toFixed(3)}`, `afade=t=in:st=0:d=${Math.min(1.1, len / 2).toFixed(2)},afade=t=out:st=${Math.max(0, len - 1.2).toFixed(3)}:d=1.2,volume=${m.padVol},adelay=${d}|${d}`);
      }
    }
  }
  for (let t = 0, k = 0; t < seconds - 0.4; t += beat * m.arpStep, k++) {
    const chord = m.chords[Math.floor(t / chordLen) % m.chords.length];
    if (m.arpStep <= 0.5 && k % 8 === 7) continue; // breathe once a bar when busy
    const tone = chord[k % chord.length] + m.arpOctave;
    const d = Math.round(t * 1000);
    const decay = mood === "exciting" ? 0.35 : 0.8;
    push(`sine=frequency=${note(tone).toFixed(3)}:duration=${decay}`, `afade=t=in:st=0:d=0.008,afade=t=out:st=0.04:d=${(decay - 0.05).toFixed(2)},volume=${m.arpVol},adelay=${d}|${d}`);
  }
  if (m.pulseEvery > 0) {
    for (let t = 0; t < seconds - 0.4; t += beat * m.pulseEvery) {
      const d = Math.round(t * 1000);
      push(`sine=frequency=55:duration=0.3`, `afade=t=in:st=0:d=0.004,afade=t=out:st=0.03:d=0.27,volume=${m.pulseVol},adelay=${d}|${d}`);
    }
  }
  if (m.hats) {
    for (let t = beat / 2; t < seconds - 0.2; t += beat) {
      const d = Math.round(t * 1000);
      push(`anoisesrc=d=0.06:c=white:a=0.3:r=44100`, `highpass=f=6000,afade=t=in:st=0:d=0.003,afade=t=out:st=0.01:d=0.05,volume=0.045,adelay=${d}|${d}`);
    }
  }
  const mix = labels.map((_, i) => `[s${i}]`).join("");
  const graph = `${labels.join(";")};${mix}amix=inputs=${labels.length}:normalize=0,lowpass=f=${m.lowpass},aecho=${m.echo},highpass=f=55,aformat=sample_rates=44100:channel_layouts=stereo[out]`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[out]", "-t", String(seconds), "-c:a", "pcm_s16le", out], { stdio: "inherit" });
}

const sections = process.env.MUSIC_SECTIONS ? JSON.parse(process.env.MUSIC_SECTIONS) : [{ mood: "curious", seconds: 10 }, { mood: "exciting", seconds: 10 }, { mood: "calm", seconds: 10 }];
const tmp = mkdtempSync(join(tmpdir(), "cfoh-music-"));
const XF = 1.2; // crossfade seconds
const parts = sections.map((s, i) => {
  const out = join(tmp, `part${i}.wav`);
  renderSection(s.mood, s.seconds + (i < sections.length - 1 ? XF : 0), out);
  console.log(`section ${i + 1}: ${s.mood} ${s.seconds}s`);
  return out;
});
const total = sections.reduce((a, s) => a + s.seconds, 0);
const music = process.env.MUSIC_OUT ? resolve(process.env.MUSIC_OUT) : resolve(process.cwd(), "public", "cfoh-music.mp3");
const inputs = parts.flatMap((p) => ["-i", p]);
let graph = "";
let last = "[0:a]";
for (let i = 1; i < parts.length; i++) {
  const outLabel = i === parts.length - 1 ? "[xf]" : `[x${i}]`;
  graph += `${last}[${i}:a]acrossfade=d=${XF}:c1=tri:c2=tri${outLabel};`;
  last = outLabel;
}
if (parts.length === 1) graph = "[0:a]anull[xf];";
graph += `[xf]loudnorm=I=-18:TP=-1.5:LRA=9,afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0, total - 2.5).toFixed(2)}:d=2.5[out]`;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[out]", "-t", String(total), "-c:a", "libmp3lame", "-q:a", "4", music], { stdio: "inherit" });
rmSync(tmp, { recursive: true, force: true });
console.log(`music written: ${music} (${(statSync(music).size / 1024).toFixed(0)} KB, ${total}s)`);

const video = resolve(process.cwd(), "public", "cfoh-demo.mp4");
if (existsSync(video) && !process.env.MUSIC_NO_MUX) {
  const tmpV = resolve(process.cwd(), "public", "cfoh-demo.tmp.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", music, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", tmpV], { stdio: "inherit" });
  renameSync(tmpV, video);
  console.log(`video remuxed with music: ${video}`);
}
