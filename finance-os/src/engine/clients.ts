import Decimal from "decimal.js";
import type { Client, ClientRevenuePeriod, Invoice, Transaction } from "@/db/schema";
import { lastNMonths } from "@/lib/dates";
import { pctOf, ratioPct, type Minor } from "@/lib/money";
import { isBusinessSpend } from "./ledger";
import { invoiceOutstanding } from "./revenue";
import type { ClientMetrics, ConcentrationMetrics } from "./types";

/** Agency revenue from a revenue-share client is the commission only, never the client's store revenue. */
export function commissionFor(clientAttributableRevenueUsdCents: Minor, revenueSharePct: string | null | undefined): Minor {
  if (!revenueSharePct) return 0;
  return pctOf(clientAttributableRevenueUsdCents, revenueSharePct);
}

export function periodEarned(p: ClientRevenuePeriod): Minor {
  return p.commissionUsdCents + p.retainerUsdCents + p.fixedFeesUsdCents;
}

export function computeClients(month: string, clients: Client[], periods: ClientRevenuePeriod[], invoices: Invoice[], transactions: Transaction[]): { clients: ClientMetrics[]; concentration: ConcentrationMetrics } {
  const trailing = lastNMonths(month, 3);
  const metrics: ClientMetrics[] = clients
    .filter((c) => c.status !== "prospect")
    .map((c) => {
      const earned = periods.filter((p) => p.clientId === c.id && p.month === month).reduce((a, p) => a + periodEarned(p), 0);
      const trailingEarned = periods.filter((p) => p.clientId === c.id && trailing.includes(p.month)).reduce((a, p) => a + periodEarned(p), 0);
      const rows = transactions.filter((t) => t.clientId === c.id && t.month === month);
      const collected = rows.filter((t) => t.type === "client_payment").reduce((a, t) => a + t.amountUsdCents, 0);
      const invoiced = invoices.filter((i) => i.clientId === c.id && i.periodMonth === month && i.status !== "void" && i.status !== "draft").reduce((a, i) => a + i.amountUsdCents, 0);
      const outstanding = invoices.filter((i) => i.clientId === c.id).reduce((a, i) => a + invoiceOutstanding(i, transactions), 0);
      const directCosts = rows.filter((t) => isBusinessSpend(t) && t.costType === "direct_delivery").reduce((a, t) => a + t.amountUsdCents, 0);
      const associatedExpenses = rows.filter((t) => isBusinessSpend(t)).reduce((a, t) => a + t.amountUsdCents, 0);
      const base = earned > 0 ? earned : collected;
      const profit = base - associatedExpenses;
      return {
        clientId: c.id,
        name: c.name,
        earned,
        collected,
        invoiced,
        outstanding,
        directCosts,
        associatedExpenses,
        profit,
        marginPct: base > 0 ? ratioPct(profit, base)!.toDecimalPlaces(1).toString() : null,
        sharePct: null,
        trailingEarned,
      };
    });

  const totalEarned = metrics.reduce((a, m) => a + m.earned, 0);
  const totalCollected = metrics.reduce((a, m) => a + m.collected, 0);
  const basis: ConcentrationMetrics["basis"] = totalEarned > 0 ? "earned" : totalCollected > 0 ? "collected" : "none";
  const total = basis === "earned" ? totalEarned : totalCollected;
  for (const m of metrics) {
    const v = basis === "earned" ? m.earned : m.collected;
    m.sharePct = total > 0 ? new Decimal(v).div(total).mul(100).toDecimalPlaces(1).toString() : null;
  }
  const largest = metrics.filter((m) => m.sharePct !== null).sort((a, b) => Number(b.sharePct) - Number(a.sharePct))[0];
  const totalTrailing = metrics.reduce((a, m) => a + m.trailingEarned, 0);
  const largestTrailing = metrics.slice().sort((a, b) => b.trailingEarned - a.trailingEarned)[0];
  return {
    clients: metrics.sort((a, b) => b.earned + b.collected - (a.earned + a.collected)),
    concentration: {
      largestClientId: largest?.clientId ?? null,
      largestClientName: largest?.name ?? null,
      largestSharePct: largest?.sharePct ?? null,
      trailingLargestSharePct: totalTrailing > 0 && largestTrailing ? new Decimal(largestTrailing.trailingEarned).div(totalTrailing).mul(100).toDecimalPlaces(1).toString() : null,
      basis,
    },
  };
}

/** Recurring monthly revenue: retainers plus trailing 3-month average commission for revenue-share clients. */
export function recurringMonthlyRevenue(month: string, clients: Client[], periods: ClientRevenuePeriod[]): Minor {
  const trailing = lastNMonths(month, 3);
  let mrr = 0;
  for (const c of clients) {
    if (c.status !== "active") continue;
    mrr += c.monthlyRetainerUsdCents;
    if (c.revenueSharePct) {
      const ps = periods.filter((p) => p.clientId === c.id && trailing.includes(p.month));
      if (ps.length > 0) mrr += Math.round(ps.reduce((a, p) => a + p.commissionUsdCents, 0) / ps.length);
    }
  }
  return mrr;
}
