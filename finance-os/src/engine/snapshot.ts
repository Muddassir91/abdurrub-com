import Decimal from "decimal.js";
import { BUCKETS, type Bucket, type AccountRole } from "@/lib/constants";
import { lastNMonths, monthRange, todayKey } from "@/lib/dates";
import { ratioPct, type Minor } from "@/lib/money";
import { computeAllocations, emptyAllocations, policyPercentages, selectPolicy, validatePolicy } from "./allocation";
import { computeClients, recurringMonthlyRevenue } from "./clients";
import { computeExpenses, directDeliveryRows, growthRows, overheadRows } from "./expenses";
import { accountBalanceUsd, actualByBucket, envelopeBalances } from "./ledger";
import { computeOwner } from "./owner";
import { computeReserve } from "./reserves";
import { computeRevenue } from "./revenue";
import type { EngineData, EnvelopeState, MonthSnapshot, Allocations } from "./types";

const ENVELOPE_ACCOUNT_ROLE: Record<Bucket, AccountRole | null> = {
  opex: "operating",
  owner: null,
  tax: "tax",
  profit: "profit",
  reserve: "savings",
  growth: "growth",
};

export function fundedBalanceForRole(data: EngineData, role: AccountRole, upToDate?: string): Minor {
  return data.accounts.filter((a) => a.role === role && !a.isArchived).reduce((acc, a) => acc + accountBalanceUsd(a, data.transactions, data.settings, upToDate), 0);
}

export function isMonthClosed(data: EngineData, month: string): boolean {
  return data.monthCloses.some((c) => c.month === month && c.status === "closed");
}

/** Build the complete financial picture for one month. Pure; safe to call on every render. */
export function buildSnapshot(data: EngineData, month: string, today = todayKey()): MonthSnapshot {
  const { settings } = data;
  const revenue = computeRevenue(month, data.transactions, data.invoices, data.revenuePeriods, today);
  const policy = selectPolicy(data.policies, revenue.allocatable, settings.pinnedPolicyId);
  const policyValid = validatePolicy(policy).ok;
  const allocations: Allocations = policyValid ? computeAllocations(revenue.allocatable, policyPercentages(policy)) : emptyAllocations();
  const actual = actualByBucket(data.transactions, month);

  const owner = computeOwner(month, data.transactions, data.householdLines, data.categories, settings, allocations.owner);
  const expenses = computeExpenses(month, data.transactions, data.recurringExpenses, data.categories, settings, allocations, revenue.netDistributable, owner.drawn);

  const { end } = monthRange(month);
  const asOf = end < today ? end : today;
  const env = envelopeBalances(data.allocationEntries, data.transactions, month);
  const envelopes: EnvelopeState[] = BUCKETS.map((b) => {
    const role = ENVELOPE_ACCOUNT_ROLE[b];
    return { bucket: b, credits: env[b].credits, debits: env[b].debits, balance: env[b].balance, fundedBalance: role ? fundedBalanceForRole(data, role, asOf) : null };
  });

  const reserve = computeReserve(month, env.reserve.balance, fundedBalanceForRole(data, "savings", asOf), expenses.essentialMonthly, allocations.reserve, settings);

  const taxPaidThisMonth = data.transactions.filter((t) => t.month === month && t.type === "tax_payment").reduce((a, t) => a + t.amountUsdCents, 0);
  const taxPaidTotal = data.transactions.filter((t) => t.month <= month && t.type === "tax_payment").reduce((a, t) => a + t.amountUsdCents, 0);

  const distributed = data.transactions.filter((t) => t.month <= month && t.type === "profit_distribution").reduce((a, t) => a + t.amountUsdCents, 0);
  const profit = {
    target: allocations.profit,
    monthlyActual: expenses.netResultAfterOwnerPay,
    marginPct: expenses.netMarginPct,
    cumulativeRetained: env.profit.balance,
    distributed,
    availableForDistribution: Math.max(0, env.profit.balance),
  };

  const { clients, concentration } = computeClients(month, data.clients, data.revenuePeriods, data.invoices, data.transactions);

  // Cash position as of the month end (or today for the current month).
  const bankBusinessCash = data.accounts.filter((a) => a.isBusiness && a.kind !== "processor" && !a.isArchived).reduce((acc, a) => acc + accountBalanceUsd(a, data.transactions, settings, asOf), 0);
  const personalCash = data.accounts.filter((a) => !a.isBusiness && !a.isArchived).reduce((acc, a) => acc + accountBalanceUsd(a, data.transactions, settings, asOf), 0);
  const processorAvailable = fundedBalanceForRole(data, "processor_available", asOf);
  const processorRestricted = fundedBalanceForRole(data, "processor_restricted", asOf);
  const totalEnvelopes = BUCKETS.reduce((acc, b) => acc + Math.max(0, env[b].balance), 0);

  const trailing = lastNMonths(month, 3);
  const outflows = trailing.map((m) => {
    const o = overheadRows(data.transactions, m).reduce((a, t) => a + t.amountUsdCents, 0);
    const d = directDeliveryRows(data.transactions, m).reduce((a, t) => a + t.amountUsdCents, 0);
    const g = growthRows(data.transactions, m).reduce((a, t) => a + t.amountUsdCents, 0);
    const draws = data.transactions.filter((t) => t.month === m && (t.type === "owner_draw" || t.type === "tax_payment" || t.type === "profit_distribution")).reduce((a, t) => a + t.amountUsdCents, 0);
    return o + d + g + draws;
  });
  const monthsWithOutflow = outflows.filter((x) => x > 0);
  let avgMonthlyOutflow = monthsWithOutflow.length ? Math.round(monthsWithOutflow.reduce((a, b) => a + b, 0) / monthsWithOutflow.length) : 0;
  if (avgMonthlyOutflow === 0) avgMonthlyOutflow = expenses.committedSubscriptionsMonthly + allocations.owner;
  const runwayMonths = avgMonthlyOutflow > 0 ? new Decimal(Math.max(0, bankBusinessCash)).div(avgMonthlyOutflow).toDecimalPlaces(1).toString() : null;

  return {
    month,
    isClosed: isMonthClosed(data, month),
    policy,
    policyValid,
    allocations,
    actualByBucket: actual,
    revenue,
    expenses,
    owner,
    envelopes,
    reserve,
    profit,
    tax: { target: allocations.tax, envelopeBalance: env.tax.balance, fundedBalance: fundedBalanceForRole(data, "tax", asOf), paidThisMonth: taxPaidThisMonth, paidTotal: taxPaidTotal },
    clients,
    concentration,
    cash: {
      bankBusinessCash,
      personalCash,
      processorAvailable,
      processorRestricted,
      totalEnvelopes,
      receivables: revenue.outstandingReceivables,
      runwayMonths,
      avgMonthlyOutflow,
      recurringMonthlyRevenue: recurringMonthlyRevenue(month, data.clients, data.revenuePeriods),
    },
  };
}

/** Time series for charts. */
export function monthlySeries(data: EngineData, months: string[], today = todayKey()) {
  return months.map((m) => {
    const snap = buildSnapshot(data, m, today);
    return {
      month: m,
      collected: snap.revenue.collected,
      net: snap.revenue.netDistributable,
      earned: snap.revenue.grossEarned,
      overhead: snap.expenses.overheadActual,
      direct: snap.expenses.directDeliveryActual,
      growth: snap.expenses.growthActual,
      ownerDrawn: snap.owner.drawn,
      profit: snap.expenses.netResultAfterOwnerPay,
      fees: snap.revenue.totalFees,
    };
  });
}

export const pct = ratioPct;
