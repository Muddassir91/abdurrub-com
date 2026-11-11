// Checks the assistant's instructions against real Workers AI models.
//   CLOUDFLARE_ACCOUNT_ID=... node scripts/eval-assistant.mjs [model ...]
// Sends a fixed set of realistic messages with a sample context and scores
// whether each answer contains the expected actions. Used to choose the model
// and to re-check after editing worker/prompt.md.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.env.HTTPS_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
}
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN ?? "proxy-injected";
const SYSTEM = readFileSync(resolve(import.meta.dirname, "..", "worker", "prompt.md"), "utf8").trim();

const CONTEXT = `today: 2026-11-11 (Wednesday); month on screen: 2026-11
person: Ayesha Khan; business: Ayesha Design; kind: freelancer
currencies: earns in USD; spends at home in PKR (280 PKR = 1 USD). Amounts below are USD unless marked.
split %: running costs 20, your pay 40, tax 15, profit 10, cushion 10, growth 5
usual monthly income: 6000
this month: collected 4500, fees 0, money in after fees 4500, business spending 318, personal spending 412, kept 3770,
budgets: running costs 318 spent of 900 ceiling; home essentials 392 spent of 464; your pay 0 taken of 1800
set aside: tax account 500 (split puts 675 toward tax this month); cushion 1000 of 1887 target; profit kept 0
cash: business 6682 USD; personal 114500 PKR; runway 9.4 months
spending by category this month: Software and AI 185; Food 232; Utilities 160; Lead generation 99; Administrative 14; Travel 20; Operations 20
subscriptions: Figma 15 USD monthly; Google Workspace 14 USD monthly; Notion 10 USD monthly; Lead data tool 99 USD monthly; ChatGPT 20 USD monthly
home budget lines: Rent 80000 PKR; Groceries 50000 PKR
clients: Harbor Coffee Co.; Lumen Skincare
business categories: Software and AI, Lead generation, Marketing, Sales tools, Communication, Operations, Contractors, Administrative, Education, Other
personal categories: Family support, Food, Utilities, Internet, Entertainment, Streaming, Shopping, Travel, Personal technology, Other
goals: cushion, see_where
dashboard shows: What to do next, Money in, out and kept, Budgets, Recent activity, Where it went; hidden: In and out, week by week, Tax, cushion and profit set aside, Coming up; trackers: none
to do next: $175 of tax is not set aside yet; $1,800 of your pay is still in the business
recent entries, newest first:
2026-11-10 out personal 5600 PKR "Lunch" [Food]
2026-11-09 out personal 45000 PKR "Electricity bill" [Utilities]
2026-11-05 in 4500 USD "Harbor Coffee retainer"
2026-11-03 out business 99 USD "Lead data tool (monthly renewal)" [Lead generation]
2026-11-03 out business 20 USD "ChatGPT (monthly renewal)" [Software and AI]`;

const has = (name, test = () => true) => (r) => r.actions.some((a) => a.name === name && test(a.args ?? {}));
const none = (r) => r.actions.length === 0;
const says = (re) => (r) => re.test(r.reply);
const all = (...fs) => (r) => fs.every((f) => f(r));
const count = (name, n) => (r) => r.actions.filter((a) => a.name === name).length === n;
const num = (v) => Number(String(v).replace(/[^0-9.]/g, ""));

const CASES = [
  ["I just paid 49 dollars for my Canva subscription", has("add_money_out", (a) => num(a.amount) === 49 && a.side === "business")],
  ["bought groceries for 3200 and paid the gas bill 9500 yesterday", all(count("add_money_out", 2), has("add_money_out", (a) => num(a.amount) === 3200 && a.side === "personal"), has("add_money_out", (a) => num(a.amount) === 9500 && a.date === "yesterday"))],
  ["hey so I just got paid this much more, 1500 from the Lumen people", has("add_money_in", (a) => num(a.amount) === 1500 && /lumen/i.test(a.from ?? ""))],
  ["I got paid today", all(none, says(/how much|amount/i))],
  ["that last one was actually 6500 not 5600", has("update_transaction", (a) => num(a.amount) === 6500)],
  ["my rent went up to 95000", has("update_setup", (a) => /rent/i.test(a.homeLine?.name ?? "") && num(a.homeLine?.amount) === 95000)],
  ["I only pay 1 percent tax because it's remittance income", (r) => has("update_setup", (a) => num(a.taxPct) === 1)(r) || has("set_split", (a) => num(a.tax) === 1)(r)],
  ["I think I answered the setup wrong, I want to do it over", has("redo_setup")],
  ["this is way too much stuff, I just want the basics on my dashboard", has("customize_dashboard", (a) => a.preset === "simple")],
  ["give me a customized dashboard that focuses on my spending and watches my food under 400", has("customize_dashboard", (a) => (a.preset === "spending" || Array.isArray(a.show) || Array.isArray(a.hide)) && /food/i.test(a.add_tracker?.category ?? "") && num(a.add_tracker?.limit) === 400)],
  ["how much did I spend on software this month?", all(none, says(/185/))],
  ["can I afford a 300 dollar course right now?", all(none, says(/\d/), (r) => !/\b(you should|i recommend|i suggest|i would advise|go ahead and)\b/i.test(r.reply))],
  ["what stocks should I buy with my profit", all(none, (r) => !/\b(buy|invest in) [A-Z]/.test(r.reply))],
  ["I took 1000 out of the business for myself", has("pay_myself", (a) => num(a.amount) === 1000)],
  ["transferred 500 into my tax savings", has("set_aside", (a) => num(a.amount) === 500 && a.for === "tax")],
  ["I cancelled notion", has("remove_subscription", (a) => /notion/i.test(a.name ?? ""))],
  ["I signed up for Ahrefs, it's 99 a month", has("add_subscription", (a) => /ahrefs/i.test(a.name ?? "") && num(a.amount) === 99)],
  ["where can I see what I owe in tax", all(has("navigate", (a) => /tax/i.test(a.page ?? "")), (r) => !/you owe/i.test(r.reply))],
  ["I want to pay myself 45 percent", has("set_split", (a) => num(a.owner) === 45)],
  ["my business account actually has 12,400 in it right now", has("set_balance", (a) => num(a.amount) === 12400 && /business/i.test(a.account ?? ""))],
  ["kal 2500 ka petrol dalwaya", has("add_money_out", (a) => num(a.amount) === 2500 && a.side === "personal")],
  ["client ne 80000 rupay bheje hain", has("add_money_in", (a) => num(a.amount) === 80000)],
  ["delete the lunch entry", has("delete_transaction", (a) => /lunch/i.test(a.match ?? ""))],
  ["what should I look at first today?", all(none, says(/175|1,?800/))],
  ["write me a poem about cats", all(none)],
];

function extract(v) {
  if (v && typeof v === "object") return v;
  if (typeof v !== "string") return null;
  const text = v.replace(/```(?:json)?/g, "").trim();
  const start = text.indexOf("{");
  if (start === -1) return { reply: text, actions: [] };
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function ask(model, message) {
  const body = { messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `CONTEXT\n${CONTEXT}\n\nMessage: ${message}` }], max_tokens: 1500, temperature: 0.1, response_format: { type: "json_object" }, ...(process.env.EFFORT && /gpt-oss/.test(model) ? { reasoning: { effort: process.env.EFFORT } } : {}) };
  const t = Date.now();
  let res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    delete body.response_format;
    res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  const j = await res.json().catch(() => ({}));
  const r = j.result ?? {};
  const raw = r.response ?? r.choices?.[0]?.message?.content ?? null;
  const usage = r.usage ?? {};
  const parsed = extract(raw);
  return { ms: Date.now() - t, parsed: parsed ? { reply: typeof parsed.reply === "string" ? parsed.reply : "", actions: Array.isArray(parsed.actions) ? parsed.actions : [] } : null, raw, usage, error: res.ok ? null : JSON.stringify(j.errors ?? j).slice(0, 200) };
}

const models = process.argv.slice(2);
const verbose = process.env.VERBOSE === "1";
for (const model of models) {
  let pass = 0, ms = 0, inTok = 0, outTok = 0;
  const fails = [];
  const results = await Promise.all(CASES.map(async ([message, check]) => {
    try { return [message, check, await ask(model, message)]; } catch (e) { return [message, check, { ms: 0, parsed: null, raw: String(e), usage: {} }]; }
  }));
  for (const [message, check, r] of results) {
    ms += r.ms; inTok += r.usage.prompt_tokens ?? 0; outTok += r.usage.completion_tokens ?? 0;
    let ok = false;
    try { ok = !!r.parsed && check(r.parsed); } catch { ok = false; }
    if (ok) pass++;
    else fails.push(`   ✗ ${message}\n     -> ${r.error ?? JSON.stringify(r.parsed ?? r.raw).slice(0, 330)}`);
    if (verbose && ok) console.log(`   ✓ ${message}\n     -> ${JSON.stringify(r.parsed).slice(0, 260)}`);
  }
  console.log(`\n${model}: ${pass}/${CASES.length} passed · avg ${(ms / CASES.length / 1000).toFixed(1)}s · avg tokens in ${Math.round(inTok / CASES.length)} out ${Math.round(outTok / CASES.length)}`);
  for (const f of fails) console.log(f);
}
