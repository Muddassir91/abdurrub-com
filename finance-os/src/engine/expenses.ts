import Decimal from "decimal.js";
import type { Category, RecurringExpense, Settings, Transaction } from "@/db/schema";
import { FREQUENCY_MONTHS, type Frequency } from "@/lib/constants";
import { lastNMonths } from "@/lib/dates";
import { convertToUsdCents, ratioPct, toMinor, type CurrencyCode, type Minor } from "@/lib/money";
import { isBusinessSpend, effectiveBucket } from "./ledger";
import type { Allocations, ExpenseMetrics } from "./types";

const fmt = (d: Decimal | null) => (d ? d.toDecimalPlaces(2).toString() : null);

/** Normalise a recurring expense to a monthly USD figure. */
export function monthlyCostUsd(r: RecurringExpense, settings: Settings): Minor {
  const usd = convertToUsdCents(r.amountMinor, r.currency as CurrencyCode, r.currency === "USD" || r.currency === settings.baseCurrency ? "1" : settings.defaultFxRatePkrPerUsd);
  const months = FREQUENCY_MONTHS[r.frequency as Frequency] ?? 1;
  return toMinor(new Decimal(usd).div(months));
}

export const isActiveSubscription = (r: RecurringExpense) => r.status === "active";

export function overheadRows(transactions: Transaction[], month: string) {
  return transactions.filter((t) => t.month === month && isBusinessSpend(t) && t.costType !== "direct_delivery" && effectiveBucket(t) !== "growth");
}
export function directDeliveryRows(transactions: Transaction[], month: string) {
  return transactions.filter((t) => t.month === month && isBusinessSpend(t) && t.costType === "direct_delivery");
}
export function growthRows(transactions: Transaction[], month: string) {
  return transactions.filter((t) => t.month === month && isBusinessSpend(t) && t.costType !== "direct_delivery" && effectiveBucket(t) === "growth");
}

/** Average monthly ESSENTIAL operating cost over the trailing window, with sensible fallbacks for new books. */
export function essentialMonthlyCost(month: string, transactions: Transaction[], recurring: RecurringExpense[], settings: Settings): Minor {
  const months = lastNMonths(month, 3);
  const monthsWithData = months.filter((m) => transactions.some((t) => t.month === m && isBusinessSpend(t)));
  if (monthsWithData.length > 0) {
    const total = monthsWithData.reduce((acc, m) => acc + overheadRows(transactions, m).filter((t) => t.isEssential).reduce((a, t) => a + t.amountUsdCents, 0), 0);
    const avg = Math.round(total / monthsWithData.length);
    if (avg > 0) return avg;
  }
  const essentialSubs = recurring.filter((r) => isActiveSubscription(r) && r.isEssential && r.costType !== "direct_delivery");
  const subsTotal = essentialSubs.reduce((a, r) => a + monthlyCostUsd(r, settings), 0);
  if (subsTotal > 0) return subsTotal;
  return recurring.filter((r) => isActiveSubscription(r) && r.costType !== "direct_delivery").reduce((a, r) => a + monthlyCostUsd(r, settings), 0);
}

export function computeExpenses(
  month: string,
  transactions: Transaction[],
  recurring: RecurringExpense[],
  categories: Category[],
  settings: Settings,
  allocations: Allocations,
  netDistributable: Minor,
  ownerDrawn: Minor,
): ExpenseMetrics {
  const overhead = overheadRows(transactions, month);
  const direct = directDeliveryRows(transactions, month);
  const growth = growthRows(transactions, month);
  const overheadActual = overhead.reduce((a, t) => a + t.amountUsdCents, 0);
  const directDeliveryActual = direct.reduce((a, t) => a + t.amountUsdCents, 0);
  const growthActual = growth.reduce((a, t) => a + t.amountUsdCents, 0);

  const policyCeiling = allocations.opex;
  const override = settings.opexCeilingOverrideUsdCents;
  const ceiling = override != null && override > policyCeiling ? override : policyCeiling;
  const ceilingSource = ceiling === policyCeiling ? "policy" : "override";
  const remainingAllowance = ceiling - overheadActual;
  const unspentAllowance = Math.max(0, remainingAllowance);

  const committedSubscriptionsMonthly = recurring.filter((r) => isActiveSubscription(r) && r.costType !== "direct_delivery" && r.bucket !== "growth").reduce((a, r) => a + monthlyCostUsd(r, settings), 0);
  const essentialMonthly = essentialMonthlyCost(month, transactions, recurring, settings);

  const grossProfit = netDistributable - directDeliveryActual;
  const operatingResult = grossProfit - overheadActual - growthActual;
  const netResultAfterOwnerPay = operatingResult - ownerDrawn;

  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const byCat = new Map<string | null, Minor>();
  for (const t of [...overhead, ...direct, ...growth]) byCat.set(t.categoryId ?? null, (byCat.get(t.categoryId ?? null) ?? 0) + t.amountUsdCents);
  const byCategory = [...byCat.entries()]
    .map(([categoryId, amount]) => ({ categoryId, name: categoryId ? (catName.get(categoryId) ?? "Unknown") : "Uncategorised", amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    ceiling,
    ceilingSource,
    policyCeiling,
    overheadActual,
    directDeliveryActual,
    growthActual,
    remainingAllowance,
    unspentAllowance,
    spendPct: fmt(ratioPct(overheadActual, ceiling)),
    opexRatioPct: fmt(ratioPct(overheadActual, netDistributable)),
    committedSubscriptionsMonthly,
    essentialMonthly,
    grossProfit,
    grossMarginPct: fmt(ratioPct(grossProfit, netDistributable)),
    operatingResult,
    operatingMarginPct: fmt(ratioPct(operatingResult, netDistributable)),
    netResultAfterOwnerPay,
    netMarginPct: fmt(ratioPct(netResultAfterOwnerPay, netDistributable)),
    byCategory,
  };
}

/** Subscriptions renewing within `days` of `today`. */
export function upcomingRenewals(recurring: RecurringExpense[], today: string, days: number) {
  const limit = new Date(today);
  limit.setDate(limit.getDate() + days);
  const limitKey = limit.toISOString().slice(0, 10);
  return recurring.filter((r) => isActiveSubscription(r) && r.nextRenewalDate && r.nextRenewalDate >= today && r.nextRenewalDate <= limitKey).sort((a, b) => (a.nextRenewalDate! < b.nextRenewalDate! ? -1 : 1));
}

/** Subscription spend trend: monthly overhead totals of recurring-tagged rows across months. */
export function subscriptionTrend(transactions: Transaction[], months: string[]): { month: string; amount: Minor }[] {
  return months.map((m) => ({ month: m, amount: overheadRows(transactions, m).filter((t) => t.isRecurring || t.recurringExpenseId).reduce((a, t) => a + t.amountUsdCents, 0) }));
}
