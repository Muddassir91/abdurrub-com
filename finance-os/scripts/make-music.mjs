// Generates a calm, royalty-free background track (we synthesise it, so no
// licence applies) and mixes it under public/cfoh-demo.mp4.
// Soft pad chords + a gentle arpeggio + a muted pulse, 90 BPM, 30 seconds.
import { execFileSync } from "node:child_process";
import { existsSync, renameSync, statSync } from "node:fs";
import { resolve } from "node:path";

const DURATION = Number(process.env.MUSIC_SECONDS ?? 30);
const BPM = 90;
const beat = 60 / BPM; // 0.667s
const bar = beat * 4;
const note = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI -> Hz

// Chord progression (MIDI numbers): Fmaj7 · Am7 · Dm9 · Gsus2/G  (warm, resolves gently)
const CHORDS = [
  [53, 57, 60, 64], // F3 A3 C4 E4
  [57, 60, 64, 67], // A3 C4 E4 G4
  [50, 53, 57, 60, 64], // D3 F3 A3 C4 E4
  [55, 57, 62, 67], // G3 A3 D4 G4
];
const chordLen = bar * 2; // 2 bars per chord (5.33s)

const inputs = [];
const labels = [];
let idx = 0;

// --- Pads: each chord tone as a detuned pair of soft sines, with slow attack/release.
for (let t = 0; t < DURATION; t += chordLen) {
  const chord = CHORDS[Math.floor(t / chordLen) % CHORDS.length];
  const len = Math.min(chordLen, DURATION - t);
  for (const n of chord) {
    for (const detune of [-0.15, 0.15]) {
      const f = note(n) * Math.pow(2, detune / 12 / 10);
      inputs.push("-f", "lavfi", "-i", `sine=frequency=${f.toFixed(3)}:duration=${len.toFixed(3)}`);
      labels.push(`[${idx}:a]afade=t=in:st=0:d=1.2,afade=t=out:st=${Math.max(0, len - 1.4).toFixed(3)}:d=1.4,volume=0.05,adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)}[p${idx}]`);
      idx++;
    }
  }
}

// --- Arpeggio: eighth-note plucks cycling through chord tones an octave up, with fast decay.
const arps = [];
for (let t = 0, k = 0; t < DURATION - 0.3; t += beat / 2, k++) {
  const chord = CHORDS[Math.floor(t / chordLen) % CHORDS.length];
  const tone = chord[k % chord.length] + 12;
  if (k % 8 === 7) continue; // leave a rest each bar so it breathes
  const f = note(tone);
  inputs.push("-f", "lavfi", "-i", `sine=frequency=${f.toFixed(3)}:duration=0.6`);
  arps.push(`[${idx}:a]afade=t=in:st=0:d=0.01,afade=t=out:st=0.05:d=0.55,volume=0.035,adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)}[a${idx}]`);
  labels.push(arps[arps.length - 1]);
  idx++;
}

// --- Pulse: a muted low thump on beats 1 and 3.
for (let t = 0; t < DURATION - 0.3; t += beat * 2) {
  inputs.push("-f", "lavfi", "-i", `sine=frequency=55:duration=0.35`);
  labels.push(`[${idx}:a]afade=t=in:st=0:d=0.005,afade=t=out:st=0.03:d=0.32,volume=0.09,adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)}[k${idx}]`);
  idx++;
}

const mixInputs = labels.map((l) => l.match(/\[(\w+)\]$/)[1]).map((l) => `[${l}]`).join("");
const graph = `${labels.join(";")};${mixInputs}amix=inputs=${labels.length}:normalize=0,lowpass=f=2400,aecho=0.7:0.4:180|320:0.25|0.15,highpass=f=60,loudnorm=I=-18:TP=-1.5:LRA=9,afade=t=in:st=0:d=0.8,afade=t=out:st=${(DURATION - 2.5).toFixed(2)}:d=2.5,aformat=sample_rates=44100:channel_layouts=stereo[out]`;

const music = resolve(process.cwd(), "public", "cfoh-music.mp3");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[out]", "-t", String(DURATION), "-c:a", "libmp3lame", "-q:a", "4", music], { stdio: "inherit" });
console.log(`music written: ${music} (${(statSync(music).size / 1024).toFixed(0)} KB)`);

// --- Mux under the demo video, if present.
const video = resolve(process.cwd(), "public", "cfoh-demo.mp4");
if (existsSync(video) && !process.env.MUSIC_NO_MUX) {
  const tmp = resolve(process.cwd(), "public", "cfoh-demo.tmp.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", music, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", tmp], { stdio: "inherit" });
  renameSync(tmp, video);
  console.log(`video remuxed with music: ${video} (${(statSync(video).size / 1048576).toFixed(1)} MB)`);
}
