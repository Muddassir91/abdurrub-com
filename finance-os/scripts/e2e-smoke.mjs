// End-to-end smoke test against the static export, served the way GitHub Pages
// will serve it (repo root, app under /cfoh/). Exercises the real browser
// SQLite engine: seed, record transactions, verify dashboard math, persistence
// across reload, month close and backup export.
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { createRequire } from "node:module";

// Playwright is resolved via require so a globally installed copy works too.
const { chromium } = createRequire(import.meta.url)("playwright");
import { runOnboarding, quickAdd } from "./e2e-helpers.mjs";

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

// The assistant Worker, run locally with a stand-in model so the whole path is exercised:
// app -> Worker request handling -> JSON answer -> actions validated and applied in the app.
import { bundle } from "./deploy-assistant.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync(join(process.cwd(), ".e2e"), { recursive: true });
writeFileSync(join(process.cwd(), ".e2e", "assistant.bundle.mjs"), bundle());
const worker = (await import(join(process.cwd(), ".e2e", "assistant.bundle.mjs"))).default;
const ASSISTANT_PORT = 4174;
const fakeAI = {
  run: async (_model, { messages }) => {
    const last = messages[messages.length - 1].content;
    const msg = last.slice(last.lastIndexOf("Message:") + 8).trim().toLowerCase();
    const hasContext = /this month: collected/.test(last);
    if (msg.includes("meaning of life")) throw new Error("4006: you have used up your daily free allocation of 10,000 neurons");
    if (msg.includes("afford")) return { response: JSON.stringify({ reply: hasContext ? "Your running-costs ceiling is 1,125 and 308 has gone out. The decision is yours." : "no context", actions: [] }) };
    if (msg.includes("rent went up")) return { response: 'Sure! ```json\n{"reply": "", "actions": [{"name": "update_setup", "args": {"homeLine": {"name": "Rent", "amount": 1600}}}]}\n```' };
    if (msg.includes("delete")) return { response: { reply: "", actions: [{ name: "delete_transaction", args: { match: "figma" } }, { name: "format_disk", args: {} }] } };
    return { response: JSON.stringify({ reply: "I am not sure.", actions: [] }) };
  },
};
const assistantServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request(`http://localhost:${ASSISTANT_PORT}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks) }), { AI: fakeAI });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => assistantServer.listen(ASSISTANT_PORT, r));

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
  // Marketing homepage: rotating headline, interactive demo, CTAs into the app.
  await page.goto(`http://localhost:${PORT}/cfoh/`, { waitUntil: "networkidle" });
  const home = await page.locator("body").innerText();
  const homeLc = home.toLowerCase();
  check("Homepage renders header, subheader, video, comparison and use cases", homeLc.includes("make better financial decisions") && homeLc.includes("without hiring a cfo") && homeLc.includes("watch the demo") && homeLc.includes("the old way") && homeLc.includes("freelancers") && !homeLc.includes("live demo"));
  // One product video; nothing is downloaded until play is pressed.
  check("Homepage shows the demo video behind a play button", (await page.locator("#demo video").count()) === 0 && (await page.locator("#demo").getByRole("button", { name: /Play the CFoh! demo video/ }).isVisible()));
  await page.locator("#demo").getByRole("button", { name: /Play the CFoh! demo video/ }).click();
  const videoSrc = await page.locator("#demo video").getAttribute("src");
  const head = await fetch(`http://localhost:${PORT}${videoSrc}`, { method: "GET", headers: { Range: "bytes=0-1023" } });
  check("Pressing play loads the video file", /cfoh-demo\.mp4$/.test(videoSrc ?? "") && head.ok, `${videoSrc} -> ${head.status}`);
  await page.reload({ waitUntil: "networkidle" });
  const firstPhrase = await page.locator("h1 [aria-live]").innerText();
  await page.waitForTimeout(3200);
  const secondPhrase = await page.locator("h1 [aria-live]").innerText();
  check("Homepage headline rotates", firstPhrase.trim() !== secondPhrase.trim(), `${firstPhrase.trim()} -> ${secondPhrase.trim()}`);
  await page.screenshot({ path: "../finance-os/.e2e/home.png", fullPage: true }).catch(() => {});
  await page.getByRole("link", { name: "Start free" }).first().click();
  await page.waitForURL(/\/cfoh\/app\/?$/, { timeout: 20000 });
  check("Homepage CTA opens the app", true);
  // With cloud accounts configured the first screen is sign-in; device-only mode is still offered.
  const deviceOnly = page.getByRole("button", { name: /Continue without an account/ });
  if (await deviceOnly.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false)) {
    check("Fresh browser shows the sign-in screen", true);
    await deviceOnly.click();
  }
  await page.locator("[data-onboarding]").waitFor({ timeout: 20000 });
  check("Device-only path reaches the setup questions", true);
  await page.screenshot({ path: "../finance-os/.e2e/onboarding.png", fullPage: false }).catch(() => {});
  const onb = await runOnboarding(page, { name: "Muddassir", business: "Retention Rules", currency: "USD", home: "PKR", fx: "280", income: "4000" });
  await page.getByText(/^Hi /).first().waitFor({ timeout: 20000 });
  check("Setup questions run one at a time and build the dashboard", onb.length >= 20 && onb[0] === "name" && onb[onb.length - 1] === "split", `${onb.length} steps`);
  check("App boots and seeds the database", await page.locator("aside").getByText("Retention Rules").first().isVisible());
  const empty = await page.locator("body").innerText();
  check("Empty dashboard invites the first entry", empty.includes("Nothing recorded") && empty.includes("Add money in"));
  await page.screenshot({ path: "../finance-os/.e2e/dashboard-empty.png", fullPage: true }).catch(() => {});

  // Quick add: $4,000 in, $831 business out, 50,000 PKR household out (at 280 -> $178.57).
  await quickAdd(page, { tab: "in", amount: 4000, what: "November commission" });
  await page.locator("aside").getByText(/Saved /).waitFor();
  await quickAdd(page, { tab: "out", side: "Business", amount: 831, what: "Tool stack", category: "Software and AI" });
  await page.locator("aside").getByText(/Saved /).waitFor();
  await quickAdd(page, { tab: "out", side: "Personal", currency: "PKR", amount: 50000, what: "Groceries", category: "Food", household: true });
  await page.locator("aside").getByText(/Saved /).waitFor();
  let body = await page.locator("body").innerText();
  check("Quick add records money in and out", body.includes("November commission") && body.includes("Tool stack") && body.includes("Groceries"));
  check("PKR expense converted at the transaction rate", body.includes("$178.57"));

  // Dashboard figures from the setup split (10/20/15/22/22/11 on $4,000).
  check("Hero shows money in $4,000, out $1,010 and kept $3,169", body.includes("$4,000") && body.includes("$1,010") && body.includes("$3,169"), body.split("\n").slice(0, 12).join(" | "));
  check("Split shows your pay $800 and tax $600", body.includes("$800") && body.includes("$600"));
  check("Running costs over the $400 ceiling by $431", body.includes("$431 over"));
  check("Home essentials show the PKR spend", body.includes("Home essentials"));
  check("Activity list and category donut present", body.includes("Recent activity") && body.includes("Where it went") && body.includes("Software and AI"));
  await page.screenshot({ path: "../finance-os/.e2e/dashboard.png", fullPage: true }).catch(() => {});

  // Transactions page still records through the full form.
  await page.goto(`http://localhost:${PORT}/cfoh/app/transactions/`, { waitUntil: "networkidle" });
  check("Activity page lists the quick-add rows", (await page.locator("body").innerText()).includes("November commission"));

  // Persistence across reload.
  await page.goto(`http://localhost:${PORT}/cfoh/app/`, { waitUntil: "networkidle" });
  await page.getByText(/^Hi /).first().waitFor();
  const body2 = await page.locator("body").innerText();
  check("Data persists after reload (IndexedDB)", body2.includes("$4,000") && body2.includes("$431 over"));

  // Dark mode toggle.
  await page.getByRole("button", { name: "Toggle theme" }).click();
  check("Dark theme toggles", await page.evaluate(() => document.documentElement.classList.contains("dark")));
  await page.screenshot({ path: "../finance-os/.e2e/dashboard-dark.png", fullPage: true }).catch(() => {});
  await page.getByRole("button", { name: "Toggle theme" }).click();

  // Scenarios page preset check ($10,000 -> pay 20% = $2,000, tax 15% = $1,500).
  await page.goto(`http://localhost:${PORT}/cfoh/app/scenarios/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "$10k", exact: true }).click();
  const sBody = await page.locator("body").innerText();
  check("Scenario B owner pay $2,000.00 and tax $1,500.00", sBody.includes("$2,000.00") && sBody.includes("$1,500.00"));
  await page.screenshot({ path: "../finance-os/.e2e/scenarios.png", fullPage: true }).catch(() => {});

  // Whop sale with fee lines.
  await page.goto(`http://localhost:${PORT}/cfoh/app/whop/`, { waitUntil: "networkidle" });
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
  await page.goto(`http://localhost:${PORT}/cfoh/app/month-end/`, { waitUntil: "networkidle" });
  const steps = page.locator("button:has(svg.lucide-circle)");
  const n = await steps.count();
  for (let i = 0; i < n; i++) await page.locator("button:has(svg.lucide-circle)").first().click();
  await page.getByRole("button", { name: /^Close / }).click();
  await page.getByText(/closed$/).first().waitFor();
  check("Month closed and report generated", await page.getByText("Reports").first().isVisible());
  await page.screenshot({ path: "../finance-os/.e2e/month-end.png", fullPage: true }).catch(() => {});

  // Reserves page shows booked envelope.
  await page.goto(`http://localhost:${PORT}/cfoh/app/reserves/`, { waitUntil: "networkidle" });
  const rBody = await page.locator("body").innerText();
  check("Reserve envelope credited after close", rBody.includes("Allocation booked at month close"));

  // Backup export triggers a download.
  await page.goto(`http://localhost:${PORT}/cfoh/app/settings/`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Backup & restore" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download backup/ }).click()]);
  check("Backup download produced", (await download.suggestedFilename()).endsWith(".sqlite"));

  // Workspaces: add a second business, check isolation, switch back.
  await page.goto(`http://localhost:${PORT}/cfoh/app/settings/`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Workspaces" }).click();
  await page.getByRole("button", { name: "Add business or person" }).first().click();
  const wsd = page.getByRole("dialog");
  await wsd.getByPlaceholder("e.g. Second agency, Ahmed").fill("Second Agency");
  await wsd.locator("input").nth(1).fill("Second Agency Ltd");
  await wsd.locator("input").nth(2).fill("Someone Else");
  await wsd.getByRole("button", { name: "Create workspace" }).click();
  await page.locator("[data-onboarding]").waitFor({ timeout: 20000 });
  check("A new workspace goes through the setup questions", true);
  await runOnboarding(page, { name: "Someone", business: "Second Agency Ltd", currency: "USD", home: "USD", income: "2000" });
  await page.locator("aside").getByText(/Saved /).waitFor();
  await page.goto(`http://localhost:${PORT}/cfoh/app/`, { waitUntil: "networkidle" });
  await page.getByText(/^Hi /).first().waitFor({ timeout: 20000 });
  const ws2 = await page.locator("body").innerText();
  check("Second workspace starts empty (no $4,000 collected)", !ws2.includes("$4,000") && ws2.includes("Second Agency") && ws2.includes("Hi Someone"), `has4000=${ws2.includes("$4,000")} hasName=${ws2.includes("Second Agency")}`);
  await page.locator("aside").getByTitle("Switch workspace").click();
  await page.getByRole("option", { name: "Retention Rules" }).click();
  let restored = true;
  try {
    await page.locator("aside").getByText("Retention Rules").first().waitFor({ timeout: 20000 });
    await page.getByText("$4,943").first().waitFor({ timeout: 20000 }); // $4,000 commission + $1,000 Whop sale − $57.30 fees
  } catch {
    restored = false;
  }
  check("Switching back restores Retention Rules data", restored);
  await page.screenshot({ path: "../finance-os/.e2e/workspaces.png", fullPage: false }).catch(() => {});

  // Appearance setting: follow system.
  await page.goto(`http://localhost:${PORT}/cfoh/app/settings/`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByRole("button", { name: /Dark/ }).click();
  check("Appearance: dark applied", await page.evaluate(() => document.documentElement.classList.contains("dark")));
  await page.getByRole("button", { name: /Follow system/ }).click();
  check("Appearance: follow system stored", await page.evaluate(() => localStorage.getItem("finance-os:theme") === "system"));

  // Trends page renders the four granularities.
  await page.goto(`http://localhost:${PORT}/cfoh/app/trends/`, { waitUntil: "networkidle" });
  for (const g of ["Daily", "Weekly", "Monthly", "Yearly"]) await page.getByRole("tab", { name: g }).click();
  check("Trends page renders all granularities", (await page.locator("body").innerText()).includes("Net revenue"));
  await page.screenshot({ path: "../finance-os/.e2e/trends.png", fullPage: true }).catch(() => {});

  // Cloud accounts (in-memory backend): sign up, workspace uploaded, sign out, sign in again sees it.
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx2.addInitScript(() => localStorage.setItem("finance-os:cloud", "memory"));
  const p2 = await ctx2.newPage();
  const errors2 = [];
  p2.on("pageerror", (e) => errors2.push(String(e)));
  await p2.goto(`http://localhost:${PORT}/cfoh/app/`, { waitUntil: "networkidle" });
  check("Cloud: sign-in screen offers Google", await p2.getByRole("button", { name: "Continue with Google" }).isVisible());
  await p2.getByRole("button", { name: "Create an account" }).click();
  await p2.getByPlaceholder("you@yourbusiness.com").fill("owner@example.com");
  await p2.locator('input[type="password"]').fill("correct-horse-battery");
  await p2.getByRole("button", { name: "Create account", exact: true }).click();
  await p2.locator("[data-onboarding]").waitFor({ timeout: 20000 });
  check("Cloud: sign-up leads straight to the setup questions", true);
  await runOnboarding(p2, { name: "Owner", business: "Owner Co", home: "USD" });
  await p2.getByText("Hi Owner").first().waitFor({ timeout: 20000 });
  await p2.locator("aside").getByText(/Synced/).first().waitFor({ timeout: 20000 });
  check("Cloud: workspace synced to account", true);
  const tReload = Date.now();
  await p2.reload();
  await p2.getByText("Hi Owner").first().waitFor({ timeout: 20000 });
  const reloadMs = Date.now() - tReload;
  await p2.locator("aside").getByText(/Synced/).first().waitFor({ timeout: 20000 });
  check("Cloud: a returning user opens from the local copy, then syncs in the background", true, `${reloadMs} ms to dashboard`);
  await p2.goto(`http://localhost:${PORT}/cfoh/app/settings/?tab=account`, { waitUntil: "networkidle" });
  check("Cloud: account tab shows the signed-in email", (await p2.locator("body").innerText()).includes("owner@example.com"));
  check("Cloud: no runtime errors in account flow", errors2.length === 0, errors2.slice(0, 2).join(" | "));
  await ctx2.close();

  // Google button path (memory backend signs in immediately).
  const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx3.addInitScript(() => localStorage.setItem("finance-os:cloud", "memory"));
  const p3 = await ctx3.newPage();
  await p3.goto(`http://localhost:${PORT}/cfoh/app/`, { waitUntil: "networkidle" });
  await p3.screenshot({ path: "../finance-os/.e2e/auth.png", fullPage: false }).catch(() => {});
  await p3.getByRole("button", { name: "Continue with Google" }).click();
  await p3.locator("[data-onboarding]").waitFor({ timeout: 20000 });
  check("Cloud: Google sign-in path reaches the setup questions", true);
  await ctx3.close();

  // Live demo link seeds the sample workspace without an account.
  const ctxD = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pd = await ctxD.newPage();
  await pd.goto(`http://localhost:${PORT}/cfoh/app/?demo=1`, { waitUntil: "networkidle" });
  await pd.getByText("Hi Sam").first().waitFor({ timeout: 30000 });
  const demoBody = await pd.locator("body").innerText();
  check("Live demo opens the Northstar sample workspace with data, no questions asked", demoBody.includes("Northstar Studio") && /\$[1-9]/.test(demoBody) && demoBody.includes("Where it went"));
  await pd.screenshot({ path: "../finance-os/.e2e/demo-dashboard.png", fullPage: false }).catch(() => {});
  await ctxD.close();

  // The assistant, on the sample workspace: on-device commands, the model path, undo, setup review.
  const ctxAs = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctxAs.addInitScript((u) => localStorage.setItem("finance-os:assistant-url", u), `http://localhost:${ASSISTANT_PORT}`);
  const pas = await ctxAs.newPage();
  const errorsAs = [];
  pas.on("pageerror", (e) => errorsAs.push(String(e)));
  await pas.goto(`http://localhost:${PORT}/cfoh/app/?demo=1`, { waitUntil: "networkidle" });
  await pas.getByText("Hi Sam").first().waitFor({ timeout: 30000 });
  const bar = pas.locator("[data-askbar]");
  const say = async (text) => {
    await bar.getByLabel("Ask CFoh!").fill(text);
    await bar.getByLabel("Ask CFoh!").press("Enter");
  };
  const replyText = async (needle) => {
    await bar.locator("[data-assistant-reply]").filter({ hasText: needle }).first().waitFor({ timeout: 15000 });
    return bar.locator("[data-assistant-reply]").first().innerText();
  };
  check("Home leads with the ask bar and what to do next", (await bar.isVisible()) && (await pas.getByText("What to do next").isVisible()));
  const tSay = Date.now();
  await say("spent 20 on lunch");
  const added = await replyText("Added");
  const sayMs = Date.now() - tSay;
  check("Assistant records spending from plain words, on the device", added.includes("$20.00") && added.includes("Lunch") && (await pas.locator("body").innerText()).includes("Lunch"), `${sayMs} ms from Enter to updated screen`);
  await bar.getByRole("button", { name: "Undo" }).click();
  await replyText("Undone");
  check("Undo reverses the assistant's last change", !(await pas.getByText("Recent activity").locator("xpath=ancestor::section[1]").innerText()).includes("Lunch"));
  await say("got paid 900 from Harbor Coffee and paid myself 300");
  const two = await replyText("paid to you");
  check("Several commands in one message", two.includes("$900.00 in") && two.includes("$300.00 paid to you"));
  await say("hide budgets");
  await replyText("Hid Budgets");
  check("Assistant hides a dashboard section", !(await pas.locator("body").innerText()).includes("Your ceiling this month"));
  await say("show everything");
  await replyText("everything layout");
  const everything = await pas.locator("body").innerText();
  check("Assistant switches the layout", everything.includes("Your ceiling this month") && everything.includes("In and out, week by week") && everything.includes("Coming up"));
  await say("track food under 300");
  await replyText("Added a tracker");
  check("Assistant adds a custom tracker", await pas.locator('[data-section="trackers"]').getByText("Food this month").isVisible());
  const tAsk = Date.now();
  await say("How much is left for running costs?");
  const leftAnswer = await replyText("is left this month");
  check("Common questions are answered on the device, without the model", /Running costs: \$[\d,]+ spent of a \$[\d,]+ ceiling/.test(leftAnswer), `${Date.now() - tAsk} ms · ${leftAnswer.replace(/\n/g, " ")}`);
  await say("who are you?");
  check("It introduces itself as CFoh!", (await replyText("I'm CFoh!")).includes("I'm CFoh!"));
  await say("what is the meaning of life?");
  const limitMsg = await replyText("today's limit");
  check("When the model's daily limit is used up it says so plainly and stays useful", limitMsg.includes("resets at midnight UTC") && limitMsg.includes("how much is left") && !/assistant|resting/i.test(limitMsg), limitMsg.replace(/\n/g, " | "));
  await say("can I afford a new 200 dollar tool?");
  const afford = await replyText("The decision is yours");
  check("Questions go to the model with this month's numbers", afford.includes("1,125"));
  await say("my rent went up to 1600");
  const rent = await replyText("Home budget");
  check("Model answers become validated actions", rent.includes("Rent set to 1600 USD"), rent.replace(/\n/g, " | "));
  await say("please delete the figma charge");
  await replyText("Want me to go ahead");
  check("Destructive actions from the model wait for a yes, unknown actions are dropped", (await bar.getByRole("button", { name: "Yes, do it" }).isVisible()) && !(await bar.innerText()).includes("format"));
  await bar.getByRole("button", { name: "No" }).click();
  await pas.getByRole("button", { name: "I paid myself" }).click();
  await replyText("paid to you");
  check("What to do next acts in one tap", !(await pas.locator('[data-section="next"]').innerText()).includes("still in the business"));
  await pas.getByRole("button", { name: "Ask CFoh!" }).first().click();
  check("Assistant panel opens from any page", await pas.locator("[data-assistant-panel]").isVisible());
  await pas.keyboard.press("Escape");
  await say("I misunderstood the onboarding questions, I need to go through that again");
  await pas.locator('[data-setup-review="list"]').waitFor({ timeout: 15000 });
  check("Asking to redo setup opens every answer on one screen", (await pas.locator('[data-setup-review="list"]').innerText()).includes("Share of income for tax"));
  await pas.locator('[data-row="tax"]').click();
  await pas.getByLabel("Percentage").fill("1");
  await pas.getByRole("button", { name: "Done" }).click();
  await pas.getByRole("button", { name: "Save changes" }).click();
  await pas.getByText("Hi Sam").first().waitFor({ timeout: 15000 });
  const afterSetup = await pas.locator("body").innerText();
  check("One setup answer changes without touching entries", afterSetup.includes("Tax · 1%") && afterSetup.includes("Harbor Coffee"));
  await pas.getByRole("button", { name: "Edit my setup" }).click();
  check("Setup is one tap from Home", await pas.locator('[data-setup-review="list"]').isVisible());
  await pas.getByRole("button", { name: "Close setup" }).click();
  await pas.screenshot({ path: "../finance-os/.e2e/assistant.png", fullPage: true }).catch(() => {});
  check("Assistant: no runtime errors", errorsAs.length === 0, errorsAs.slice(0, 2).join(" | "));
  await ctxAs.close();

  // Admin page with the in-memory backend (admin@ accounts are admins there).
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctxA.addInitScript(() => localStorage.setItem("finance-os:cloud", "memory"));
  const pa2 = await ctxA.newPage();
  await pa2.goto(`http://localhost:${PORT}/cfoh/app/`, { waitUntil: "networkidle" });
  await pa2.getByRole("button", { name: "Create an account" }).click();
  await pa2.getByPlaceholder("you@yourbusiness.com").fill("admin@example.com");
  await pa2.locator('input[type="password"]').fill("correct-horse-battery");
  await pa2.getByRole("button", { name: "Create account", exact: true }).click();
  await runOnboarding(pa2, { name: "Admin", business: "Admin Co", home: "USD" });
  check("Admin sees the Accounts & trials nav item", await pa2.locator("aside").getByText("Accounts & trials").isVisible());
  await pa2.goto(`http://localhost:${PORT}/cfoh/app/admin/`, { waitUntil: "networkidle" });
  const adminBody = await pa2.locator("body").innerText();
  check("Admin page lists the signed-up account with its trial", adminBody.includes("admin@example.com") && /trial · \d+d left/.test(adminBody));
  await ctxA.close();

  // Mobile: homepage and app render without horizontal overflow.
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pm = await ctxM.newPage();
  await pm.goto(`http://localhost:${PORT}/cfoh/`, { waitUntil: "networkidle" });
  const homeOverflow = await pm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await pm.screenshot({ path: "../finance-os/.e2e/mobile-home.png", fullPage: false }).catch(() => {});
  await pm.goto(`http://localhost:${PORT}/cfoh/app/?demo=1`, { waitUntil: "networkidle" });
  await pm.getByText("Hi Sam").first().waitFor({ timeout: 30000 });
  const appOverflow = await pm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await pm.screenshot({ path: "../finance-os/.e2e/mobile-app.png", fullPage: false }).catch(() => {});
  const tabs = pm.getByRole("navigation", { name: "Main" });
  check("Mobile: bottom tabs with the add button", (await tabs.getByText("Home").isVisible()) && (await tabs.getByRole("button", { name: "Add money in or out" }).isVisible()));
  await tabs.getByRole("button", { name: "Add money in or out" }).click();
  check("Mobile: quick add opens as a sheet", await pm.locator("[data-quickadd]").isVisible());
  await pm.keyboard.press("Escape");
  await pm.getByRole("button", { name: "Open navigation" }).click();
  check("Mobile: homepage and dashboard have no horizontal overflow and the menu opens", homeOverflow <= 1 && appOverflow <= 1 && (await pm.getByText("More tools").last().isVisible()), `home=${homeOverflow} app=${appOverflow}`);
  await pm.screenshot({ path: "../finance-os/.e2e/mobile-menu.png", fullPage: false }).catch(() => {});
  await ctxM.close();

  // Mobile: the setup questions fit a phone.
  const ctxO = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const po = await ctxO.newPage();
  await po.goto(`http://localhost:${PORT}/cfoh/app/`, { waitUntil: "networkidle" });
  const dOnly = po.getByRole("button", { name: /Continue without an account/ });
  if (await dOnly.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false)) await dOnly.click();
  await po.locator("[data-onboarding]").waitFor({ timeout: 20000 });
  const onbOverflow = await po.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await po.screenshot({ path: "../finance-os/.e2e/mobile-onboarding.png", fullPage: false }).catch(() => {});
  check("Mobile: setup questions have no horizontal overflow", onbOverflow <= 1, `overflow=${onbOverflow}`);
  await ctxO.close();

  // Visit every page for runtime errors.
  for (const p of ["expenses", "clients", "personal", "accounts", "tax", "growth", "forecast", "alerts"]) {
    await page.goto(`http://localhost:${PORT}/cfoh/app/${p}/`, { waitUntil: "networkidle" });
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
  assistantServer.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
