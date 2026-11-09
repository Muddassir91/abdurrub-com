// Generates the demo voiceover with Kokoro (Apache-2.0 open-source TTS) on CPU.
// Output: public/vo/NN.wav + public/vo/manifest.json (durations in seconds).
// Usage: node scripts/make-voiceover.mjs            (voice via VO_VOICE, default af_heart)
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Route Node's fetch through the sandbox proxy when one is configured (model download).
if (process.env.HTTPS_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
}
const { KokoroTTS } = await import("kokoro-js");

export const LINES = [
  { id: "01", scene: "hook", text: "You made good money this month. So why is the account empty again? It is not a discipline problem. You just can't see where it goes." },
  { id: "02", scene: "dashboard", text: "One balance makes every dollar look spendable. CFoh gives every dollar a job the moment it lands." },
  { id: "03", scene: "dashboard-alloc", text: "Six envelopes: operating, your pay, tax, profit, reserve and growth. Set once, applied to the cent." },
  { id: "04", scene: "expenses", text: "A ceiling on tools and overhead. It warns you the day you cross it, not at month end." },
  { id: "05", scene: "personal", text: "Pay yourself on purpose. Household first, then the rest." },
  { id: "06", scene: "trends", text: "Watch the result line climb, week by week." },
  { id: "07", scene: "month-end", text: "Close the month in ten steps. The report writes itself." },
  { id: "08", scene: "cta", text: "Start your free month today, at abdurrub dot com slash CFoh." },
];

const OUT = resolve(process.cwd(), "public", "vo");
mkdirSync(OUT, { recursive: true });
const voice = process.env.VO_VOICE ?? "af_heart";
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
const manifest = [];
for (const line of LINES) {
  const audio = await tts.generate(line.text, { voice, speed: 1.0 });
  const file = resolve(OUT, `${line.id}.wav`);
  await audio.save(file);
  const seconds = audio.audio.length / audio.sampling_rate;
  manifest.push({ ...line, file: `vo/${line.id}.wav`, seconds: Number(seconds.toFixed(3)) });
  console.log(`${line.id} ${seconds.toFixed(2)}s  ${line.text}`);
}
writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify({ voice, model: "onnx-community/Kokoro-82M-v1.0-ONNX (Apache-2.0)", lines: manifest }, null, 2));
console.log(`total ${manifest.reduce((a, l) => a + l.seconds, 0).toFixed(1)}s of narration`);
