// Live cloud test: signs up a throwaway account against the REAL Supabase
// project, creates a workspace, checks it syncs, then signs in from a second
// browser context and sees the same workspace with its data.
// Usage: TEST_EMAIL=... TEST_PASSWORD=... node scripts/e2e-cloud-live.mjs
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const ROOT = resolve(process.cwd(), "..");
const PORT = 4177;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let file = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const email = process.env.TEST_EMAIL ?? `cfoh-test-${Date.now()}@example.com`;
const password = process.env.TEST_PASSWORD ?? `Test-${Date.now()}-pass`;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " · " + detail : ""}`); };
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const browser = await chromium.launch({ proxy });
const U = `http://localhost:${PORT}/cfoh/`;

try {
  // Device A: sign up, create workspace, record a payment, expect sync.
  const a = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  const pa = await a.newPage();
  const errsA = [];
  pa.on("pageerror", (e) => errsA.push(String(e)));
  pa.on("console", (m) => m.type() === "error" && errsA.push(m.text()));
  await pa.goto(U, { waitUntil: "networkidle" });
  await pa.getByRole("button", { name: "Create an account" }).click();
  await pa.getByPlaceholder("you@yourbusiness.com").fill(email);
  await pa.locator('input[type="password"]').fill(password);
  await pa.getByRole("button", { name: "Create account", exact: true }).click();
  await pa.getByText("Set up").first().waitFor({ timeout: 30000 });
  check("Live: account created and reached workspace setup", true);
  await pa.getByRole("button", { name: "Create workspace and open" }).click();
  await pa.getByText("overview").first().waitFor({ timeout: 30000 });
  await pa.locator("aside").getByText(/Synced/).first().waitFor({ timeout: 30000 });
  check("Live: workspace uploaded to the account", true);
  await pa.goto(U + "transactions/", { waitUntil: "networkidle" });
  await pa.getByRole("button", { name: "Record" }).first().click();
  const d = pa.getByRole("dialog");
  await d.getByRole("combobox").first().selectOption("client_payment");
  await d.locator('input[inputmode="decimal"]').first().fill("1234");
  await d.getByPlaceholder(/e\.g\. ListKit monthly/).fill("Live sync test payment");
  await d.getByRole("button", { name: "Record" }).click();
  await pa.getByText("Transaction recorded").last().waitFor();
  await pa.waitForTimeout(3500); // debounce + upload
  await pa.locator("aside").getByText(/Synced/).first().waitFor({ timeout: 30000 });
  check("Live: change synced after recording a payment", errsA.filter((e) => !/favicon/.test(e)).length === 0, errsA.slice(0, 2).join(" | "));
  await a.close();

  // Device B: fresh browser, sign in, expect the workspace and the payment.
  const b = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  const pb = await b.newPage();
  const errsB = [];
  pb.on("pageerror", (e) => errsB.push(String(e)));
  await pb.goto(U, { waitUntil: "networkidle" });
  await pb.getByPlaceholder("you@yourbusiness.com").fill(email);
  await pb.locator('input[type="password"]').fill(password);
  await pb.getByRole("button", { name: "Sign in", exact: true }).click();
  await pb.getByText("overview").first().waitFor({ timeout: 30000 });
  const body = await pb.locator("body").innerText();
  check("Live: second device downloads the workspace with its data ($1,234.00)", body.includes("$1,234.00") && body.includes("Retention Rules"), errsB.slice(0, 2).join(" | "));
  await pb.screenshot({ path: ".e2e/cloud-live.png", fullPage: false }).catch(() => {});
  await b.close();
} catch (e) {
  check("Live cloud test completed", false, String(e));
} finally {
  await browser.close();
  server.close();
}
console.log(`TEST_EMAIL=${email}`);
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
