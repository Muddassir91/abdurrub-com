import type { Invoice, Transaction, ClientRevenuePeriod } from "@/db/schema";
import { monthRange } from "@/lib/dates";
import type { Minor } from "@/lib/money";
import { isCollectionFee, isReversal, isRevenue, sumUsd } from "./ledger";
import type { RevenueMetrics } from "./types";

export function invoicePaid(invoice: Invoice, transactions: Transaction[], upToDate?: string): Minor {
  return transactions
    .filter((t) => t.invoiceId === invoice.id && t.type === "client_payment" && (!upToDate || t.date <= upToDate))
    .reduce((a, t) => a + t.amountUsdCents, 0);
}

export type InvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "void";

export function invoiceStatus(invoice: Invoice, transactions: Transaction[], today: string, graceDays = 0): InvoiceStatus {
  if (invoice.status === "void" || invoice.status === "draft") return invoice.status;
  const paid = invoicePaid(invoice, transactions);
  if (paid >= invoice.amountUsdCents) return "paid";
  const due = new Date(invoice.dueDate);
  due.setDate(due.getDate() + graceDays);
  const dueKey = due.toISOString().slice(0, 10);
  if (today > dueKey) return "overdue";
  return paid > 0 ? "partially_paid" : "sent";
}

export function invoiceOutstanding(invoice: Invoice, transactions: Transaction[], upToDate?: string): Minor {
  if (invoice.status === "void" || invoice.status === "draft") return 0;
  return Math.max(0, invoice.amountUsdCents - invoicePaid(invoice, transactions, upToDate));
}

export function computeRevenue(month: string, transactions: Transaction[], invoices: Invoice[], revenuePeriods: ClientRevenuePeriod[], today: string): RevenueMetrics {
  const rows = transactions.filter((t) => t.month === month);
  const collected = sumUsd(rows.filter(isRevenue));
  const refunds = sumUsd(rows.filter((t) => t.type === "refund"));
  const chargebacks = sumUsd(rows.filter((t) => t.type === "chargeback"));
  const processingFees = sumUsd(rows.filter((t) => t.type === "processing_fee"));
  const conversionFees = sumUsd(rows.filter((t) => t.type === "conversion_fee"));
  const payoutFees = sumUsd(rows.filter((t) => t.type === "payout_fee"));
  const platformFees = sumUsd(rows.filter((t) => t.type === "platform_fee"));
  const totalFees = sumUsd(rows.filter(isCollectionFee));
  const reservesHeld = sumUsd(rows.filter((t) => t.type === "reserve_hold"));
  const reservesReleased = sumUsd(rows.filter((t) => t.type === "reserve_release"));
  void isReversal;

  // Each fee row is subtracted exactly once; nothing here is derived from gross twice.
  const netDistributable = collected - refunds - chargebacks - totalFees;
  const allocatableRaw = netDistributable - reservesHeld + reservesReleased;
  const allocatable = Math.max(0, allocatableRaw);

  const grossEarned = revenuePeriods.filter((p) => p.month === month).reduce((a, p) => a + p.commissionUsdCents + p.retainerUsdCents + p.fixedFeesUsdCents, 0);
  const invoiced = invoices.filter((i) => i.periodMonth === month && i.status !== "void" && i.status !== "draft").reduce((a, i) => a + i.amountUsdCents, 0);

  const { end } = monthRange(month);
  const asOf = end < today ? end : today;
  let outstandingReceivables = 0;
  let overdueReceivables = 0;
  for (const inv of invoices) {
    if (inv.issueDate > asOf) continue;
    const out = invoiceOutstanding(inv, transactions, asOf);
    outstandingReceivables += out;
    if (out > 0 && inv.dueDate < asOf) overdueReceivables += out;
  }

  return {
    grossEarned,
    invoiced,
    collected,
    refunds,
    chargebacks,
    processingFees,
    conversionFees,
    payoutFees,
    platformFees,
    totalFees,
    reservesHeld,
    reservesReleased,
    netDistributable,
    allocatable,
    allocatableRaw,
    outstandingReceivables,
    overdueReceivables,
  };
}
