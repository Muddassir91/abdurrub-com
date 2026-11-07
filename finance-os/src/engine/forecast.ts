import { addMonths, monthKeyOf, todayKey } from "@/lib/dates";
import type { Minor } from "@/lib/money";
import { monthlyCostUsd, isActiveSubscription } from "./expenses";
import { invoiceOutstanding } from "./revenue";
import { reserveReleaseSchedule } from "./processor";
import { recurringMonthlyRevenue } from "./clients";
import { computeAllocations, policyPercentages, selectPolicy, validatePolicy } from "./allocation";
import type { EngineData, MonthSnapshot } from "./types";

export interface ForecastMonth {
  month: string;
  expectedInvoiceCollections: Minor;
  expectedReserveReleases: Minor;
  reserveReleasesUnknownDate: Minor;
  projectedRecurringRevenue: Minor;
  committedSubscriptions: Minor;
  plannedOwnerComp: Minor;
  plannedTaxSetAside: Minor;
  netCashChange: Minor;
  projectedBankCash: Minor;
  isEstimate: true;
}

/**
 * Rolling cash-flow forecast. Receivables and reserve releases are dated
 * expectations; recurring revenue is an estimate from retainers and trailing
 * commissions. Restricted funds only count when their release date arrives.
 */
export function buildForecast(data: EngineData, snap: MonthSnapshot, months = 6, today = todayKey()): ForecastMonth[] {
  const startMonth = addMonths(snap.month, 1);
  const releases = reserveReleaseSchedule(data.reserves, startMonth, months);
  const subs = data.recurringExpenses.filter((r) => isActiveSubscription(r)).reduce((a, r) => a + monthlyCostUsd(r, data.settings), 0);
  const mrr = recurringMonthlyRevenue(snap.month, data.clients, data.revenuePeriods);
  let cash = snap.cash.bankBusinessCash + snap.cash.processorAvailable;
  const out: ForecastMonth[] = [];
  for (let i = 0; i < months; i++) {
    const m = addMonths(startMonth, i);
    const invoiceCollections = data.invoices.reduce((acc, inv) => {
      const outstanding = invoiceOutstanding(inv, data.transactions);
      if (outstanding <= 0) return acc;
      const expected = inv.expectedPaymentDate ?? inv.dueDate;
      const expMonth = monthKeyOf(expected < today ? today : expected);
      return expMonth === m ? acc + outstanding : acc;
    }, 0);
    const rel = releases[i] ?? { amount: 0, unknownDate: 0 };
    // Recurring revenue is only projected for months without a dated invoice for it.
    const projectedRecurring = invoiceCollections > 0 ? Math.max(0, mrr - invoiceCollections) : mrr;
    const inflow = invoiceCollections + rel.amount + projectedRecurring;
    const policy = selectPolicy(data.policies, inflow, data.settings.pinnedPolicyId);
    const alloc = validatePolicy(policy).ok ? computeAllocations(inflow, policyPercentages(policy)) : null;
    const owner = alloc?.owner ?? 0;
    const tax = alloc?.tax ?? 0;
    const net = inflow - subs - owner;
    cash += net;
    out.push({
      month: m,
      expectedInvoiceCollections: invoiceCollections,
      expectedReserveReleases: rel.amount,
      reserveReleasesUnknownDate: rel.unknownDate,
      projectedRecurringRevenue: projectedRecurring,
      committedSubscriptions: subs,
      plannedOwnerComp: owner,
      plannedTaxSetAside: tax,
      netCashChange: net,
      projectedBankCash: cash,
      isEstimate: true,
    });
  }
  return out;
}
