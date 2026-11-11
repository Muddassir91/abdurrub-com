import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { addTransaction, updateTransaction, deleteTransaction, deleteTransactionGroup, validateTransactionInput, recordBalanceAdjustment, upsertRecurring, updateSettings, loadEngineData, type TransactionInput } from "@/db/repo";
import type { EngineData } from "@/engine/types";
import { accountBalance } from "@/engine/ledger";
import { addDays, addMonths, currentMonthKey, isValidDateKey } from "@/lib/dates";
import { formatMoney, isKnownCurrency, parseMajorToMinor, type CurrencyCode } from "@/lib/money";
import { nowIso, uid } from "@/lib/ids";
import type { Bucket, TransactionType } from "@/lib/constants";
import { METRIC_IDS, METRIC_LABELS, PRESETS, SECTION_LABELS, parseUi, resolveSection, type MetricId, type SectionId, type Tracker } from "@/lib/ui";
import { patchSetup, type SetupPatch } from "@/onboarding/apply";
import { currentAnswers } from "@/onboarding/derive";
import { isPersonal } from "@/onboarding/model";

/**
 * Everything the assistant can do, as plain data. The on-device parser and the
 * language model both produce these; this module validates and executes them
 * against the workspace database. Nothing here trusts its input.
 */
export interface RawAction {
  name: string;
  args?: Record<string, unknown>;
}

export type UiEffect =
  | { kind: "navigate"; href: string; label: string }
  | { kind: "setup"; step: string | null }
  | { kind: "theme"; theme: "light" | "dark" | "system" }
  | { kind: "month"; month: string }
  | { kind: "currency"; which: "base" | "home" };

export interface ActionResult {
  ok: boolean;
  text: string;
  /** True when the database changed. */
  changed?: boolean;
  effect?: UiEffect;
}

export interface ExecEnv {
  db: Db;
  today: string;
  month: string;
}

export const ACTION_NAMES = [
  "add_money_out",
  "add_money_in",
  "pay_myself",
  "set_aside",
  "pay_tax",
  "update_transaction",
  "delete_transaction",
  "add_subscription",
  "remove_subscription",
  "update_setup",
  "set_split",
  "set_balance",
  "redo_setup",
  "customize_dashboard",
  "navigate",
  "set_theme",
  "set_month",
  "show_currency",
  "undo",
] as const;

/** Actions the model may not run without the person confirming first. */
export const CONFIRM_FIRST = new Set(["delete_transaction", "remove_subscription", "set_balance"]);

export const PAGES: { href: string; label: string; words: string[] }[] = [
  { href: "/app/", label: "Home", words: ["home", "dashboard", "main"] },
  { href: "/app/transactions/", label: "Activity", words: ["activity", "transactions", "ledger", "history", "entries"] },
  { href: "/app/trends/", label: "Trends", words: ["trends", "progress", "charts"] },
  { href: "/app/settings/", label: "Settings", words: ["settings", "preferences", "backup", "account"] },
  { href: "/app/expenses/", label: "Tools & overhead", words: ["expenses", "subscriptions", "tools", "overhead", "running costs", "renewals"] },
  { href: "/app/personal/", label: "Your pay & home", words: ["personal", "home budget", "household", "my pay", "owner"] },
  { href: "/app/reserves/", label: "Profit & cushion", words: ["reserves", "cushion", "profit", "savings"] },
  { href: "/app/tax/", label: "Tax", words: ["tax", "taxes", "compliance", "filings"] },
  { href: "/app/clients/", label: "Clients", words: ["clients", "customers", "invoices", "revenue"] },
  { href: "/app/whop/", label: "Payment processor", words: ["processor", "whop", "stripe", "paypal", "payouts", "fees"] },
  { href: "/app/accounts/", label: "Accounts", words: ["accounts", "balances", "bank"] },
  { href: "/app/alerts/", label: "Alerts", words: ["alerts", "warnings"] },
  { href: "/app/month-end/", label: "Month-end", words: ["month-end", "month end", "close the month", "reports", "close month"] },
  { href: "/app/forecast/", label: "Forecast", words: ["forecast", "cash flow", "projection"] },
  { href: "/app/scenarios/", label: "Scenarios", words: ["scenarios", "what if", "calculator"] },
  { href: "/app/growth/", label: "Growth & hiring", words: ["growth", "hiring", "hire"] },
];

export function resolvePage(phrase: string): { href: string; label: string } | null {
  const q = phrase.trim().toLowerCase().replace(/^(the|my)\s+/, "").replace(/\s+(page|screen|tab|section)$/, "");
  if (!q) return null;
  for (const p of PAGES) if (p.label.toLowerCase() === q || p.words.includes(q)) return p;
  for (const p of PAGES) if (p.words.some((w) => q.includes(w) || (w.includes(q) && q.length >= 4))) return p;
  return null;
}

/** Keywords that point at a category when the person did not name one. */
const PERSONAL_HINTS: [RegExp, string][] = [
  [/grocer|food|lunch|dinner|breakfast|restaurant|coffee|cafe|meal|snack|eat|pizza|burger|biryani|takeaway|takeout/, "Food"],
  [/rent|mortgage|electric|gas bill|water bill|utilit|bill/, "Utilities"],
  [/internet|wifi|broadband|mobile plan|phone bill/, "Internet"],
  [/parent|brother|sister|family|mom|dad|mother|father|wife|husband|kid|child|school fee/, "Family support"],
  [/netflix|spotify|youtube premium|disney|prime video|streaming/, "Streaming"],
  [/movie|cinema|game|concert|party|outing/, "Entertainment"],
  [/cloth|shoe|shopping|amazon|mall|gift/, "Shopping"],
  [/uber|careem|taxi|fuel|petrol|gas station|flight|hotel|bus|train|travel|trip|ride/, "Travel"],
  [/laptop|phone|headphone|gadget|charger/, "Personal technology"],
];
const BUSINESS_HINTS: [RegExp, string][] = [
  [/chatgpt|openai|claude|anthropic|figma|canva|adobe|notion|software|saas|app subscription|cursor|github|copilot|midjourney|\bai\b/, "Software and AI"],
  [/listkit|apollo|lead|scrap|instantly|smartlead|upwork connects/, "Lead generation"],
  [/\bads?\b|facebook ads|meta ads|google ads|marketing|promotion|newsletter|kit\b|klaviyo|mailchimp/, "Marketing"],
  [/linkedin|sales navigator|crm|hubspot|calendly/, "Sales tools"],
  [/zoom|slack|loom|google workspace|workspace|domain|email hosting/, "Communication"],
  [/hosting|server|cloudflare|vercel|aws|zapier|make\.com|automation/, "Operations"],
  [/contractor|freelancer|designer|developer|editor|va\b|assistant|writer|team/, "Contractors"],
  [/accountant|lawyer|legal|registered agent|filing|bank fee|license/, "Administrative"],
  [/course|book|training|workshop|coaching/, "Education"],
];

function hint(text: string, table: [RegExp, string][]): string | null {
  const t = text.toLowerCase();
  for (const [re, name] of table) if (re.test(t)) return name;
  return null;
}

function findCategory(data: EngineData, scope: "business" | "personal", ...candidates: (string | undefined | null)[]) {
  const cats = data.categories.filter((c) => c.scope === scope);
  for (const raw of candidates) {
    const q = raw?.trim().toLowerCase();
    if (!q) continue;
    const exact = cats.find((c) => c.name.toLowerCase() === q);
    if (exact) return exact;
    const partial = cats.find((c) => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase()));
    if (partial) return partial;
    const hinted = hint(q, scope === "personal" ? PERSONAL_HINTS : BUSINESS_HINTS);
    if (hinted) {
      const h = cats.find((c) => c.name === hinted);
      if (h) return h;
    }
  }
  return null;
}

/** Business or personal, from what was said. */
export function inferSide(data: EngineData, text: string, personalOnly: boolean): "business" | "personal" {
  if (/\b(business|company|work|client|office)\b/i.test(text)) return "business";
  if (/\b(personal|home|house|myself|family)\b/i.test(text)) return "personal";
  if (hint(text, BUSINESS_HINTS)) return "business";
  if (hint(text, PERSONAL_HINTS)) return "personal";
  const lower = text.toLowerCase();
  if (data.recurringExpenses.some((r) => lower.includes(r.name.toLowerCase()))) return "business";
  if (data.householdLines.some((l) => lower.includes(l.name.toLowerCase()))) return "personal";
  return personalOnly ? "personal" : "business";
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  return null;
};
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined);

export function resolveDate(v: unknown, today: string): string {
  const t = str(v).toLowerCase();
  if (!t || t === "today" || t === "now") return today;
  if (t === "yesterday") return addDays(today, -1);
  const ago = t.match(/^(\d+)\s+days?\s+ago$/);
  if (ago) return addDays(today, -Number(ago[1]));
  if (isValidDateKey(t)) return t;
  return today;
}

function resolveCurrency(data: EngineData, v: unknown, fallback: CurrencyCode): CurrencyCode {
  const c = str(v).toUpperCase();
  if (!c) return fallback;
  if (isKnownCurrency(c)) return c;
  const base = data.settings.baseCurrency;
  const home = data.settings.householdCurrency;
  if (/^(RS|RUPEES?|₨)$/.test(c)) return ["PKR", "INR", "LKR", "NPR"].includes(home) ? home : "PKR";
  if (c === "$" || c === "DOLLARS" || c === "DOLLAR" || c === "BUCKS") return base.endsWith("D") ? base : "USD";
  if (c === "€" || c === "EUROS" || c === "EURO") return "EUR";
  if (c === "£" || c === "POUNDS" || c === "POUND") return "GBP";
  return fallback;
}

function fxFor(data: EngineData, currency: CurrencyCode, rate: unknown): { fxRatePerUsd?: string; error?: string } {
  const base = data.settings.baseCurrency;
  const home = data.settings.householdCurrency;
  if (currency === base || currency === "USD") return {};
  const given = num(rate);
  if (given && given > 0) return { fxRatePerUsd: String(given) };
  if (currency === home) return {};
  if (data.fxRates.some((r) => r.currency === currency)) return {};
  return { error: `I don't have a rate for ${currency}. Tell me how many ${currency} make 1 ${base}, for example "${currency} rate is 3.67".` };
}

const byRole = (data: EngineData, role: string) => data.accounts.find((a) => a.role === role && !a.isArchived) ?? null;

function insert(env: ExecEnv, data: EngineData, input: TransactionInput): { id?: string; error?: string } {
  const errs = validateTransactionInput(input, data.accounts);
  if (errs.length) return { error: errs[0] };
  try {
    return { id: addTransaction(env.db, input, data.settings, data.fxRates) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const dateNote = (date: string, today: string) => (date === today ? "" : date === addDays(today, -1) ? " (yesterday)" : ` (${date})`);

/** The row most recently added, or the most recent one whose description matches. */
function findTransaction(data: EngineData, match: string) {
  const q = match.trim().toLowerCase();
  const rows = q ? data.transactions.filter((t) => t.description.toLowerCase().includes(q)) : data.transactions;
  if (rows.length === 0) return null;
  return q ? rows[0] : [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

function saveUi(env: ExecEnv, data: EngineData, mutate: (ui: ReturnType<typeof parseUi>) => void) {
  const ui = parseUi(data.settings.uiJson);
  mutate(ui);
  updateSettings(env.db, { uiJson: JSON.stringify(ui) });
}

export function runAction(env: ExecEnv, action: RawAction): ActionResult {
  const data = loadEngineData(env.db);
  const a = action.args ?? {};
  const base = data.settings.baseCurrency as CurrencyCode;
  const home = data.settings.householdCurrency as CurrencyCode;
  const personalOnly = isPersonal(currentAnswers(data));
  const fail = (text: string): ActionResult => ({ ok: false, text });

  switch (action.name) {
    case "add_money_out": {
      const amount = num(a.amount);
      if (!amount || amount <= 0) return fail("How much was it?");
      const what = str(a.what) || str(a.description);
      const sideArg = str(a.side).toLowerCase();
      const side: "business" | "personal" = sideArg === "business" || sideArg === "personal" ? sideArg : inferSide(data, `${what} ${str(a.category)}`, personalOnly);
      const currency = resolveCurrency(data, a.currency, side === "personal" ? home : base);
      const fx = fxFor(data, currency, a.rate);
      if (fx.error) return fail(fx.error);
      const cat = findCategory(data, side, str(a.category), what);
      const date = resolveDate(a.date, env.today);
      const amountMinor = parseMajorToMinor(String(amount), currency);
      const household = bool(a.household) ?? cat?.isEssentialDefault ?? false;
      const repeats = bool(a.repeats) ?? false;
      const input: TransactionInput =
        side === "personal"
          ? { date, type: household ? "household_expense" : "personal_expense", amountMinor, currency, ...fx, description: what || cat?.name || "Personal spending", categoryId: cat?.id ?? null, accountId: byRole(data, "personal")?.id ?? null }
          : { date, type: "expense", amountMinor, currency, ...fx, description: what || cat?.name || "Business expense", categoryId: cat?.id ?? null, accountId: byRole(data, "operating")?.id ?? null, costType: "overhead", bucket: "opex", isRecurring: repeats, isEssential: repeats };
      const r = insert(env, data, input);
      if (r.error) return fail(r.error);
      return { ok: true, changed: true, text: `Added ${formatMoney(amountMinor, currency)} out · ${input.description}${cat && cat.name !== input.description ? ` · ${cat.name}` : ""} · ${side === "personal" ? (personalOnly ? "day to day" : "personal") : personalOnly ? "bills" : "business"}${dateNote(date, env.today)}` };
    }

    case "add_money_in": {
      const amount = num(a.amount);
      if (!amount || amount <= 0) return fail("How much came in?");
      const currency = resolveCurrency(data, a.currency, base);
      const fx = fxFor(data, currency, a.rate);
      if (fx.error) return fail(fx.error);
      const from = str(a.from) || str(a.client);
      const client = from ? (data.clients.find((c) => c.name.toLowerCase() === from.toLowerCase()) ?? data.clients.find((c) => c.name.toLowerCase().includes(from.toLowerCase()) || from.toLowerCase().includes(c.name.toLowerCase().split(/[\s(]/)[0]))) : null;
      const date = resolveDate(a.date, env.today);
      const amountMinor = parseMajorToMinor(String(amount), currency);
      const what = str(a.what) || str(a.description) || (client ? `Payment from ${client.name}` : from ? `Payment from ${from}` : "Money in");
      const r = insert(env, data, { date, type: client ? "client_payment" : "income", amountMinor, currency, ...fx, description: what, accountId: byRole(data, "operating")?.id ?? null, clientId: client?.id ?? null });
      if (r.error) return fail(r.error);
      return { ok: true, changed: true, text: `Added ${formatMoney(amountMinor, currency)} in · ${what}${dateNote(date, env.today)}` };
    }

    case "pay_myself": {
      const amount = num(a.amount);
      if (!amount || amount <= 0) return fail("How much did you pay yourself?");
      const from = byRole(data, "operating");
      const to = byRole(data, "personal");
      if (!from || !to) return fail("I could not find the business and personal accounts.");
      const date = resolveDate(a.date, env.today);
      const amountMinor = parseMajorToMinor(String(amount), base);
      const r = insert(env, data, { date, type: "owner_draw", amountMinor, currency: base, description: "Paid myself", accountId: from.id, toAccountId: to.id, bucket: "owner" });
      if (r.error) return fail(r.error);
      return { ok: true, changed: true, text: `Recorded ${formatMoney(amountMinor, base)} paid to you${dateNote(date, env.today)}` };
    }

    case "set_aside": {
      const amount = num(a.amount);
      if (!amount || amount <= 0) return fail("How much did you set aside?");
      const forWhat = (str(a.for) || str(a.to) || "cushion").toLowerCase();
      const role = /tax/.test(forWhat) ? "tax" : /profit/.test(forWhat) ? "profit" : /grow/.test(forWhat) ? "growth" : "savings";
      const label = role === "tax" ? "tax" : role === "profit" ? "profit" : role === "growth" ? "growth" : "your cushion";
      const from = byRole(data, "operating");
      const to = byRole(data, role);
      if (!from || !to) return fail(`I could not find an account for ${label}.`);
      const date = resolveDate(a.date, env.today);
      const amountMinor = parseMajorToMinor(String(amount), base);
      const r = insert(env, data, { date, type: "transfer", amountMinor, currency: base, description: `Set aside for ${label}`, accountId: from.id, toAccountId: to.id });
      if (r.error) return fail(r.error);
      return { ok: true, changed: true, text: `Moved ${formatMoney(amountMinor, base)} to ${label}${dateNote(date, env.today)}` };
    }

    case "pay_tax": {
      const amount = num(a.amount);
      if (!amount || amount <= 0) return fail("How much tax did you pay?");
      const currency = resolveCurrency(data, a.currency, base);
      const fx = fxFor(data, currency, a.rate);
      if (fx.error) return fail(fx.error);
      const acc = byRole(data, "tax") ?? byRole(data, "operating");
      const date = resolveDate(a.date, env.today);
      const amountMinor = parseMajorToMinor(String(amount), currency);
      const r = insert(env, data, { date, type: "tax_payment", amountMinor, currency, ...fx, description: str(a.what) || "Tax payment", accountId: acc?.id ?? null, bucket: "tax" });
      if (r.error) return fail(r.error);
      return { ok: true, changed: true, text: `Recorded a ${formatMoney(amountMinor, currency)} tax payment${dateNote(date, env.today)}` };
    }

    case "update_transaction": {
      const t = findTransaction(data, str(a.match));
      if (!t) return fail(str(a.match) ? `I could not find an entry matching "${str(a.match)}".` : "There is nothing to change yet.");
      const scope = t.type === "household_expense" || t.type === "personal_expense" ? "personal" : "business";
      const amount = num(a.amount);
      const currency = a.currency ? resolveCurrency(data, a.currency, t.currency) : (t.currency as CurrencyCode);
      const cat = str(a.category) ? findCategory(data, scope, str(a.category)) : null;
      const input: TransactionInput = {
        id: t.id,
        date: a.date ? resolveDate(a.date, env.today) : t.date,
        type: t.type as TransactionType,
        amountMinor: amount && amount > 0 ? parseMajorToMinor(String(amount), currency) : t.amountMinor,
        currency,
        fxRatePerUsd: currency === t.currency ? t.fxRatePerUsd : undefined,
        description: str(a.what) || t.description,
        categoryId: cat?.id ?? t.categoryId,
        accountId: t.accountId,
        toAccountId: t.toAccountId,
        clientId: t.clientId,
        invoiceId: t.invoiceId,
        processorId: t.processorId,
        vendorId: t.vendorId,
        recurringExpenseId: t.recurringExpenseId,
        groupId: t.groupId,
        costType: (t.costType as "overhead" | "direct_delivery" | null) ?? null,
        bucket: (t.bucket as Bucket | null) ?? null,
        isEssential: t.isEssential,
        isRecurring: t.isRecurring,
        notes: t.notes,
      };
      try {
        updateTransaction(env.db, t.id, input, data.settings, data.fxRates);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
      return { ok: true, changed: true, text: `Updated "${input.description}" to ${formatMoney(input.amountMinor, input.currency)}${cat ? ` · ${cat.name}` : ""}${a.date ? ` · ${input.date}` : ""}` };
    }

    case "delete_transaction": {
      const t = findTransaction(data, str(a.match));
      if (!t) return fail(str(a.match) ? `I could not find an entry matching "${str(a.match)}".` : "There is nothing to delete.");
      try {
        if (t.groupId) deleteTransactionGroup(env.db, t.groupId);
        else deleteTransaction(env.db, t.id);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
      return { ok: true, changed: true, text: `Deleted "${t.description}" (${formatMoney(t.amountMinor, t.currency)}, ${t.date})` };
    }

    case "add_subscription": {
      const name = str(a.name);
      const amount = num(a.amount);
      if (!name) return fail("What is the subscription called?");
      if (!amount || amount <= 0) return fail(`How much is ${name} each time it bills?`);
      const freqArg = str(a.frequency).toLowerCase();
      const frequency = /year|annual/.test(freqArg) ? "annual" : /quarter/.test(freqArg) ? "quarterly" : /week/.test(freqArg) ? "weekly" : "monthly";
      const currency = resolveCurrency(data, a.currency, base);
      const cat = findCategory(data, "business", str(a.category), name);
      const existing = data.recurringExpenses.find((r) => r.name.toLowerCase() === name.toLowerCase());
      const amountMinor = parseMajorToMinor(String(amount), currency);
      upsertRecurring(env.db, {
        id: existing?.id,
        name,
        vendorId: existing?.vendorId ?? null,
        amountMinor,
        currency,
        frequency,
        categoryId: cat?.id ?? existing?.categoryId ?? null,
        costType: "overhead",
        bucket: "opex",
        accountId: byRole(data, "operating")?.id ?? null,
        startDate: existing?.startDate ?? env.today,
        nextRenewalDate: existing?.nextRenewalDate ?? `${addMonths(currentMonthKey(), frequency === "annual" ? 12 : frequency === "quarterly" ? 3 : 1)}-${env.today.slice(8, 10) > "28" ? "28" : env.today.slice(8, 10)}`,
        status: "active",
        isEssential: existing?.isEssential ?? true,
        justification: existing?.justification ?? "Added by telling CFoh!.",
        notes: existing?.notes ?? null,
      });
      return { ok: true, changed: true, text: `${existing ? "Updated" : "Added"} ${name}: ${formatMoney(amountMinor, currency)} ${frequency}` };
    }

    case "remove_subscription": {
      const name = str(a.name).toLowerCase();
      if (!name) return fail("Which subscription?");
      const r = data.recurringExpenses.find((x) => x.status === "active" && x.name.toLowerCase() === name) ?? data.recurringExpenses.find((x) => x.status === "active" && (x.name.toLowerCase().includes(name) || name.includes(x.name.toLowerCase())));
      if (!r) return fail(`I could not find an active subscription called "${str(a.name)}".`);
      env.db.update(s.recurringExpenses).set({ status: "cancelled", cancelledAt: env.today, updatedAt: nowIso() }).where(eq(s.recurringExpenses.id, r.id)).run();
      return { ok: true, changed: true, text: `Marked ${r.name} as cancelled. Past entries stay in your history.` };
    }

    case "update_setup": {
      const patch: SetupPatch = {};
      if (str(a.name)) patch.name = str(a.name);
      if (str(a.businessName) || str(a.business_name)) patch.businessName = str(a.businessName) || str(a.business_name);
      const income = num(a.monthlyIncome ?? a.monthly_income);
      if (income !== null) patch.monthlyIncome = income;
      const tax = num(a.taxPct ?? a.tax_pct ?? a.tax);
      if (tax !== null) patch.taxPct = tax;
      const months = num(a.reserveMonths ?? a.reserve_months);
      if (months !== null) patch.reserveMonths = months;
      if (str(a.country)) patch.country = str(a.country);
      if (str(a.registrationCountry) || str(a.registration_country)) patch.registrationCountry = str(a.registrationCountry) || str(a.registration_country);
      const fx = num(a.fxRate ?? a.fx_rate);
      if (fx !== null) patch.fxRate = fx;
      if (Array.isArray(a.goals)) patch.goals = a.goals.map((g) => str(g));
      const line = (a.homeLine ?? a.home_line) as { name?: unknown; amount?: unknown } | undefined;
      if (line && str(line.name)) patch.homeLine = { name: str(line.name), amount: num(line.amount) ?? 0 };
      const budget = a.homeBudget ?? a.home_budget;
      if (Array.isArray(budget)) patch.homeBudget = budget.map((x) => ({ name: str((x as { name?: unknown }).name), amount: num((x as { amount?: unknown }).amount) ?? 0 }));
      if (Object.keys(patch).length === 0) return fail("Tell me what to change, for example \"my tax is 1%\" or \"my usual income is 5,000\".");
      try {
        const notes = patchSetup(env.db, patch);
        return notes.length ? { ok: true, changed: true, text: notes.join(". ") + "." } : fail("Nothing changed.");
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }

    case "set_split": {
      const split: Record<string, number> = {};
      const alias: Record<string, string> = { opex: "opex", running: "opex", running_costs: "opex", costs: "opex", owner: "owner", pay: "owner", your_pay: "owner", my_pay: "owner", tax: "tax", profit: "profit", reserve: "reserve", cushion: "reserve", savings: "reserve", growth: "growth" };
      for (const [k, v] of Object.entries(a)) {
        const key = alias[k.toLowerCase().replace(/\s+/g, "_")];
        const n = num(v);
        if (key && n !== null) split[key] = n;
      }
      if (Object.keys(split).length === 0) return fail("Tell me the shares, for example \"profit 15% and cushion 10%\".");
      try {
        // A new tax share is also the person's tax answer, so both stay in step.
        const notes = patchSetup(env.db, split.tax !== undefined ? { split, taxPct: split.tax } : { split });
        return { ok: true, changed: true, text: notes.join(". ") + "." };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }

    case "set_balance": {
      const amount = num(a.amount);
      if (amount === null) return fail("What is the balance now?");
      const which = (str(a.account) || "business").toLowerCase();
      const role = /tax/.test(which) ? "tax" : /cushion|saving|reserve/.test(which) ? "savings" : /profit/.test(which) ? "profit" : /grow/.test(which) ? "growth" : /personal|home|my /.test(which) ? "personal" : "operating";
      const acc = byRole(data, role);
      if (!acc) return fail("I could not find that account.");
      const target = parseMajorToMinor(String(amount), acc.currency);
      const delta = target - accountBalance(acc, data.transactions, data.settings);
      if (delta === 0) return { ok: true, text: `${acc.name} already shows ${formatMoney(target, acc.currency)}.` };
      try {
        recordBalanceAdjustment(env.db, acc.id, delta, env.today, "Balance corrected by telling CFoh!", data.settings, data.fxRates);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
      return { ok: true, changed: true, text: `${acc.name} now shows ${formatMoney(target, acc.currency)} (adjusted by ${formatMoney(delta, acc.currency, { signed: true })})` };
    }

    case "redo_setup":
      return { ok: true, text: "Opening your setup answers.", effect: { kind: "setup", step: str(a.step) || null } };

    case "customize_dashboard": {
      const notes: string[] = [];
      const sections = (v: unknown) => (Array.isArray(v) ? v : str(v) ? [v] : []).map((x) => resolveSection(str(x))).filter((x): x is SectionId => !!x);
      const preset = str(a.preset).toLowerCase();
      const hide = sections(a.hide);
      const show = sections(a.show);
      const order = sections(a.order);
      const add = (a.add_tracker ?? a.addTracker) as Record<string, unknown> | undefined;
      const remove = str(a.remove_tracker ?? a.removeTracker).toLowerCase();
      let tracker: Tracker | null = null;
      if (add) {
        const metric = str(add.metric).toLowerCase() as MetricId;
        const catName = str(add.category);
        const cat = catName ? (findCategory(data, "personal", catName) ?? findCategory(data, "business", catName)) : null;
        const limit = num(add.limit);
        if (cat) tracker = { id: uid(), kind: "category", label: str(add.label) || `${cat.name} this month`, category: cat.name, limitMinor: limit && limit > 0 ? parseMajorToMinor(String(limit), base) : undefined };
        else if ((METRIC_IDS as readonly string[]).includes(metric)) tracker = { id: uid(), kind: "metric", label: str(add.label) || METRIC_LABELS[metric], metric };
        else return fail(catName ? `I don't have a category called "${catName}".` : "Tell me what to track: a spending category (like Food) or one of the numbers on your dashboard.");
      }
      if (preset && !PRESETS[preset] && !hide.length && !show.length && !order.length && !tracker && !remove) return fail("I know these layouts: simple, standard, everything, spending and business.");
      if (!preset && !hide.length && !show.length && !order.length && !tracker && !remove) return fail("Tell me what to show or hide, for example \"hide the weekly chart\" or \"simple dashboard\".");
      saveUi(env, data, (ui) => {
        const d = ui.dashboard;
        if (preset && PRESETS[preset]) {
          d.hidden = [...PRESETS[preset].hidden];
          notes.push(`Switched to the ${PRESETS[preset].label.toLowerCase()} layout`);
        }
        for (const id of hide) if (!d.hidden.includes(id)) d.hidden.push(id);
        if (hide.length) notes.push(`Hid ${hide.map((h) => SECTION_LABELS[h]).join(", ")}`);
        if (show.length) {
          d.hidden = d.hidden.filter((h) => !show.includes(h));
          notes.push(`Showing ${show.map((h) => SECTION_LABELS[h]).join(", ")}`);
        }
        if (order.length) {
          d.order = [...order, ...d.order.filter((x) => !order.includes(x))];
          d.hidden = d.hidden.filter((h) => !order.includes(h));
          notes.push(`Moved ${order.map((h) => SECTION_LABELS[h]).join(", ")} to the top`);
        }
        if (tracker) {
          d.trackers = [...d.trackers.filter((t) => t.label.toLowerCase() !== tracker!.label.toLowerCase()), tracker];
          d.hidden = d.hidden.filter((h) => h !== "trackers");
          notes.push(`Added a tracker: ${tracker.label}`);
        }
        if (remove) {
          const before = d.trackers.length;
          d.trackers = d.trackers.filter((t) => !(t.label.toLowerCase().includes(remove) || (t.category ?? "").toLowerCase().includes(remove)));
          notes.push(before === d.trackers.length ? `No tracker matched "${remove}"` : "Removed the tracker");
        }
      });
      return { ok: true, changed: true, text: notes.join(". ") + ".", effect: { kind: "navigate", href: "/app/", label: "Home" } };
    }

    case "navigate": {
      const page = resolvePage(str(a.page) || str(a.to));
      if (!page) return fail(`I don't know a page called "${str(a.page) || str(a.to)}".`);
      return { ok: true, text: `Opening ${page.label}.`, effect: { kind: "navigate", href: page.href, label: page.label } };
    }

    case "set_theme": {
      const t = str(a.theme).toLowerCase();
      const theme = /dark|night/.test(t) ? "dark" : /light|day/.test(t) ? "light" : "system";
      return { ok: true, text: theme === "system" ? "Following your device's theme." : `Switched to ${theme} mode.`, effect: { kind: "theme", theme } };
    }

    case "set_month": {
      const m = str(a.month).toLowerCase();
      const month = /^\d{4}-\d{2}$/.test(m) ? m : /prev|last/.test(m) ? addMonths(env.month, -1) : /next/.test(m) ? addMonths(env.month, 1) : currentMonthKey();
      return { ok: true, text: `Showing ${month}.`, effect: { kind: "month", month } };
    }

    case "show_currency": {
      const which = /home|house|local/.test(str(a.which).toLowerCase()) || str(a.which).toUpperCase() === home ? "home" : "base";
      if (base === home) return { ok: true, text: `Everything is already in ${base}.` };
      return { ok: true, text: `Showing amounts in ${which === "home" ? home : base}.`, effect: { kind: "currency", which } };
    }

    default:
      return fail(`I can't do "${action.name}" yet.`);
  }
}
