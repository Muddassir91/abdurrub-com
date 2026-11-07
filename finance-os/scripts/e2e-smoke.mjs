// End-to-end smoke test against the static export, served the way GitHub Pages
// will serve it (repo root, app under /finance/). Exercises the real browser
// SQLite engine: seed, record transactions, verify dashboard math, persistence
// across reload, month close and backup export.
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { createRequire } from "node:module";

// Playwright is resolved via require so a globally installed copy works too.
const { chromium } = createRequire(import.meta.url)("playwright");

const ROOT = resolve(process.cwd(), "..");
const PORT = 4173;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = join(ROOT, p);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file) && existsSync(file + ".html")) file = file + ".html";
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end("not found: " + p);
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " · " + detail : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

try {
  await page.goto(`http://localhost:${PORT}/finance/`, { waitUntil: "networkidle" });
  await page.getByText("Set up Finance OS").waitFor({ timeout: 20000 });
  check("Fresh browser shows the sign-up screen", true);
  await page.getByRole("button", { name: "Create workspace and open" }).click();
  await page.getByText("overview").first().waitFor({ timeout: 20000 });
  check("App boots and seeds the database", await page.getByText("Retention Rules").first().isVisible());
  check("Dashboard shows the lean policy", await page.getByText("Lean solo operation").first().isVisible());
  await page.screenshot({ path: "../finance-os/.e2e/dashboard-empty.png", fullPage: true }).catch(() => {});

  // Record a $4,000 client payment via the Transactions page.
  await page.goto(`http://localhost:${PORT}/finance/transactions/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Record" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").first().selectOption("client_payment");
  await dialog.locator('input[inputmode="decimal"]').first().fill("4000");
  await dialog.getByPlaceholder(/e\.g\. ListKit monthly/).fill("November commission");
  await dialog.getByRole("button", { name: "Record" }).click();
  await page.getByText("Transaction recorded").last().waitFor();
  await page.locator("aside").getByText(/Saved /).waitFor();
  check("Client payment recorded", await page.getByText("November commission").first().isVisible());

  // Record an $831 overhead expense.
  await page.getByRole("button", { name: "Record" }).first().click();
  await dialog.getByRole("combobox").first().selectOption("expense");
  await dialog.locator('input[inputmode="decimal"]').first().fill("831");
  await dialog.getByPlaceholder(/e\.g\. ListKit monthly/).fill("Tool stack");
  await dialog.getByRole("button", { name: "Record" }).click();
  await page.getByText("Transaction recorded").last().waitFor();
  await page.locator("aside").getByText(/Saved /).waitFor();

  // Record a PKR household expense (50,000 PKR at default 280 -> $178.57).
  await page.getByRole("button", { name: "Record" }).first().click();
  await dialog.getByRole("combobox").first().selectOption("household_expense");
  const currencySelect = dialog.getByRole("combobox").nth(1);
  await currencySelect.selectOption("PKR");
  await dialog.locator('input[inputmode="decimal"]').first().fill("50000");
  await dialog.getByPlaceholder(/e\.g\. ListKit monthly/).fill("Groceries");
  await dialog.getByRole("button", { name: "Record" }).click();
  await page.getByText("Transaction recorded").last().waitFor();
  await page.locator("aside").getByText(/Saved /).waitFor();
  check("PKR expense converted at the transaction rate", await page.getByText("$178.57").first().isVisible());

  // Dashboard figures: Scenario A allocations and expense health.
  await page.goto(`http://localhost:${PORT}/finance/`, { waitUntil: "networkidle" });
  const body = await page.locator("body").innerText();
  check("Owner compensation = $1,400.00", body.includes("$1,400.00"));
  check("Tax reserve = $600.00", body.includes("$600.00"));
  check("Operating ceiling $1,000.00 with $831.00 spent", body.includes("$1,000.00") && body.includes("$831.00"));
  check("Remaining allowance $169.00", body.includes("$169.00"));
  check("Opex ratio 20.8%", body.includes("20.8%"));
  await page.screenshot({ path: "../finance-os/.e2e/dashboard.png", fullPage: true }).catch(() => {});

  // Persistence across reload.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("overview").first().waitFor();
  const body2 = await page.locator("body").innerText();
  check("Data persists after reload (IndexedDB)", body2.includes("$1,400.00") && body2.includes("$831.00"));

  // Dark mode toggle.
  await page.getByRole("button", { name: "Toggle theme" }).click();
  check("Dark theme toggles", await page.evaluate(() => document.documentElement.classList.contains("dark")));
  await page.screenshot({ path: "../finance-os/.e2e/dashboard-dark.png", fullPage: true }).catch(() => {});
  await page.getByRole("button", { name: "Toggle theme" }).click();

  // Scenarios page preset check ($10,000 -> owner $3,500).
  await page.goto(`http://localhost:${PORT}/finance/scenarios/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "$10k", exact: true }).click();
  const sBody = await page.locator("body").innerText();
  check("Scenario B owner compensation $3,500.00", sBody.includes("$3,500.00") && sBody.includes("$2,500.00"));
  await page.screenshot({ path: "../finance-os/.e2e/scenarios.png", fullPage: true }).catch(() => {});

  // Whop sale with fee lines.
  await page.goto(`http://localhost:${PORT}/finance/whop/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Record sale" }).first().click();
  const wd = page.getByRole("dialog");
  await wd.locator('input[inputmode="decimal"]').first().fill("1000");
  await wd.getByPlaceholder("November revenue share").fill("Whop test sale");
  await wd.getByRole("button", { name: "Record sale" }).click();
  await page.getByText("Sale recorded with fee lines").waitFor();
  await page.locator("aside").getByText(/Saved /).waitFor();
  const wBody = await page.locator("body").innerText();
  check("Whop sale shows gross $1,000 and fees ($27.30 + $30.00)", wBody.includes("$1,000.00") && wBody.includes("$57.30"));
  await page.screenshot({ path: "../finance-os/.e2e/whop.png", fullPage: true }).catch(() => {});

  // Month-end: tick all steps and close.
  await page.goto(`http://localhost:${PORT}/finance/month-end/`, { waitUntil: "networkidle" });
  const steps = page.locator("button:has(svg.lucide-circle)");
  const n = await steps.count();
  for (let i = 0; i < n; i++) await page.locator("button:has(svg.lucide-circle)").first().click();
  await page.getByRole("button", { name: /^Close / }).click();
  await page.getByText(/closed$/).first().waitFor();
  check("Month closed and report generated", await page.getByText("Reports").first().isVisible());
  await page.screenshot({ path: "../finance-os/.e2e/month-end.png", fullPage: true }).catch(() => {});

  // Reserves page shows booked envelope.
  await page.goto(`http://localhost:${PORT}/finance/reserves/`, { waitUntil: "networkidle" });
  const rBody = await page.locator("body").innerText();
  check("Reserve envelope credited after close", rBody.includes("Allocation booked at month close"));

  // Backup export triggers a download.
  await page.goto(`http://localhost:${PORT}/finance/settings/`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Backup & restore" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download backup/ }).click()]);
  check("Backup download produced", (await download.suggestedFilename()).endsWith(".sqlite"));

  // Workspaces: add a second business, check isolation, switch back.
  await page.goto(`http://localhost:${PORT}/finance/settings/`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Workspaces" }).click();
  await page.getByRole("button", { name: "Add business or person" }).first().click();
  const wsd = page.getByRole("dialog");
  await wsd.getByPlaceholder("e.g. Second agency, Ahmed").fill("Second Agency");
  await wsd.locator("input").nth(1).fill("Second Agency Ltd");
  await wsd.locator("input").nth(2).fill("Someone Else");
  await wsd.getByRole("button", { name: "Create workspace" }).click();
  await page.locator("aside").getByText("Second Agency Ltd").first().waitFor({ timeout: 20000 });
  await page.locator("aside").getByText(/Saved /).waitFor();
  await page.goto(`http://localhost:${PORT}/finance/`, { waitUntil: "networkidle" });
  const ws2 = await page.locator("body").innerText();
  check("Second workspace starts empty (no $4,000 collected)", !ws2.includes("$4,000.00") && ws2.includes("Second Agency"), `has4000=${ws2.includes("$4,000.00")} hasName=${ws2.includes("Second Agency")} aside=${(await page.locator("aside").innerText()).split("\n").slice(0,3).join("/")}`);
  await page.locator("aside").getByTitle("Switch workspace").click();
  await page.getByRole("option", { name: "Retention Rules" }).click();
  let restored = true;
  try {
    await page.locator("aside").getByText("Retention Rules").first().waitFor({ timeout: 20000 });
    await page.getByText("$5,000.00").first().waitFor({ timeout: 20000 }); // $4,000 commission + $1,000 Whop sale
  } catch {
    restored = false;
  }
  check("Switching back restores Retention Rules data", restored);
  await page.screenshot({ path: "../finance-os/.e2e/workspaces.png", fullPage: false }).catch(() => {});

  // Appearance setting: follow system.
  await page.goto(`http://localhost:${PORT}/finance/settings/`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByRole("button", { name: /Dark/ }).click();
  check("Appearance: dark applied", await page.evaluate(() => document.documentElement.classList.contains("dark")));
  await page.getByRole("button", { name: /Follow system/ }).click();
  check("Appearance: follow system stored", await page.evaluate(() => localStorage.getItem("finance-os:theme") === "system"));

  // Visit every page for runtime errors.
  for (const p of ["expenses", "clients", "personal", "accounts", "tax", "growth", "forecast", "alerts"]) {
    await page.goto(`http://localhost:${PORT}/finance/${p}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: "../finance-os/.e2e/alerts.png", fullPage: true }).catch(() => {});
  const realErrors = errors.filter((e) => !/favicon/i.test(e));
  check("No runtime errors across all pages", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
} catch (e) {
  check("Smoke test completed", false, String(e));
  await page.screenshot({ path: "../finance-os/.e2e/failure.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
