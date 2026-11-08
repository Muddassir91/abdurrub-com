import { format, parseISO, startOfISOWeek, addDays, addWeeks, addYears, startOfYear, endOfMonth, startOfMonth, subDays } from "date-fns";
import type { Transaction } from "@/db/schema";
import type { Minor } from "@/lib/money";
import { addMonths, monthLabel } from "@/lib/dates";
import { isBusinessSpend, isCollectionFee, isRevenue } from "./ledger";

export type Granularity = "day" | "week" | "month" | "year";

export interface TrendPoint {
  key: string; // bucket start date (YYYY-MM-DD) or month/year key
  label: string;
  start: string;
  end: string; // inclusive
  collected: Minor;
  fees: Minor;
  reversals: Minor;
  net: Minor; // collected − reversals − fees
  overhead: Minor;
  direct: Minor;
  growth: Minor;
  businessSpend: Minor;
  ownerDraws: Minor;
  personalSpend: Minor;
  result: Minor; // net − business spend − owner draws
  cumulativeResult: Minor;
  transactions: number;
}

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

/** Build the bucket boundaries for a granularity, ending at `today`. */
export function trendBuckets(granularity: Granularity, today: string, count?: number): { key: string; label: string; start: string; end: string }[] {
  const t = parseISO(today);
  const out: { key: string; label: string; start: string; end: string }[] = [];
  if (granularity === "day") {
    const n = count ?? 30;
    for (let i = n - 1; i >= 0; i--) {
      const d = subDays(t, i);
      out.push({ key: fmt(d), label: format(d, "d MMM"), start: fmt(d), end: fmt(d) });
    }
  } else if (granularity === "week") {
    const n = count ?? 12;
    const thisWeek = startOfISOWeek(t);
    for (let i = n - 1; i >= 0; i--) {
      const s = addWeeks(thisWeek, -i);
      const e = addDays(s, 6);
      out.push({ key: fmt(s), label: `w/c ${format(s, "d MMM")}`, start: fmt(s), end: fmt(e) });
    }
  } else if (granularity === "month") {
    const n = count ?? 12;
    const thisMonth = format(t, "yyyy-MM");
    for (let i = n - 1; i >= 0; i--) {
      const m = addMonths(thisMonth, -i);
      const s = startOfMonth(parseISO(`${m}-01`));
      out.push({ key: m, label: monthLabel(m), start: fmt(s), end: fmt(endOfMonth(s)) });
    }
  } else {
    const n = count ?? 5;
    const thisYear = startOfYear(t);
    for (let i = n - 1; i >= 0; i--) {
      const s = addYears(thisYear, -i);
      const e = addDays(addYears(s, 1), -1);
      out.push({ key: format(s, "yyyy"), label: format(s, "yyyy"), start: fmt(s), end: fmt(e) });
    }
  }
  return out;
}

/** Aggregate the ledger into trend points. Transfers never count; personal spend is reported but excluded from the business result. */
export function buildTrend(transactions: Transaction[], granularity: Granularity, today: string, count?: number): TrendPoint[] {
  const buckets = trendBuckets(granularity, today, count);
  let cumulative = 0;
  return buckets.map((b) => {
    const rows = transactions.filter((t) => t.date >= b.start && t.date <= b.end);
    const collected = rows.filter(isRevenue).reduce((a, t) => a + t.amountUsdCents, 0);
    const fees = rows.filter(isCollectionFee).reduce((a, t) => a + t.amountUsdCents, 0);
    const reversals = rows.filter((t) => t.type === "refund" || t.type === "chargeback").reduce((a, t) => a + t.amountUsdCents, 0);
    const spend = rows.filter(isBusinessSpend);
    const overhead = spend.filter((t) => t.costType !== "direct_delivery" && t.bucket !== "growth" && t.type !== "growth_investment").reduce((a, t) => a + t.amountUsdCents, 0);
    const direct = spend.filter((t) => t.costType === "direct_delivery").reduce((a, t) => a + t.amountUsdCents, 0);
    const growth = spend.filter((t) => t.costType !== "direct_delivery" && (t.bucket === "growth" || t.type === "growth_investment")).reduce((a, t) => a + t.amountUsdCents, 0);
    const ownerDraws = rows.filter((t) => t.type === "owner_draw" || t.type === "profit_distribution").reduce((a, t) => a + t.amountUsdCents, 0);
    const personalSpend = rows.filter((t) => t.type === "household_expense" || t.type === "personal_expense").reduce((a, t) => a + t.amountUsdCents, 0);
    const net = collected - reversals - fees;
    const businessSpend = overhead + direct + growth;
    const result = net - businessSpend - ownerDraws;
    cumulative += result;
    return { ...b, collected, fees, reversals, net, overhead, direct, growth, businessSpend, ownerDraws, personalSpend, result, cumulativeResult: cumulative, transactions: rows.length };
  });
}

export interface TrendSummary {
  current: TrendPoint;
  previous: TrendPoint | null;
  netChangePct: string | null;
  spendChangePct: string | null;
  bestPeriod: TrendPoint | null;
  averageNet: Minor;
}

export function summarizeTrend(points: TrendPoint[]): TrendSummary {
  const current = points[points.length - 1];
  const previous = points.length > 1 ? points[points.length - 2] : null;
  const pct = (a: Minor, b: Minor) => (b > 0 ? (((a - b) / b) * 100).toFixed(1) : null);
  const withData = points.filter((p) => p.transactions > 0);
  const best = withData.length ? withData.reduce((m, p) => (p.net > m.net ? p : m)) : null;
  const averageNet = withData.length ? Math.round(withData.reduce((a, p) => a + p.net, 0) / withData.length) : 0;
  return { current, previous, netChangePct: previous ? pct(current.net, previous.net) : null, spendChangePct: previous ? pct(current.businessSpend, previous.businessSpend) : null, bestPeriod: best, averageNet };
}
