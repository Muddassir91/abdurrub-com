// Captures product-tour screenshots of the demo workspace and renders the
// homepage explainer video: title cards + screenshots with a slow zoom, each
// scene timed to its narration line (public/vo, from make-voiceover.mjs),
// music bed from make-music.mjs ducked under the voice.
// Run after `npm run build && node scripts/copy-export.mjs`.
import http from "node:http";
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const ROOT = resolve(process.cwd(), "..");
const PORT = 4179;
const PUB = resolve(process.cwd(), "public");
const OUT = resolve(PUB, "screens");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let file = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));
mkdirSync(OUT, { recursive: true });

// Scenes. `shot` = screenshot of an app page; `card` = generated title card.
const SCENES = [
  { id: "hook", card: { title: "You made good money this month.", sub: "So why is the account empty again?" }, caption: "" },
  { id: "dashboard", shot: { file: "dashboard.png", path: "" }, caption: "Every dollar gets a job the moment it lands." },
  { id: "dashboard-alloc", shot: { file: "dashboard-alloc.png", path: "", scroll: 560 }, caption: "Six envelopes. Targets, actuals and what is left." },
  { id: "expenses", shot: { file: "expenses.png", path: "expenses/" }, caption: "A ceiling on tools. Warned the day you cross it." },
  { id: "personal", shot: { file: "personal.png", path: "personal/" }, caption: "Pay yourself on purpose. Household first." },
  { id: "trends", shot: { file: "trends.png", path: "trends/" }, caption: "Watch the result line climb." },
  { id: "month-end", shot: { file: "month-end.png", path: "month-end/" }, caption: "Close the month in ten steps." },
  { id: "cta", card: { title: "Start your free month.", sub: "abdurrub.com/cfoh" }, caption: "" },
];

// 1. Screenshots
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
await ctx.addInitScript(() => localStorage.setItem("finance-os:theme", "light"));
const page = await ctx.newPage();
await page.goto(`http://localhost:${PORT}/cfoh/app/?demo=1`, { waitUntil: "networkidle" });
await page.getByText("overview").first().waitFor({ timeout: 30000 });
for (const sc of SCENES.filter((s) => s.shot)) {
  await page.goto(`http://localhost:${PORT}/cfoh/app/${sc.shot.path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  if (sc.shot.scroll) {
    await page.evaluate((y) => window.scrollTo({ top: y }), sc.shot.scroll);
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: join(OUT, sc.shot.file), fullPage: false });
  console.log("captured", sc.shot.file);
}
await browser.close();
server.close();

// 2. Durations from the voiceover manifest (fallback 5s per scene).
const voPath = resolve(PUB, "vo", "manifest.json");
const vo = existsSync(voPath) ? JSON.parse(readFileSync(voPath, "utf8")) : null;
const voFor = (id) => vo?.lines.find((l) => l.scene === id) ?? null;
const PAD = 0.9; // seconds of air after each line
const durations = SCENES.map((sc) => {
  const l = voFor(sc.id);
  return l ? Math.max(3, l.seconds + PAD) : 5;
});
const total = durations.reduce((a, b) => a + b, 0);
console.log(`scenes: ${SCENES.length}, total ${total.toFixed(1)}s${vo ? " (timed to narration)" : " (no narration found)"}`);

// 3. Music bed of the right length (make-music.mjs writes public/cfoh-music.mp3 without muxing when MUSIC_NO_MUX=1).
execFileSync("node", ["scripts/make-music.mjs"], { stdio: "inherit", env: { ...process.env, MUSIC_SECONDS: String(Math.ceil(total + 1)), MUSIC_NO_MUX: "1" } });

// 4. Video
const font = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"].find((f) => existsSync(f));
const fontR = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"].find((f) => existsSync(f));
const esc = (t) => t.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/,/g, "\\,");
const fps = 24;
const inputs = [];
const filters = [];
let vIdx = 0;
SCENES.forEach((sc, i) => {
  const dur = durations[i];
  if (sc.card) {
    inputs.push("-f", "lavfi", "-t", dur.toFixed(2), "-i", `color=c=0x1c1a4f:s=1280x800:r=${fps}`);
    const t1 = font ? `drawtext=fontfile=${font}:text='${esc(sc.card.title)}':fontcolor=white:fontsize=58:x=(w-text_w)/2:y=(h/2)-80` : "null";
    const t2 = fontR ? `,drawtext=fontfile=${fontR}:text='${esc(sc.card.sub)}':fontcolor=0xc7c2ff:fontsize=36:x=(w-text_w)/2:y=(h/2)+10` : "";
    const brand = font ? `,drawtext=fontfile=${font}:text='CFoh!':fontcolor=white@0.85:fontsize=28:x=(w-text_w)/2:y=h-90` : "";
    filters.push(`[${vIdx}:v]${t1}${t2}${brand},fade=t=in:st=0:d=0.5,fade=t=out:st=${(dur - 0.5).toFixed(2)}:d=0.5,setsar=1[v${i}]`);
  } else {
    inputs.push("-i", join(OUT, sc.shot.file));
    const zoom = `zoompan=z='min(zoom+0.0007,1.10)':x='iw/2-(iw/zoom/2)':y='ih*0.35-(ih/zoom*0.35)':d=${Math.round(dur * fps)}:s=1280x800:fps=${fps}`;
    const caption = font && sc.caption ? `,drawbox=y=ih-140:h=140:color=black@0.55:t=fill,drawtext=fontfile=${font}:text='${esc(sc.caption)}':fontcolor=white:fontsize=34:x=(w-text_w)/2:y=h-92` : "";
    filters.push(`[${vIdx}:v]scale=1600:1000:force_original_aspect_ratio=increase,crop=1600:1000,${zoom}${caption},fade=t=in:st=0:d=0.4,fade=t=out:st=${(dur - 0.4).toFixed(2)}:d=0.4,setsar=1[v${i}]`);
  }
  vIdx++;
});
const vconcat = SCENES.map((_, i) => `[v${i}]`).join("") + `concat=n=${SCENES.length}:v=1:a=0[vout]`;

// Audio: narration placed at each scene start, music ducked by sidechain, voice slightly leading.
const aFilters = [];
const voLabels = [];
let starts = 0;
SCENES.forEach((sc, i) => {
  const l = voFor(sc.id);
  if (l && existsSync(resolve(PUB, l.file))) {
    inputs.push("-i", resolve(PUB, l.file));
    const delayMs = Math.round((starts + 0.35) * 1000);
    aFilters.push(`[${vIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${delayMs}|${delayMs}[vo${i}]`);
    voLabels.push(`[vo${i}]`);
    vIdx++;
  }
  starts += durations[i];
});
const musicPath = resolve(PUB, "cfoh-music.mp3");
inputs.push("-i", musicPath);
const musicIdx = vIdx;
let amap;
if (voLabels.length) {
  aFilters.push(`${voLabels.join("")}amix=inputs=${voLabels.length}:normalize=0,volume=1.6,alimiter=limit=0.95,asplit=2[voiceA][voiceB]`);
  aFilters.push(`[${musicIdx}:a]volume=0.32[music]`);
  aFilters.push(`[music][voiceA]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=500:makeup=1[ducked]`);
  aFilters.push(`[ducked][voiceB]amix=inputs=2:normalize=0,alimiter=limit=0.95,afade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5[aout]`);
  amap = "[aout]";
} else {
  aFilters.push(`[${musicIdx}:a]afade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5[aout]`);
  amap = "[aout]";
}
const graphAudio = aFilters.join(";");

const videoOut = resolve(PUB, "cfoh-demo.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filters.join(";") + ";" + vconcat + ";" + graphAudio, "-map", "[vout]", "-map", amap, "-t", total.toFixed(2), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-crf", "27", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", videoOut], { stdio: "inherit" });
console.log(`video written: ${videoOut} (${(statSync(videoOut).size / 1048576).toFixed(1)} MB, ${total.toFixed(1)}s)`);
writeFileSync(join(OUT, "README.txt"), "Generated by scripts/make-tour.mjs from the demo workspace. Re-run after UI changes.\n");
