// Live check of the assistant against the REAL Worker and model (uses the daily free allowance):
// opens the sample workspace from the built site and sends three messages through the ask bar.
// Usage: node scripts/e2e-assistant-live.mjs
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const ROOT = resolve(process.cwd(), "..");
const PORT = 4178;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let file = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const browser = await chromium.launch({ proxy });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " · " + detail : ""}`); };
try {
  await page.goto(`http://localhost:${PORT}/cfoh/app/?demo=1`, { waitUntil: "networkidle" });
  await page.getByText("Hi Sam").first().waitFor({ timeout: 30000 });
  const bar = page.locator("[data-askbar]");
  const say = async (text, needle) => {
    const t = Date.now();
    await bar.getByLabel("Ask CFoh!").fill(text);
    await bar.getByLabel("Ask CFoh!").press("Enter");
    await bar.locator("[data-assistant-reply]").filter({ hasText: needle }).first().waitFor({ timeout: 45000 });
    return { text: (await bar.locator("[data-assistant-reply]").first().innerText()).replace(/\n/g, " | "), ms: Date.now() - t };
  };
  let r = await say("how much is left under my running costs ceiling this month?", /817/);
  check("Live model answers a question from this month's numbers", /817/.test(r.text), `${r.ms} ms · ${r.text}`);
  r = await say("my assistant charged me 30 bucks for transcription and I also got a 2,000 deposit from Harbor Coffee", /Added/);
  check("Live model turns a loose sentence into entries", /\$30\.00 out/.test(r.text) && /\$2,000\.00 in/.test(r.text), `${r.ms} ms · ${r.text}`);
  r = await say("honestly this screen is too busy, strip it down for me", /layout|Hid/);
  check("Live model customizes the dashboard", /simple layout|Hid/.test(r.text), `${r.ms} ms · ${r.text}`);
} catch (e) {
  check("Live assistant test completed", false, String(e).slice(0, 300));
  await page.screenshot({ path: ".e2e/assistant-live-failure.png" }).catch(() => {});
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
