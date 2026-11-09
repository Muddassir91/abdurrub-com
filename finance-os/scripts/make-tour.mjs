// Renders the homepage VSL: a three-card hook, then hard-cut shots (3 to 5s)
// of the real app timed to each narration line, with music that moves from
// curious (why) to exciting (what) to calm (how). Also captures the screenshots
// used by the homepage tour.
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

// Screens to capture (1440x900 viewport at 2x = 2880x1800).
const SHOTS = [
  { file: "dashboard.png", path: "" },
  { file: "dashboard-alloc.png", path: "", scroll: 560 },
  { file: "expenses.png", path: "expenses/" },
  { file: "personal.png", path: "personal/" },
  { file: "trends.png", path: "trends/" },
  { file: "month-end.png", path: "month-end/" },
  { file: "alerts.png", path: "alerts/" },
  { file: "transactions.png", path: "transactions/" },
  { file: "reserves.png", path: "reserves/" },
];

// Scenes = narration lines. Each scene lists its shots; `crop` is a fraction box [x, y, w, h] of the screenshot.
const CARD = (title, sub) => ({ card: { title, sub } });
const SCENES = [
  { id: "hook", mood: "curious", shots: [CARD("You made good money this month.", ""), CARD("So why is the account empty again?", ""), CARD("It is not a discipline problem.", "You just can\u2019t see where it goes.")] },
  { id: "dashboard", mood: "curious", caption: "Every dollar gets a job the moment it lands.", shots: [{ img: "onboarding.png", crop: [0.2, 0.0, 0.6, 0.6] }, { img: "dashboard.png" }, { img: "dashboard.png", crop: [0.2, 0.2, 0.62, 0.62] }] },
  { id: "dashboard-alloc", mood: "exciting", caption: "Six envelopes. Adds up to the cent.", shots: [{ img: "dashboard.png", crop: [0.21, 0.36, 0.52, 0.52] }, { img: "dashboard.png", crop: [0.2, 0.5, 0.5, 0.5] }] },
  { id: "expenses", mood: "exciting", caption: "A ceiling on tools. Warned the day you cross it.", shots: [{ img: "expenses.png" }, { img: "expenses.png", crop: [0.17, 0.04, 0.7, 0.7] }, { img: "alerts.png", crop: [0.17, 0.04, 0.75, 0.75] }] },
  { id: "personal", mood: "exciting", caption: "Pay yourself on purpose. Household first.", shots: [{ img: "personal.png" }, { img: "personal.png", crop: [0.17, 0.04, 0.7, 0.7] }] },
  { id: "trends", mood: "calm", caption: "Watch the result line climb.", shots: [{ img: "trends.png", crop: [0.17, 0.2, 0.72, 0.72] }] },
  { id: "month-end", mood: "calm", caption: "Close the month in ten steps.", shots: [{ img: "month-end.png" }, { img: "reserves.png", crop: [0.17, 0.04, 0.75, 0.75] }] },
  { id: "cta", mood: "calm", shots: [CARD("Start your free month.", "abdurrub.com/cfoh")] },
];

// 1. Screenshots
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
await ctx.addInitScript(() => localStorage.setItem("finance-os:theme", "light"));
const page = await ctx.newPage();
await page.goto(`http://localhost:${PORT}/cfoh/app/?demo=1`, { waitUntil: "networkidle" });
await page.getByText("Hi Sam").first().waitFor({ timeout: 30000 });
for (const sc of SHOTS) {
  await page.goto(`http://localhost:${PORT}/cfoh/app/${sc.path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  if (sc.scroll) {
    await page.evaluate((y) => window.scrollTo({ top: y }), sc.scroll);
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: join(OUT, sc.file), fullPage: false });
  console.log("captured", sc.file);
}
// The setup questions, in a fresh browser (no workspace yet).
const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
await fresh.addInitScript(() => localStorage.setItem("finance-os:theme", "light"));
const fp = await fresh.newPage();
await fp.goto(`http://localhost:${PORT}/cfoh/app/`, { waitUntil: "networkidle" });
const deviceOnly = fp.getByRole("button", { name: /Continue without an account/ });
if (await deviceOnly.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false)) await deviceOnly.click();
await fp.locator("[data-onboarding]").waitFor({ timeout: 30000 });
await fp.getByPlaceholder("Your name").fill("Sam");
await fp.getByRole("button", { name: "Continue" }).click();
await fp.waitForTimeout(700);
await fp.screenshot({ path: join(OUT, "onboarding.png"), fullPage: false });
console.log("captured onboarding.png");
await fresh.close();
await browser.close();
server.close();

// 2. Timing: scene length = narration + air; shots split evenly, kept between 2.6s and 5s.
const voPath = resolve(PUB, "vo", "manifest.json");
const vo = existsSync(voPath) ? JSON.parse(readFileSync(voPath, "utf8")) : null;
const voFor = (id) => vo?.lines.find((l) => l.scene === id) ?? null;
const PAD = 0.7;
for (const sc of SCENES) {
  const l = voFor(sc.id);
  sc.seconds = l ? Math.max(3, l.seconds + PAD) : 4 * sc.shots.length;
  let n = sc.shots.length;
  while (n > 1 && sc.seconds / n < 2.6) n--;
  sc.shots = sc.shots.slice(0, n);
  sc.shotSeconds = sc.seconds / n;
}
const total = SCENES.reduce((a, s) => a + s.seconds, 0);
console.log(`scenes ${SCENES.length}, shots ${SCENES.reduce((a, s) => a + s.shots.length, 0)}, total ${total.toFixed(1)}s`);

// 3. Music sections follow the scene moods.
const sections = [];
for (const sc of SCENES) {
  const last = sections[sections.length - 1];
  if (last && last.mood === sc.mood) last.seconds += sc.seconds;
  else sections.push({ mood: sc.mood, seconds: sc.seconds });
}
sections[sections.length - 1].seconds += 1;
execFileSync("node", ["scripts/make-music.mjs"], { stdio: "inherit", env: { ...process.env, MUSIC_SECTIONS: JSON.stringify(sections.map((s) => ({ mood: s.mood, seconds: Number(s.seconds.toFixed(2)) }))), MUSIC_NO_MUX: "1" } });

// 4. Video: hard cuts, each shot a slight push-in.
const font = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"].find((f) => existsSync(f));
const fontR = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"].find((f) => existsSync(f));
const esc = (t) => t.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/,/g, "\\,").replace(/%/g, "\\%");
const fps = 24;
const W = 1280;
const H = 800;
const inputs = [];
const filters = [];
const vLabels = [];
let idx = 0;
let shotNo = 0;
for (const sc of SCENES) {
  for (const shot of sc.shots) {
    const dur = sc.shotSeconds;
    const frames = Math.round(dur * fps);
    const label = `[v${shotNo}]`;
    if (shot.card) {
      inputs.push("-f", "lavfi", "-t", dur.toFixed(2), "-i", `color=c=0x1c1a4f:s=${W}x${H}:r=${fps}`);
      const t1 = font ? `drawtext=fontfile=${font}:text='${esc(shot.card.title)}':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=(h/2)-${shot.card.sub ? 70 : 28}` : "null";
      const t2 = fontR && shot.card.sub ? `,drawtext=fontfile=${fontR}:text='${esc(shot.card.sub)}':fontcolor=0xc7c2ff:fontsize=34:x=(w-text_w)/2:y=(h/2)+14` : "";
      const brand = font ? `,drawtext=fontfile=${font}:text='CFoh!':fontcolor=white@0.85:fontsize=26:x=(w-text_w)/2:y=h-80` : "";
      // Quick pop-in: scale text area via a short fade only (hard cut otherwise).
      filters.push(`[${idx}:v]${t1}${t2}${brand},fade=t=in:st=0:d=0.18,setsar=1${label}`);
    } else {
      inputs.push("-i", join(OUT, shot.img));
      const [cx, cy, cw, ch] = shot.crop ?? [0, 0, 1, 1];
      // Crop as fraction of the source, then push in slightly over the shot.
      const crop = `crop=iw*${cw}:ih*${ch}:iw*${cx}:ih*${cy}`;
      const zoom = `zoompan=z='min(zoom+0.0012,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps}`;
      const caption = font && sc.caption ? `,drawbox=y=ih-132:h=132:color=black@0.55:t=fill,drawtext=fontfile=${font}:text='${esc(sc.caption)}':fontcolor=white:fontsize=34:x=(w-text_w)/2:y=h-88` : "";
      filters.push(`[${idx}:v]${crop},scale=1600:1000:force_original_aspect_ratio=increase,crop=1600:1000,${zoom}${caption},setsar=1${label}`);
    }
    vLabels.push(label);
    idx++;
    shotNo++;
  }
}
const vconcat = `${vLabels.join("")}concat=n=${vLabels.length}:v=1:a=0[vout]`;

// 5. Audio: narration at scene starts, music ducked under the voice.
const aFilters = [];
const voLabels = [];
let t0 = 0;
SCENES.forEach((sc, i) => {
  const l = voFor(sc.id);
  if (l && existsSync(resolve(PUB, l.file))) {
    inputs.push("-i", resolve(PUB, l.file));
    const delayMs = Math.round((t0 + 0.3) * 1000);
    aFilters.push(`[${idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${delayMs}|${delayMs}[vo${i}]`);
    voLabels.push(`[vo${i}]`);
    idx++;
  }
  t0 += sc.seconds;
});
inputs.push("-i", resolve(PUB, "cfoh-music.mp3"));
const musicIdx = idx;
if (voLabels.length) {
  aFilters.push(`${voLabels.join("")}amix=inputs=${voLabels.length}:normalize=0,volume=1.6,alimiter=limit=0.95,asplit=2[voiceA][voiceB]`);
  aFilters.push(`[${musicIdx}:a]volume=0.34[music]`);
  aFilters.push(`[music][voiceA]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=500:makeup=1[ducked]`);
  aFilters.push(`[ducked][voiceB]amix=inputs=2:normalize=0,alimiter=limit=0.95,afade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5[aout]`);
} else {
  aFilters.push(`[${musicIdx}:a]afade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5[aout]`);
}

const videoOut = resolve(PUB, "cfoh-demo.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", [...filters, vconcat, ...aFilters].join(";"), "-map", "[vout]", "-map", "[aout]", "-t", total.toFixed(2), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-crf", "26", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", videoOut], { stdio: "inherit" });
console.log(`video written: ${videoOut} (${(statSync(videoOut).size / 1048576).toFixed(1)} MB, ${total.toFixed(1)}s)`);
writeFileSync(join(OUT, "README.txt"), "Generated by scripts/make-tour.mjs from the demo workspace. Re-run after UI changes.\n");
