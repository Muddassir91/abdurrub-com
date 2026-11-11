/**
 * Per-workspace interface preferences, stored as JSON in settings.ui_json.
 * Today that is the home screen: which sections show, in what order, and any
 * custom trackers the person asked for.
 */

export const SECTION_IDS = ["next", "summary", "budgets", "trackers", "activity", "categories", "weeks", "setaside", "upcoming"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_LABELS: Record<SectionId, string> = {
  next: "What to do next",
  summary: "Money in, out and kept",
  budgets: "Budgets",
  trackers: "Your trackers",
  activity: "Recent activity",
  categories: "Where it went",
  weeks: "In and out, week by week",
  setaside: "Tax, cushion and profit set aside",
  upcoming: "Coming up",
};

/** Words people use for each section, for the on-device parser and the model. */
export const SECTION_ALIASES: Record<SectionId, string[]> = {
  next: ["what to do next", "next steps", "to do", "todo", "checklist", "next"],
  summary: ["summary", "money in", "money out", "kept", "split", "hero", "overview", "totals"],
  budgets: ["budgets", "budget", "progress bars", "running costs", "home essentials"],
  trackers: ["trackers", "tracker", "custom", "my trackers"],
  activity: ["recent activity", "activity", "transactions", "recent", "history"],
  categories: ["where it went", "categories", "category", "pie", "pie chart", "donut", "breakdown"],
  weeks: ["week by week", "weeks", "weekly", "bar chart", "bars", "chart", "graph", "trend"],
  setaside: ["set aside", "tax set aside", "cushion", "profit kept", "savings", "set-aside"],
  upcoming: ["coming up", "upcoming", "renewals", "subscriptions due"],
};

export const METRIC_IDS = ["money_in", "money_out", "kept", "business_cash", "personal_cash", "tax_set_aside", "cushion", "subscriptions_monthly", "pay_taken", "runway_months"] as const;
export type MetricId = (typeof METRIC_IDS)[number];
export const METRIC_LABELS: Record<MetricId, string> = {
  money_in: "Money in this month",
  money_out: "Money out this month",
  kept: "Kept this month",
  business_cash: "Business cash",
  personal_cash: "Personal cash",
  tax_set_aside: "Tax set aside",
  cushion: "Cash cushion",
  subscriptions_monthly: "Subscriptions per month",
  pay_taken: "Pay taken this month",
  runway_months: "Months of runway",
};

export interface Tracker {
  id: string;
  kind: "category" | "metric";
  label: string;
  /** kind "category": the category name to total this month. */
  category?: string;
  /** Optional monthly limit (ledger minor units) shown as a progress bar. */
  limitMinor?: number;
  metric?: MetricId;
}

export interface UiPrefs {
  dashboard: {
    order: SectionId[];
    hidden: SectionId[];
    trackers: Tracker[];
  };
}

/** Lean by default: what to do, the numbers, the budgets, the latest entries, where it went. */
export const DEFAULT_HIDDEN: SectionId[] = ["weeks", "setaside", "upcoming"];

export const PRESETS: Record<string, { label: string; hidden: SectionId[] }> = {
  simple: { label: "Simple", hidden: ["budgets", "categories", "weeks", "setaside", "upcoming"] },
  standard: { label: "Standard", hidden: DEFAULT_HIDDEN },
  everything: { label: "Everything", hidden: [] },
  spending: { label: "Spending", hidden: ["setaside", "upcoming", "weeks"] },
  business: { label: "Business", hidden: ["categories"] },
};

export function defaultUi(): UiPrefs {
  return { dashboard: { order: [...SECTION_IDS], hidden: [...DEFAULT_HIDDEN], trackers: [] } };
}

const isSection = (x: unknown): x is SectionId => typeof x === "string" && (SECTION_IDS as readonly string[]).includes(x);

export function parseUi(json: string | null | undefined): UiPrefs {
  const base = defaultUi();
  if (!json) return base;
  try {
    const v = JSON.parse(json) as Partial<UiPrefs>;
    const d = v.dashboard ?? ({} as Partial<UiPrefs["dashboard"]>);
    const order = (Array.isArray(d.order) ? d.order.filter(isSection) : []) as SectionId[];
    for (const id of SECTION_IDS) if (!order.includes(id)) order.push(id);
    const hidden = Array.isArray(d.hidden) ? (d.hidden.filter(isSection) as SectionId[]) : base.dashboard.hidden;
    const trackers = Array.isArray(d.trackers) ? d.trackers.filter((t) => t && typeof t.label === "string" && (t.kind === "category" || t.kind === "metric")) : [];
    return { dashboard: { order: [...new Set(order)], hidden: [...new Set(hidden)], trackers } };
  } catch {
    return base;
  }
}

/** Which preset (if any) the current hidden set matches. */
export function activePreset(ui: UiPrefs): string | null {
  const key = (xs: SectionId[]) => [...xs].sort().join(",");
  const cur = key(ui.dashboard.hidden.filter((h) => h !== "trackers"));
  for (const [name, p] of Object.entries(PRESETS)) if (key(p.hidden) === cur) return name;
  return null;
}

/** Find the section a phrase refers to. */
export function resolveSection(phrase: string): SectionId | null {
  const q = phrase.trim().toLowerCase().replace(/^the\s+/, "").replace(/\s+(section|card|chart|widget|panel)s?$/, "");
  if (!q) return null;
  if (isSection(q)) return q;
  for (const id of SECTION_IDS) if (SECTION_ALIASES[id].includes(q)) return id;
  for (const id of SECTION_IDS) if (SECTION_ALIASES[id].some((a) => q.includes(a) || (a.includes(q) && q.length >= 4))) return id;
  return null;
}
