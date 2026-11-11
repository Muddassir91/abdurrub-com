// Records the product video from the real app.
//
// The app runs inside scripts/video/stage.html. This script plays one take:
// it moves a pointer, clicks, types and scrolls in the app while a "camera"
// (a CSS transform, so zoomed text stays sharp) follows the action, and
// full-screen cards carry the script's headings. Every narration clip, click,
// keystroke and chime is logged with its time, so the sound is laid exactly
// where things happen on screen.
//
//   node scripts/make-voiceover.mjs      (once, or after editing the script below)
//   npm run build && node scripts/copy-export.mjs
//   node scripts/make-demo.mjs           -> public/cfoh-demo.mp4 + public/cfoh-demo-poster.jpg
//
// DEMO_KEEP=1 keeps the working folder (.e2e/demo) for inspection.
import http from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, extname, resolve } from "node:path";
import { createRequire } from "node:module";
import { bundle } from "./deploy-assistant.mjs";
import { SCRIPT } from "./video/script.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = resolve(process.cwd(), "..");
const WORK = resolve(process.cwd(), ".e2e", "demo");
const VO_DIR = resolve(process.cwd(), "media", "vo");
const OUT = resolve(process.cwd(), "public", "cfoh-demo.mp4");
const POSTER = resolve(process.cwd(), "public", "cfoh-demo-poster.jpg");
const PORT = 4181;
const AI_PORT = 4182;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(WORK, { recursive: true, force: true });
mkdirSync(join(WORK, "frames"), { recursive: true });

// ---------------------------------------------------------------- narration clips
const manifestPath = join(VO_DIR, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { lines: [] };
const clip = Object.fromEntries(manifest.lines.map((l) => [l.id, l]));
/** The voice is slowed a touch for a calmer read (pitch is kept). 1 = as generated. */
const TEMPO = Number(process.env.VO_TEMPO ?? 0.93);
/** Length of a narration clip in seconds; estimated from the words when it has not been generated yet. */
const dur = (id) => (clip[id] ? clip[id].seconds / TEMPO : Math.max(0.9, SCRIPT[id].split(/\s+/).length * 0.36));

// ---------------------------------------------------------------- servers
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.startsWith("/__stage/") ? join(process.cwd(), "scripts", "video", path.slice(9)) : join(ROOT, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

// The assistant Worker, run locally. The one question in the video is answered with the figure
// read from the screen, in the same words the live model used for the same question.
writeFileSync(join(WORK, "assistant.bundle.mjs"), bundle());
const worker = (await import(join(WORK, "assistant.bundle.mjs"))).default;
let questionAnswer = "";
const fakeAI = { run: async () => (await sleep(1300), { response: JSON.stringify({ reply: questionAnswer, actions: [] }) }) };
const aiServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request(`http://localhost:${AI_PORT}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks) }), { AI: fakeAI });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => aiServer.listen(AI_PORT, r));

// ---------------------------------------------------------------- browser and stage
const browser = await chromium.launch({ args: ["--force-device-scale-factor=1", "--hide-scrollbars"] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "light" });
await context.addInitScript((ai) => {
  localStorage.setItem("finance-os:theme", "light");
  localStorage.setItem("finance-os:assistant-url", ai);
}, `http://localhost:${AI_PORT}`);
const page = await context.newPage();
await page.goto(`http://localhost:${PORT}/__stage/stage.html`);
// Use the app's own typeface on the cards.
for (const css of readdirSync(join(ROOT, "cfoh", "_next", "static", "chunks")).filter((f) => f.endsWith(".css"))) {
  const text = readFileSync(join(ROOT, "cfoh", "_next", "static", "chunks", css), "utf8");
  const faces = (text.match(/@font-face\{[^}]*\}/g) ?? []).filter((f) => /font-family:Geist[;}]/.test(f)).join("\n").replace(/url\((\.\.\/)+media\//g, "url(/cfoh/_next/static/media/");
  if (faces) await page.addStyleTag({ content: faces });
}
await page.evaluate((src) => window.stage.load(src), `http://localhost:${PORT}/cfoh/app/?demo=1`);
const app = page.frameLocator("#app");
await app.getByText("Hi Sam").first().waitFor({ timeout: 40000 });
await page.evaluate(() => document.fonts.ready);
await sleep(800);

const stage = (fn, ...args) => page.evaluate(([f, a]) => window.stage[f](...a), [fn, args]);
/** Rectangle of an element in the app's own coordinates. */
const rect = (locator) => locator.first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
});
const scrollApp = (top) => app.locator("body").evaluate((_, y) => window.scrollTo({ top: y, behavior: "smooth" }), top);

// ---------------------------------------------------------------- recording
const events = [];
const frames = [];
let t0 = 0;
const now = () => Date.now() / 1000 - t0;
const mark = (type, extra = {}) => events.push({ t: now(), type, ...extra });
/** Start a narration clip now and wait for it to finish (plus a short breath). */
const say = (id, gap = 0.3) => {
  mark("vo", { id });
  return sleep((dur(id) + gap) * 1000);
};

const cdp = await context.newCDPSession(page);
let n = 0;
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  if (!t0) return;
  const file = `f${String(++n).padStart(6, "0")}.jpg`;
  writeFileSync(join(WORK, "frames", file), Buffer.from(data, "base64"));
  frames.push({ file, t: metadata.timestamp - t0 });
});

const moveTo = async (locator, dx = 0.5, dy = 0.5) => {
  const r = await rect(locator);
  const ms = await stage("cursorTo", r.x + r.w * dx, r.y + r.h * dy);
  await sleep(ms + 60);
  return r;
};
const click = async (locator, dx, dy) => {
  await moveTo(locator, dx, dy);
  await stage("press");
  mark("click");
  await sleep(90);
  await locator.first().click();
};
/** Type into the ask bar at a human pace, spread over about `seconds`. */
const type = async (text, seconds) => {
  const per = Math.min(115, Math.max(48, ((seconds * 1000) / text.length) * 0.92));
  for (const ch of text) {
    await page.keyboard.type(ch);
    mark("key", { soft: ch === " " });
    await sleep(per * (0.75 + Math.random() * 0.5));
  }
};
const ask = app.locator('[data-askbar] input[aria-label="Ask CFoh!"]');
const reply = app.locator("[data-askbar] [data-assistant-reply]");
const enter = async (needle) => {
  await sleep(220);
  await page.keyboard.press("Enter");
  mark("enter");
  await reply.filter({ hasText: needle }).first().waitFor({ timeout: 20000 });
  mark("ding");
};
const problemCard = async (num, text, id) => {
  mark("whoosh");
  await stage("card", `<div class="label r"><b>${num}</b>Problem</div><div class="line r">${text}</div>`);
  await sleep(120);
  await stage("reveal", 0);
  await stage("reveal", 1);
  await say(id, 0.25);
};
const openApp = async () => {
  mark("whoosh");
  await stage("card", null);
  await sleep(380);
};
/** Camera on the ask bar, pointer parked beside it, page scrolled to the top. */
const toAskBar = async (zoom = 1.7, ms = 10) => {
  await scrollApp(0);
  const r = await rect(app.locator("[data-askbar]"));
  await stage("camera", r.cx, r.cy + 30, zoom, ms);
  return r;
};

await cdp.send("Page.startScreencast", { format: "jpeg", quality: 93, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await sleep(300);
t0 = Date.now() / 1000;

// ------------------------------------------------------------------ intro
await stage("card", `<div class="line r">You earn good money.</div><div class="line r muted">By the end of the month, it&rsquo;s gone.</div><div class="line r muted">And you can&rsquo;t say where it went.</div>`);
await sleep(500);
await stage("reveal", 0);
await say("intro1");
await stage("reveal", 1);
await say("intro2");
await stage("reveal", 2);
await say("intro3", 0.5);

mark("pop");
await stage("card", `<div class="logo r">CF<em>oh!</em></div><div class="line small muted r" style="margin-top:36px">See your money.</div>`);
await sleep(150);
await stage("reveal", 0);
await say("meet1", 0.2);
await stage("reveal", 1);
await sleep(650);
// Establishing shot: the whole app on its own, before any zoom.
mark("whoosh");
await stage("card", null);
await stage("showWindow", true);
await say("meet2", 0.5);
await sleep(500);

// ------------------------------------------------------------------ 1. just say it
await stage("cursorTo", 980, 420, 10);
await problemCard(1, "Writing things down is a chore.", "p1");
await openApp();
{
  const r = await rect(app.locator("[data-askbar]"));
  await stage("camera", r.cx, r.cy + 30, 1.7, 1200);
}
const v1 = say("s1a", 0.15);
await click(ask, 0.3, 0.5);
await v1;
const v1b = say("s1b", 0.1);
await type("spent 20 on lunch", dur("s1b"));
await v1b;
await enter("Added");
await sleep(250);
await say("s1c", 0.35);
{
  const r = await rect(app.getByText("Money out", { exact: true }));
  await stage("cursorHide");
  await stage("camera", r.cx + 40, r.cy + 40, 1.9, 1000);
  await sleep(1700);
}

// ------------------------------------------------------------------ 2. the split
await problemCard(2, "When you get paid, it all looks like spending money.", "p2");
await toAskBar(1.7);
await openApp();
await click(ask, 0.3, 0.5);
await type("got paid 3,000 from Lumen", 1.9);
await enter("Added");
await sleep(450);
{
  const head = await rect(app.getByText(/Where this month.s money goes/));
  const v = say("s2a", 0.2);
  await stage("cursorHide");
  await stage("camera", head.x + 495, head.y + 58, 1.88, 1100);
  await v;
  const labels = [/Running costs · \d+%/, /Your pay · \d+%/, /Tax · \d+%/, /Cushion · \d+%/];
  const v2 = say("s2b", 0.3);
  const each = (dur("s2b") * 1000) / labels.length;
  for (const l of labels) {
    const started = Date.now();
    const r = await rect(app.getByText(l));
    const ms = await stage("cursorTo", r.x + 30, r.y + 34);
    await sleep(Math.max(ms, each - (Date.now() - started)));
  }
  await v2;
  await sleep(500);
}

// ------------------------------------------------------------------ 3. pay yourself
await problemCard(3, "You never know how much you can pay yourself.", "p3");
{
  await scrollApp(0);
  const r = await rect(app.locator('[data-section="next"]'));
  await stage("camera", r.cx, r.cy + 10, 1.75, 10);
  await stage("cursorTo", r.cx - 120, r.cy + 110, 10);
}
await openApp();
const payBtn = app.getByRole("button", { name: "I paid myself" });
const v3 = say("s3a", 0.2);
await moveTo(payBtn);
await v3;
// "One tap" is said as the tap happens.
const v3b = say("s3b", 0.3);
await sleep(330);
await stage("press");
mark("click");
await sleep(90);
await payBtn.click();
await reply.filter({ hasText: "paid to you" }).first().waitFor({ timeout: 15000 });
mark("ding");
await sleep(750);
{
  await stage("cursorHide");
  const r = await rect(app.getByText("Your share this month"));
  await stage("camera", r.cx + 90, r.cy + 50, 1.9, 1100);
}
await v3b;
await sleep(900);

// ------------------------------------------------------------------ 4. a limit
await problemCard(4, "Small costs grow quietly.", "p4");
await toAskBar(1.7);
await openApp();
const v4 = say("s4a", 0.15);
await click(ask, 0.3, 0.5);
await v4;
const v4b = say("s4b", 0.1);
await type("track food under 300", dur("s4b"));
await v4b;
await enter("Added a tracker");
await sleep(500);
{
  await stage("cursorHide");
  const tr = app.locator('[data-section="trackers"]');
  const r0 = await rect(tr);
  if (r0.y + r0.h > 860) {
    await scrollApp(r0.y - 420);
    await sleep(650);
  }
  const r = await rect(tr.getByText("Food this month"));
  const v = say("s4c", 0.3);
  // Keep the sidebar out of frame: the tracker sits left of centre with the budgets above it.
  await stage("camera", Math.max(r.x + 190, 705), r.cy - 20, 2.05, 1100);
  await v;
  await sleep(800);
}

// ------------------------------------------------------------------ 5. ask
await problemCard(5, "Too many numbers. So you stop looking.", "p5");
{
  const left = await app.getByText("Your ceiling this month").first().evaluate((el) => el.closest("a")?.innerText ?? "");
  const m = left.match(/(\$[\d,]+)\s+left/);
  questionAnswer = `${m ? m[1] : "Plenty"} is left under your running costs ceiling this month.`;
}
await toAskBar(1.7);
await openApp();
const v5 = say("s5a", 0.15);
await click(ask, 0.3, 0.5);
await v5;
const v5b = say("s5b", 0.1);
await type("how much is left for running costs?", dur("s5b"));
await v5b;
await enter("is left under");
{
  const r = await rect(reply);
  await stage("cursorHide");
  await stage("camera", r.x + 330, r.cy - 16, 2.15, 900);
}
await sleep(500);
await say("s5c", 0.3);
await sleep(1500);

// ------------------------------------------------------------------ who it is for, and the way in
mark("whoosh");
await stage("card", `<div class="line small r">CF<em style="font-style:italic;display:inline-block;transform:skewX(-16deg);color:#a5a0ff;margin-right:0.22em">oh!</em> is for</div><div class="chips"><div class="chip r" style="color:#17162e">Freelancers</div><div class="chip r" style="color:#17162e">Solo founders</div><div class="chip r" style="color:#17162e">Small agency owners</div><div class="chip r" style="color:#17162e">Anyone whose money keeps disappearing</div></div>`, true);
await sleep(200);
await stage("reveal", 0);
{
  const v = say("who1", 0.3);
  const d = dur("who1") * 1000;
  await sleep(d * 0.3);
  await stage("reveal", 1);
  mark("pop", { soft: true });
  await sleep(d * 0.22);
  await stage("reveal", 2);
  mark("pop", { soft: true });
  await sleep(d * 0.22);
  await stage("reveal", 3);
  mark("pop", { soft: true });
  await v;
  const w = say("who2", 0.5);
  await sleep(350);
  await stage("reveal", 4);
  mark("pop", { soft: true });
  await w;
}
mark("whoosh");
await stage("card", `<div class="logo r">CF<em>oh!</em></div><div class="line small r" style="margin-top:40px">Your first month is free.</div><div class="url r">abdurrub.com/cfoh</div><div class="fine r">Shows your own numbers. Not financial or tax advice.</div>`, true);
await sleep(200);
await stage("reveal", 0);
await sleep(300);
await stage("reveal", 1);
await say("cta1", 0.25);
await stage("reveal", 2);
mark("ding");
await stage("reveal", 3);
await say("cta2", 0.2);
await sleep(2200);

const total = now();
await cdp.send("Page.stopScreencast");
await sleep(300);
await browser.close();
server.close();
aiServer.close();
writeFileSync(join(WORK, "events.json"), JSON.stringify({ total, events, frames: frames.length }, null, 1));
const fpsSeen = frames.length / total;
console.log(`recorded ${total.toFixed(1)}s, ${frames.length} frames (${fpsSeen.toFixed(1)} fps captured)`);

// ---------------------------------------------------------------- picture
const list = [];
for (let i = 0; i < frames.length; i++) {
  const next = i + 1 < frames.length ? frames[i + 1].t : total;
  list.push(`file 'frames/${frames[i].file}'`, `duration ${Math.max(0.001, next - Math.max(0, frames[i].t)).toFixed(4)}`);
}
list.push(`file 'frames/${frames[frames.length - 1].file}'`);
writeFileSync(join(WORK, "frames.txt"), list.join("\n"));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "frames.txt", "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-t", total.toFixed(2), "picture.mp4"], { cwd: WORK, stdio: "inherit" });

// ---------------------------------------------------------------- sound
const SR = 48000;
const len = Math.ceil((total + 0.5) * SR);
const voice = new Float32Array(len);
const sfx = new Float32Array(len);
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const add = (buf, at, fn, seconds) => {
  const start = Math.round(at * SR);
  const count = Math.round(seconds * SR);
  for (let i = 0; i < count && start + i < buf.length; i++) if (start + i >= 0) buf[start + i] += fn(i / SR, i);
};
/** A short filtered noise burst plus a tone: the body of clicks and keys. */
const tick = (at, { amp, noiseDecay, tone, toneDecay, toneAmp, bright }) => {
  let lp = 0;
  add(sfx, at, (t) => {
    const white = rnd() * 2 - 1;
    lp += bright * (white - lp);
    return amp * ((white - lp * 0.6) * Math.exp(-t / noiseDecay) + toneAmp * Math.sin(2 * Math.PI * tone * t) * Math.exp(-t / toneDecay));
  }, 0.09);
};
const mouseClick = (at) => {
  tick(at, { amp: 0.34, noiseDecay: 0.0016, tone: 1900, toneDecay: 0.004, toneAmp: 0.5, bright: 0.5 });
  tick(at + 0.075, { amp: 0.2, noiseDecay: 0.0013, tone: 2500, toneDecay: 0.003, toneAmp: 0.4, bright: 0.6 });
};
const key = (at, soft) => tick(at, { amp: (soft ? 0.2 : 0.15) * (0.8 + rnd() * 0.4), noiseDecay: 0.0022 + rnd() * 0.001, tone: (soft ? 150 : 210) * (0.85 + rnd() * 0.3), toneDecay: 0.012, toneAmp: 0.9, bright: 0.35 });
const ding = (at) => add(sfx, at, (t) => 0.13 * Math.min(1, t / 0.006) * (Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t / 0.22) + 0.7 * Math.sin(2 * Math.PI * 1318.5 * (t - 0.07)) * (t > 0.07 ? Math.exp(-(t - 0.07) / 0.3) : 0)), 1.1);
const pop = (at, soft) => add(sfx, at, (t) => (soft ? 0.09 : 0.16) * Math.sin(2 * Math.PI * (soft ? 520 : 300) * t * (1 - t * 1.6)) * Math.exp(-t / 0.05), 0.22);
const whoosh = (at) => {
  let lp = 0;
  add(sfx, at, (t) => {
    const k = t / 0.5;
    lp += (0.02 + 0.2 * k) * (rnd() * 2 - 1 - lp);
    return 0.16 * lp * Math.sin(Math.PI * k) ** 2;
  }, 0.5);
};
for (const e of events) {
  if (e.type === "click") mouseClick(e.t);
  else if (e.type === "key") key(e.t, e.soft);
  else if (e.type === "enter") key(e.t, true);
  else if (e.type === "ding") ding(e.t + 0.05);
  else if (e.type === "pop") pop(e.t, e.soft);
  else if (e.type === "whoosh") whoosh(e.t);
  else if (e.type === "vo" && clip[e.id]) {
    const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", join(VO_DIR, clip[e.id].file), "-af", `atempo=${TEMPO}`, "-f", "f32le", "-ar", String(SR), "-ac", "1", "-"], { maxBuffer: 1 << 28 });
    const pcm = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
    const start = Math.round(e.t * SR);
    for (let i = 0; i < pcm.length && start + i < len; i++) voice[start + i] += pcm[i];
  }
}
const wav = (name, data) => {
  const b = Buffer.alloc(44 + data.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + data.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  writeFileSync(join(WORK, name), b);
};
wav("voice.wav", voice);
wav("sfx.wav", sfx);

// One calm bed for the whole film, ducked under the voice.
execFileSync("node", ["scripts/make-music.mjs"], { stdio: "inherit", env: { ...process.env, MUSIC_SECTIONS: JSON.stringify([{ mood: "calm", seconds: Number((total + 1).toFixed(2)) }]), MUSIC_NO_MUX: "1", MUSIC_OUT: join(WORK, "music.mp3") } });
const hasVoice = manifest.lines.length > 0;
const mix = [
  `[1:a]highpass=f=70,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=160:makeup=2,asplit=2[vA][vB]`,
  `[3:a]volume=0.5[music]`,
  `[music][vA]sidechaincompress=threshold=0.02:ratio=8:attack=40:release=700[bed]`,
  `[bed][vB][2:a]amix=inputs=3:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.4,afade=t=out:st=${(total - 1.6).toFixed(2)}:d=1.6[a]`,
].join(";");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", "picture.mp4", "-i", "voice.wav", "-i", "sfx.wav", "-i", "music.mp3", "-filter_complex", mix, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-t", total.toFixed(2), "-movflags", "+faststart", OUT], { cwd: WORK, stdio: "inherit" });

// Poster: the split, a few seconds into the second problem.
const posterAt = (events.find((e) => e.type === "vo" && e.id === "s2b")?.t ?? total / 3) + 0.8;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", posterAt.toFixed(2), "-i", OUT, "-frames:v", "1", "-q:v", "3", POSTER], { stdio: "inherit" });
console.log(`video written: ${OUT} (${(statSync(OUT).size / 1048576).toFixed(1)} MB, ${total.toFixed(1)}s${hasVoice ? "" : ", NO narration yet"})`);
if (!process.env.DEMO_KEEP) rmSync(join(WORK, "frames"), { recursive: true, force: true });
