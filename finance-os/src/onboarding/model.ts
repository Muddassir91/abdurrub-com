import type { CurrencyCode, Minor } from "@/lib/money";
import type { Frequency } from "@/lib/constants";

/**
 * The setup questionnaire. One question per screen; the answers are written to
 * the workspace (settings, split, accounts, recurring costs, household budget)
 * and kept as JSON in settings.onboarding_json so the dashboard can show the
 * expected income and the goals the person picked.
 */

export type Persona = "freelancer" | "solopreneur" | "agency" | "personal";
export type Steadiness = "steady" | "varies" | "swings";
export type ClientCount = "1" | "2-5" | "6-20" | "20+";
export type PayCadence = "weekly" | "biweekly" | "monthly" | "whenever";
export type Goal = "pay_myself" | "stop_overspending" | "tax_ready" | "cushion" | "profit" | "see_where";

export interface NamedAmount {
  name: string;
  /** Minor units of the currency the question was asked in. */
  amountMinor: Minor;
  category?: string;
  frequency?: Frequency;
}

export interface SplitPct {
  opex: number;
  owner: number;
  tax: number;
  profit: number;
  reserve: number;
  growth: number;
}

export interface OnboardingAnswers {
  version: 1;
  completedAt?: string;
  name: string;
  persona: Persona;
  businessName: string;
  baseCurrency: CurrencyCode;
  householdCurrency: CurrencyCode;
  /** Household-currency units per 1 base unit ("1" when both are the same). */
  fxRate: string;
  country: string;
  /** Typical monthly income before costs, base currency. */
  monthlyIncomeMinor: Minor;
  steadiness: Steadiness;
  paymentMethods: string[];
  clientCount: ClientCount;
  /** Opening balances, base currency. */
  businessCashMinor: Minor;
  taxSavedMinor: Minor;
  reserveSavedMinor: Minor;
  subscriptions: NamedAmount[];
  otherCosts: NamedAmount[];
  /** Household essentials, household currency. */
  household: NamedAmount[];
  /** Personal account balance, household currency. */
  personalCashMinor: Minor;
  payCadence: PayCadence;
  goals: Goal[];
  taxPct: number;
  reserveMonths: number;
  split: SplitPct;
}

export const PERSONAS: { value: Persona; label: string; body: string; emoji: string }[] = [
  { value: "freelancer", label: "Freelancer", body: "Projects and clients, income that moves around.", emoji: "🧑‍💻" },
  { value: "solopreneur", label: "Solopreneur", body: "One-person business: products, services or both.", emoji: "🚀" },
  { value: "agency", label: "Agency owner", body: "Retainers, revenue shares, people to pay.", emoji: "🏢" },
  { value: "personal", label: "Just me and my spending", body: "No business. I want to see where my money goes.", emoji: "👛" },
];

export const PAYMENT_METHODS = ["Bank transfer", "Stripe", "PayPal", "Whop", "Wise", "Payoneer", "Cash", "Other"] as const;

export const SUBSCRIPTION_PRESETS: { name: string; category: string }[] = [
  { name: "Google Workspace", category: "Administrative" },
  { name: "Microsoft 365", category: "Administrative" },
  { name: "Notion", category: "Operations" },
  { name: "Slack", category: "Communication" },
  { name: "Zoom", category: "Communication" },
  { name: "ChatGPT", category: "Software and AI" },
  { name: "Claude", category: "Software and AI" },
  { name: "Canva", category: "Software and AI" },
  { name: "Adobe", category: "Software and AI" },
  { name: "Figma", category: "Software and AI" },
  { name: "Shopify", category: "Sales tools" },
  { name: "Website hosting", category: "Operations" },
  { name: "Accounting software", category: "Administrative" },
  { name: "Phone plan", category: "Communication" },
  { name: "Ads", category: "Marketing" },
];

export const HOUSEHOLD_PRESETS: { key: string; name: string; category: string }[] = [
  { key: "rent", name: "Rent or mortgage", category: "Utilities" },
  { key: "groceries", name: "Groceries", category: "Food" },
  { key: "utilities", name: "Utilities and internet", category: "Internet" },
  { key: "family", name: "Family support", category: "Family support" },
  { key: "transport", name: "Transport", category: "Other" },
  { key: "other", name: "Other essentials", category: "Other" },
];

export const GOALS: { value: Goal; label: string; emoji: string }[] = [
  { value: "pay_myself", label: "Pay myself consistently", emoji: "💵" },
  { value: "stop_overspending", label: "Stop overspending on tools", emoji: "✂️" },
  { value: "tax_ready", label: "Never be surprised by tax", emoji: "🧾" },
  { value: "cushion", label: "Build a cash cushion", emoji: "🛟" },
  { value: "profit", label: "Actually keep a profit", emoji: "📈" },
  { value: "see_where", label: "See where my money goes", emoji: "🔍" },
];

export const TAX_OPTIONS = [0, 10, 15, 20, 25, 30];
export const RESERVE_OPTIONS = [1, 3, 6];

export function emptyAnswers(): OnboardingAnswers {
  return {
    version: 1,
    name: "",
    persona: "solopreneur",
    businessName: "",
    baseCurrency: "USD",
    householdCurrency: "USD",
    fxRate: "1",
    country: "",
    monthlyIncomeMinor: 0,
    steadiness: "varies",
    paymentMethods: [],
    clientCount: "2-5",
    businessCashMinor: 0,
    taxSavedMinor: 0,
    reserveSavedMinor: 0,
    subscriptions: [],
    otherCosts: [],
    household: HOUSEHOLD_PRESETS.map((h) => ({ name: h.name, amountMinor: 0, category: h.category })),
    personalCashMinor: 0,
    payCadence: "monthly",
    goals: [],
    taxPct: 15,
    reserveMonths: 3,
    split: { opex: 25, owner: 35, tax: 15, profit: 10, reserve: 10, growth: 5 },
  };
}

export const isPersonal = (a: Pick<OnboardingAnswers, "persona">) => a.persona === "personal";

const MONTHS_PER: Record<Frequency, number> = { monthly: 1, quarterly: 3, annual: 12, weekly: 12 / 52 };

/** Monthly business costs in base minor units. */
export function monthlyCostsMinor(a: OnboardingAnswers): Minor {
  const subs = a.subscriptions.reduce((s, x) => s + x.amountMinor, 0);
  const other = a.otherCosts.reduce((s, x) => s + Math.round(x.amountMinor / MONTHS_PER[x.frequency ?? "monthly"]), 0);
  return subs + other;
}

/** Household essentials converted to base minor units. */
export function householdInBaseMinor(a: OnboardingAnswers): Minor {
  const total = a.household.reduce((s, x) => s + x.amountMinor, 0);
  const rate = Number(a.fxRate) > 0 ? Number(a.fxRate) : 1;
  return Math.round(total / rate);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A starting split from the answers. Every figure is a share of what comes in,
 * rounded to whole percents, adding up to exactly 100. The person can adjust it
 * on the review screen and later in Settings. Nothing here is advice: it is the
 * person's own costs expressed as shares of their own income.
 */
export function suggestSplit(a: OnboardingAnswers): SplitPct {
  const income = a.monthlyIncomeMinor;
  const tax = clamp(Math.round(a.taxPct), 0, 40);
  let opex: number;
  let owner: number;
  if (income > 0) {
    opex = clamp(Math.ceil((monthlyCostsMinor(a) / income) * 100) + 5, isPersonal(a) ? 5 : 10, 45);
    owner = clamp(Math.ceil((householdInBaseMinor(a) / income) * 100) + 10, 20, 65);
  } else {
    opex = isPersonal(a) ? 10 : 25;
    owner = isPersonal(a) ? 50 : 35;
  }
  const minRest = 10;
  let rest = 100 - tax - opex - owner;
  if (rest < minRest) {
    const need = minRest - rest;
    const fromOwner = Math.min(need, Math.max(0, owner - 20));
    owner -= fromOwner;
    const fromOpex = Math.min(need - fromOwner, Math.max(0, opex - 10));
    opex -= fromOpex;
    rest = 100 - tax - opex - owner;
  }
  // Split the rest between profit, reserve and growth, leaning towards the goals picked.
  let wProfit = 2;
  let wReserve = 2;
  const wGrowth = isPersonal(a) ? 0 : 1;
  if (a.goals.includes("cushion")) wReserve += 2;
  if (a.goals.includes("profit")) wProfit += 2;
  if (a.reserveMonths >= 6) wReserve += 1;
  const w = wProfit + wReserve + wGrowth;
  const profit = Math.floor((rest * wProfit) / w);
  const growth = Math.floor((rest * wGrowth) / w);
  const reserve = rest - profit - growth;
  return normaliseSplit({ opex, owner, tax, profit, reserve, growth });
}

/** Round to whole percents and force the total to 100 by adjusting the largest share. */
export function normaliseSplit(s: SplitPct): SplitPct {
  const keys = Object.keys(s) as (keyof SplitPct)[];
  const out = { ...s } as SplitPct;
  for (const k of keys) out[k] = Math.max(0, Math.round(out[k] || 0));
  const total = keys.reduce((t, k) => t + out[k], 0);
  if (total !== 100) {
    const biggest = keys.reduce((b, k) => (out[k] > out[b] ? k : b), keys[0]);
    out[biggest] = Math.max(0, out[biggest] + (100 - total));
  }
  return out;
}

export const splitTotal = (s: SplitPct) => Object.values(s).reduce((a, b) => a + b, 0);

export function parseAnswers(json: string | null | undefined): OnboardingAnswers | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<OnboardingAnswers> & { skipped?: string };
    if (!v || typeof v !== "object" || v.skipped) return null;
    return { ...emptyAnswers(), ...v, split: { ...emptyAnswers().split, ...(v.split ?? {}) } } as OnboardingAnswers;
  } catch {
    return null;
  }
}

/** Marker stored by templates that come pre-configured (demo, the owner's own profile). */
export const TEMPLATE_MARKER = JSON.stringify({ version: 1, skipped: "template" });
