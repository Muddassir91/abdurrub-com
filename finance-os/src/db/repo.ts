import { eq } from "drizzle-orm";
import type { Db } from "./client";
import * as s from "./schema";
import type { EngineData } from "@/engine/types";
import { computeSaleFees, computePayoutFee, type SaleFeeInput, type PayoutMethod } from "@/engine/processor";
import { commissionFor } from "@/engine/clients";
import { rateFor } from "@/engine/fx";
import { monthKeyOf, addMonths, monthKeyOf as mk } from "@/lib/dates";
import { convertToUsdCents, type CurrencyCode, type Minor } from "@/lib/money";
import { uid, nowIso } from "@/lib/ids";
import { TWO_SIDED_TYPES, type TransactionType, type Bucket, type Frequency } from "@/lib/constants";

export class ClosedMonthError extends Error {
  constructor(month: string) {
    super(`${month} is closed. Reopen it from Month-end before changing its transactions.`);
    this.name = "ClosedMonthError";
  }
}

export function loadEngineData(db: Db): EngineData {
  const settings = db.select().from(s.settings).get();
  if (!settings) throw new Error("Settings missing; database not seeded");
  return {
    settings,
    policies: db.select().from(s.allocationPolicies).all(),
    entities: db.select().from(s.entities).all(),
    accounts: db.select().from(s.accounts).all().sort((a, b) => a.sortOrder - b.sortOrder),
    categories: db.select().from(s.categories).all().sort((a, b) => a.sortOrder - b.sortOrder),
    vendors: db.select().from(s.vendors).all(),
    clients: db.select().from(s.clients).all(),
    revenuePeriods: db.select().from(s.clientRevenuePeriods).all(),
    invoices: db.select().from(s.invoices).all(),
    transactions: db
      .select()
      .from(s.transactions)
      .all()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1)),
    recurringExpenses: db.select().from(s.recurringExpenses).all(),
    householdLines: db.select().from(s.householdBudgetLines).all().sort((a, b) => a.sortOrder - b.sortOrder),
    processors: db.select().from(s.processors).all(),
    reserves: db.select().from(s.processorReserves).all(),
    fxRates: db.select().from(s.fxRates).all(),
    allocationEntries: db.select().from(s.allocationEntries).all(),
    monthCloses: db.select().from(s.monthCloses).all(),
    taxProfiles: db.select().from(s.taxProfiles).all(),
    complianceItems: db.select().from(s.complianceItems).all().sort((a, b) => a.sortOrder - b.sortOrder),
    growthProposals: db.select().from(s.growthProposals).all(),
    snoozes: db.select().from(s.alertSnoozes).all(),
  };
}

function assertOpen(db: Db, month: string) {
  const c = db.select().from(s.monthCloses).where(eq(s.monthCloses.month, month)).get();
  if (c && c.status === "closed") throw new ClosedMonthError(month);
}

// ---------------------------------------------------------------- settings

export function updateSettings(db: Db, patch: Partial<s.Settings>) {
  db.update(s.settings)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(s.settings.id, 1))
    .run();
}

// ---------------------------------------------------------------- policies

export function upsertPolicy(db: Db, p: Omit<s.NewAllocationPolicy, "createdAt" | "updatedAt" | "id"> & { id?: string }) {
  const now = nowIso();
  const id = p.id ?? uid();
  const existing = db.select().from(s.allocationPolicies).where(eq(s.allocationPolicies.id, id)).get();
  if (p.isDefault) db.update(s.allocationPolicies).set({ isDefault: false }).run();
  if (existing) db.update(s.allocationPolicies).set({ ...p, id, updatedAt: now }).where(eq(s.allocationPolicies.id, id)).run();
  else db.insert(s.allocationPolicies).values({ ...p, id, createdAt: now, updatedAt: now }).run();
  return id;
}

export function deletePolicy(db: Db, id: string) {
  const all = db.select().from(s.allocationPolicies).all();
  if (all.length <= 1) throw new Error("At least one allocation policy must remain");
  const target = all.find((p) => p.id === id);
  db.delete(s.allocationPolicies).where(eq(s.allocationPolicies.id, id)).run();
  if (target?.isDefault) {
    const next = all.find((p) => p.id !== id)!;
    db.update(s.allocationPolicies).set({ isDefault: true }).where(eq(s.allocationPolicies.id, next.id)).run();
  }
}

// ---------------------------------------------------------------- accounts

export function upsertAccount(db: Db, a: Omit<s.NewAccount, "createdAt" | "id"> & { id?: string }) {
  const id = a.id ?? uid();
  const existing = db.select().from(s.accounts).where(eq(s.accounts.id, id)).get();
  if (existing) db.update(s.accounts).set({ ...a, id }).where(eq(s.accounts.id, id)).run();
  else db.insert(s.accounts).values({ ...a, id, createdAt: nowIso() }).run();
  return id;
}

export function archiveAccount(db: Db, id: string, archived = true) {
  db.update(s.accounts).set({ isArchived: archived }).where(eq(s.accounts.id, id)).run();
}

/** Record a manual balance correction so the ledger matches the real statement. */
export function recordBalanceAdjustment(db: Db, accountId: string, deltaMinor: Minor, date: string, note: string, settings: s.Settings, fxRates: s.FxRate[]) {
  const account = db.select().from(s.accounts).where(eq(s.accounts.id, accountId)).get();
  if (!account) throw new Error("Account not found");
  assertOpen(db, monthKeyOf(date));
  const currency = account.currency as CurrencyCode;
  const rate = rateFor(currency, date, fxRates, settings);
  const now = nowIso();
  db.insert(s.transactions)
    .values({
      id: uid(),
      date,
      month: monthKeyOf(date),
      type: "balance_adjustment",
      amountMinor: deltaMinor,
      currency,
      fxRatePerUsd: rate,
      amountUsdCents: convertToUsdCents(deltaMinor, currency, rate),
      description: note || "Balance adjustment",
      accountId,
      isEssential: false,
      isRecurring: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

// ---------------------------------------------------------------- transactions

export interface TransactionInput {
  id?: string;
  date: string;
  type: TransactionType;
  amountMinor: Minor;
  currency: CurrencyCode;
  fxRatePerUsd?: string; // optional explicit rate; else looked up
  description: string;
  categoryId?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  clientId?: string | null;
  invoiceId?: string | null;
  processorId?: string | null;
  vendorId?: string | null;
  recurringExpenseId?: string | null;
  groupId?: string | null;
  costType?: "overhead" | "direct_delivery" | null;
  bucket?: Bucket | null;
  isEssential?: boolean;
  isRecurring?: boolean;
  notes?: string | null;
}

export function validateTransactionInput(t: TransactionInput, accounts: s.Account[]): string[] {
  const errors: string[] = [];
  if (!t.date || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) errors.push("Date is required (YYYY-MM-DD)");
  if (!t.description?.trim()) errors.push("Description is required");
  if (!Number.isInteger(t.amountMinor)) errors.push("Amount must be a number");
  if (t.type !== "balance_adjustment" && t.amountMinor <= 0) errors.push("Amount must be greater than zero");
  if (t.type === "balance_adjustment" && t.amountMinor === 0) errors.push("Adjustment cannot be zero");
  if (TWO_SIDED_TYPES.includes(t.type)) {
    if (!t.accountId) errors.push("Source account is required");
    if (!t.toAccountId) errors.push("Destination account is required");
    if (t.accountId && t.accountId === t.toAccountId) errors.push("Source and destination must differ");
  }
  if (t.accountId && !accounts.some((a) => a.id === t.accountId)) errors.push("Unknown source account");
  if (t.toAccountId && !accounts.some((a) => a.id === t.toAccountId)) errors.push("Unknown destination account");
  if (t.fxRatePerUsd !== undefined && !(Number(t.fxRatePerUsd) > 0)) errors.push("Exchange rate must be positive");
  return errors;
}

function toRow(t: TransactionInput, settings: s.Settings, fxRates: s.FxRate[]): s.NewTransaction {
  // The ledger's unit is the workspace's base currency (historically USD); anything in that currency needs no conversion.
  const rate = t.currency === "USD" || t.currency === settings.baseCurrency ? "1" : (t.fxRatePerUsd ?? rateFor(t.currency, t.date, fxRates, settings));
  const now = nowIso();
  return {
    id: t.id ?? uid(),
    date: t.date,
    month: monthKeyOf(t.date),
    type: t.type,
    amountMinor: t.amountMinor,
    currency: t.currency,
    fxRatePerUsd: rate,
    amountUsdCents: convertToUsdCents(t.amountMinor, t.currency, rate),
    description: t.description.trim(),
    categoryId: t.categoryId ?? null,
    accountId: t.accountId ?? null,
    toAccountId: t.toAccountId ?? null,
    clientId: t.clientId ?? null,
    invoiceId: t.invoiceId ?? null,
    processorId: t.processorId ?? null,
    vendorId: t.vendorId ?? null,
    recurringExpenseId: t.recurringExpenseId ?? null,
    groupId: t.groupId ?? null,
    costType: t.costType ?? null,
    bucket: t.bucket ?? null,
    isEssential: t.isEssential ?? false,
    isRecurring: t.isRecurring ?? false,
    notes: t.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function addTransaction(db: Db, t: TransactionInput, settings: s.Settings, fxRates: s.FxRate[]): string {
  assertOpen(db, monthKeyOf(t.date));
  const row = toRow(t, settings, fxRates);
  db.insert(s.transactions).values(row).run();
  return row.id;
}

export function addTransactions(db: Db, list: TransactionInput[], settings: s.Settings, fxRates: s.FxRate[]): string[] {
  for (const t of list) assertOpen(db, monthKeyOf(t.date));
  const rows = list.map((t) => toRow(t, settings, fxRates));
  for (const r of rows) db.insert(s.transactions).values(r).run();
  return rows.map((r) => r.id);
}

export function updateTransaction(db: Db, id: string, t: TransactionInput, settings: s.Settings, fxRates: s.FxRate[]) {
  const existing = db.select().from(s.transactions).where(eq(s.transactions.id, id)).get();
  if (!existing) throw new Error("Transaction not found");
  assertOpen(db, existing.month);
  assertOpen(db, monthKeyOf(t.date));
  const row = toRow({ ...t, id }, settings, fxRates);
  db.update(s.transactions)
    .set({ ...row, createdAt: existing.createdAt, updatedAt: nowIso() })
    .where(eq(s.transactions.id, id))
    .run();
}

export function deleteTransaction(db: Db, id: string) {
  const existing = db.select().from(s.transactions).where(eq(s.transactions.id, id)).get();
  if (!existing) return;
  assertOpen(db, existing.month);
  db.delete(s.transactions).where(eq(s.transactions.id, id)).run();
  // Keep reserve records consistent.
  const res = db.select().from(s.processorReserves).all();
  for (const r of res) {
    if (r.holdTransactionId === id) db.delete(s.processorReserves).where(eq(s.processorReserves.id, r.id)).run();
    else if (r.releaseTransactionId === id) db.update(s.processorReserves).set({ status: "held", releasedDate: null, releaseTransactionId: null }).where(eq(s.processorReserves.id, r.id)).run();
  }
}

export function deleteTransactionGroup(db: Db, groupId: string) {
  const rows = db.select().from(s.transactions).where(eq(s.transactions.groupId, groupId)).all();
  for (const r of rows) deleteTransaction(db, r.id);
}

// ---------------------------------------------------------------- recurring expenses

export function upsertRecurring(db: Db, r: Omit<s.NewRecurringExpense, "createdAt" | "updatedAt" | "id"> & { id?: string }) {
  const now = nowIso();
  const id = r.id ?? uid();
  const existing = db.select().from(s.recurringExpenses).where(eq(s.recurringExpenses.id, id)).get();
  if (existing) db.update(s.recurringExpenses).set({ ...r, id, updatedAt: now }).where(eq(s.recurringExpenses.id, id)).run();
  else db.insert(s.recurringExpenses).values({ ...r, id, createdAt: now, updatedAt: now }).run();
  return id;
}

export function deleteRecurring(db: Db, id: string) {
  db.delete(s.recurringExpenses).where(eq(s.recurringExpenses.id, id)).run();
}

function advanceRenewal(date: string, frequency: Frequency): string {
  const d = new Date(date + "T00:00:00Z");
  switch (frequency) {
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "quarterly":
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case "annual":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

/** Record that a subscription was charged: creates the ledger row and rolls the renewal date forward. */
export function logRenewal(db: Db, recurringId: string, date: string, settings: s.Settings, fxRates: s.FxRate[], amountOverrideMinor?: Minor) {
  const r = db.select().from(s.recurringExpenses).where(eq(s.recurringExpenses.id, recurringId)).get();
  if (!r) throw new Error("Subscription not found");
  const type: TransactionType = r.bucket === "growth" ? "growth_investment" : r.costType === "direct_delivery" ? "contractor_payment" : "expense";
  const id = addTransaction(
    db,
    {
      date,
      type,
      amountMinor: amountOverrideMinor ?? r.amountMinor,
      currency: r.currency as CurrencyCode,
      description: `${r.name} (${r.frequency} renewal)`,
      categoryId: r.categoryId,
      accountId: r.accountId,
      vendorId: r.vendorId,
      recurringExpenseId: r.id,
      costType: r.costType as "overhead" | "direct_delivery",
      bucket: r.bucket as Bucket,
      isEssential: r.isEssential,
      isRecurring: true,
    },
    settings,
    fxRates,
  );
  const base = r.nextRenewalDate && r.nextRenewalDate >= date ? r.nextRenewalDate : date;
  db.update(s.recurringExpenses).set({ nextRenewalDate: advanceRenewal(base, r.frequency as Frequency), updatedAt: nowIso() }).where(eq(s.recurringExpenses.id, r.id)).run();
  return id;
}

// ---------------------------------------------------------------- household

export function upsertHouseholdLine(db: Db, l: Omit<s.NewHouseholdBudgetLine, "id"> & { id?: string }) {
  const id = l.id ?? uid();
  const existing = db.select().from(s.householdBudgetLines).where(eq(s.householdBudgetLines.id, id)).get();
  if (existing) db.update(s.householdBudgetLines).set({ ...l, id }).where(eq(s.householdBudgetLines.id, id)).run();
  else db.insert(s.householdBudgetLines).values({ ...l, id }).run();
  return id;
}
export function deleteHouseholdLine(db: Db, id: string) {
  db.delete(s.householdBudgetLines).where(eq(s.householdBudgetLines.id, id)).run();
}

// ---------------------------------------------------------------- clients, periods, invoices

export function upsertClient(db: Db, c: Omit<s.NewClient, "createdAt" | "id"> & { id?: string }) {
  const id = c.id ?? uid();
  const existing = db.select().from(s.clients).where(eq(s.clients.id, id)).get();
  if (existing) db.update(s.clients).set({ ...c, id }).where(eq(s.clients.id, id)).run();
  else db.insert(s.clients).values({ ...c, id, createdAt: nowIso() }).run();
  return id;
}
export function deleteClient(db: Db, id: string) {
  const used = db.select().from(s.transactions).where(eq(s.transactions.clientId, id)).all();
  if (used.length > 0) throw new Error("This client has transactions. Mark it churned instead of deleting it.");
  db.delete(s.clientRevenuePeriods).where(eq(s.clientRevenuePeriods.clientId, id)).run();
  db.delete(s.invoices).where(eq(s.invoices.clientId, id)).run();
  db.delete(s.clients).where(eq(s.clients.id, id)).run();
}

export function upsertRevenuePeriod(db: Db, p: { id?: string; clientId: string; month: string; clientAttributableRevenueUsdCents: number; revenueSharePct?: string | null; retainerUsdCents?: number; fixedFeesUsdCents?: number; notes?: string | null }) {
  const client = db.select().from(s.clients).where(eq(s.clients.id, p.clientId)).get();
  if (!client) throw new Error("Client not found");
  const pct = p.revenueSharePct ?? client.revenueSharePct;
  const commission = commissionFor(p.clientAttributableRevenueUsdCents, pct);
  const now = nowIso();
  const existing = p.id ? db.select().from(s.clientRevenuePeriods).where(eq(s.clientRevenuePeriods.id, p.id)).get() : db.select().from(s.clientRevenuePeriods).all().find((x) => x.clientId === p.clientId && x.month === p.month);
  const row = {
    clientId: p.clientId,
    month: p.month,
    clientAttributableRevenueUsdCents: p.clientAttributableRevenueUsdCents,
    revenueSharePct: pct,
    commissionUsdCents: commission,
    retainerUsdCents: p.retainerUsdCents ?? client.monthlyRetainerUsdCents,
    fixedFeesUsdCents: p.fixedFeesUsdCents ?? 0,
    notes: p.notes ?? null,
  };
  if (existing) {
    db.update(s.clientRevenuePeriods).set({ ...row, updatedAt: now }).where(eq(s.clientRevenuePeriods.id, existing.id)).run();
    return existing.id;
  }
  const id = uid();
  db.insert(s.clientRevenuePeriods).values({ id, ...row, createdAt: now, updatedAt: now }).run();
  return id;
}
export function deleteRevenuePeriod(db: Db, id: string) {
  db.delete(s.clientRevenuePeriods).where(eq(s.clientRevenuePeriods.id, id)).run();
}

export function upsertInvoice(db: Db, i: Omit<s.NewInvoice, "createdAt" | "id"> & { id?: string }) {
  const id = i.id ?? uid();
  const existing = db.select().from(s.invoices).where(eq(s.invoices.id, id)).get();
  if (existing) db.update(s.invoices).set({ ...i, id }).where(eq(s.invoices.id, id)).run();
  else db.insert(s.invoices).values({ ...i, id, createdAt: nowIso() }).run();
  return id;
}
export function deleteInvoice(db: Db, id: string) {
  db.update(s.transactions).set({ invoiceId: null }).where(eq(s.transactions.invoiceId, id)).run();
  db.delete(s.invoices).where(eq(s.invoices.id, id)).run();
}

// ---------------------------------------------------------------- processors

export function updateProcessor(db: Db, id: string, patch: Partial<s.Processor>) {
  db.update(s.processors).set(patch).where(eq(s.processors.id, id)).run();
}

export interface SaleRecordInput extends SaleFeeInput {
  date: string;
  description: string;
  clientId?: string | null;
  invoiceId?: string | null;
  customerCurrency?: string;
  reserveReason?: string;
  reserveExpectedReleaseDate?: string | null;
  notes?: string | null;
}

/** Record one processor sale as a batch of ledger rows (gross, each fee, optional reserve hold). */
export function recordProcessorSale(db: Db, processorId: string, input: SaleRecordInput, settings: s.Settings, fxRates: s.FxRate[]) {
  const p = db.select().from(s.processors).where(eq(s.processors.id, processorId)).get();
  if (!p) throw new Error("Processor not found");
  if (!p.availableAccountId || !p.restrictedAccountId) throw new Error("Processor accounts are not configured");
  if (input.grossUsdCents <= 0) throw new Error("Gross amount must be positive");
  assertOpen(db, monthKeyOf(input.date));
  const fees = computeSaleFees(p, input);
  const groupId = uid();
  const common = { date: input.date, currency: "USD" as CurrencyCode, processorId, groupId, clientId: input.clientId ?? null, accountId: p.availableAccountId };
  const rows: TransactionInput[] = [
    { ...common, type: "client_payment", amountMinor: fees.gross, description: input.description, invoiceId: input.invoiceId ?? null, notes: input.customerCurrency ? `Customer currency: ${input.customerCurrency}` : (input.notes ?? null) },
  ];
  if (fees.processingFee > 0) rows.push({ ...common, type: "processing_fee", amountMinor: fees.processingFee, description: `${p.name} card processing fee${input.internationalCard ? " (international card)" : ""}` });
  if (fees.conversionFee > 0) rows.push({ ...common, type: "conversion_fee", amountMinor: fees.conversionFee, description: `${p.name} currency conversion fee` });
  if (fees.platformFee > 0) rows.push({ ...common, type: "platform_fee", amountMinor: fees.platformFee, description: `${p.name} platform fee` });
  const ids = addTransactions(db, rows, settings, fxRates);
  if (fees.reserveHold > 0) {
    const holdId = addTransaction(
      db,
      { ...common, type: "reserve_hold", amountMinor: fees.reserveHold, description: `${p.name} reserve hold`, toAccountId: p.restrictedAccountId },
      settings,
      fxRates,
    );
    db.insert(s.processorReserves)
      .values({
        id: uid(),
        processorId,
        amountUsdCents: fees.reserveHold,
        dateWithheld: input.date,
        expectedReleaseDate: input.reserveExpectedReleaseDate ?? null,
        status: "held",
        reason: input.reserveReason ?? "Processor reserve",
        holdTransactionId: holdId,
        createdAt: nowIso(),
      })
      .run();
    ids.push(holdId);
  }
  return { groupId, ids, fees };
}

export function recordManualReserve(db: Db, processorId: string, input: { amountUsdCents: Minor; dateWithheld: string; expectedReleaseDate?: string | null; reason?: string; notes?: string | null }, settings: s.Settings, fxRates: s.FxRate[]) {
  const p = db.select().from(s.processors).where(eq(s.processors.id, processorId)).get();
  if (!p?.availableAccountId || !p.restrictedAccountId) throw new Error("Processor accounts are not configured");
  if (input.amountUsdCents <= 0) throw new Error("Amount must be positive");
  const holdId = addTransaction(
    db,
    { date: input.dateWithheld, type: "reserve_hold", amountMinor: input.amountUsdCents, currency: "USD", description: `${p.name} reserve hold${input.reason ? `: ${input.reason}` : ""}`, processorId, accountId: p.availableAccountId, toAccountId: p.restrictedAccountId },
    settings,
    fxRates,
  );
  const id = uid();
  db.insert(s.processorReserves)
    .values({ id, processorId, amountUsdCents: input.amountUsdCents, dateWithheld: input.dateWithheld, expectedReleaseDate: input.expectedReleaseDate ?? null, status: "held", reason: input.reason ?? null, holdTransactionId: holdId, notes: input.notes ?? null, createdAt: nowIso() })
    .run();
  return id;
}

export function updateReserve(db: Db, id: string, patch: Partial<s.ProcessorReserve>) {
  db.update(s.processorReserves).set(patch).where(eq(s.processorReserves.id, id)).run();
}

export function releaseReserve(db: Db, reserveId: string, date: string, settings: s.Settings, fxRates: s.FxRate[], status: "released" | "forfeited" = "released") {
  const r = db.select().from(s.processorReserves).where(eq(s.processorReserves.id, reserveId)).get();
  if (!r) throw new Error("Reserve not found");
  if (r.status !== "held") throw new Error("Reserve is not held");
  const p = db.select().from(s.processors).where(eq(s.processors.id, r.processorId)).get();
  if (!p?.availableAccountId || !p.restrictedAccountId) throw new Error("Processor accounts are not configured");
  let txId: string | null = null;
  if (status === "released") {
    txId = addTransaction(db, { date, type: "reserve_release", amountMinor: r.amountUsdCents, currency: "USD", description: `${p.name} reserve released`, processorId: p.id, accountId: p.restrictedAccountId, toAccountId: p.availableAccountId }, settings, fxRates);
  } else {
    // Forfeited: the processor kept the money (e.g. a lost dispute). Record as chargeback from restricted balance.
    txId = addTransaction(db, { date, type: "chargeback", amountMinor: r.amountUsdCents, currency: "USD", description: `${p.name} reserve forfeited`, processorId: p.id, accountId: p.restrictedAccountId }, settings, fxRates);
  }
  db.update(s.processorReserves).set({ status, releasedDate: date, releaseTransactionId: txId }).where(eq(s.processorReserves.id, reserveId)).run();
}

export function recordPayout(db: Db, processorId: string, input: { date: string; amountUsdCents: Minor; toAccountId: string; method: PayoutMethod; feeOverrideCents?: Minor | null; description?: string }, settings: s.Settings, fxRates: s.FxRate[]) {
  const p = db.select().from(s.processors).where(eq(s.processors.id, processorId)).get();
  if (!p?.availableAccountId) throw new Error("Processor accounts are not configured");
  if (input.amountUsdCents <= 0) throw new Error("Amount must be positive");
  const fee = input.feeOverrideCents ?? computePayoutFee(p, input.amountUsdCents, input.method);
  const groupId = uid();
  const rows: TransactionInput[] = [{ date: input.date, type: "payout", amountMinor: input.amountUsdCents, currency: "USD", description: input.description ?? `${p.name} payout (${input.method})`, processorId, accountId: p.availableAccountId, toAccountId: input.toAccountId, groupId }];
  if (fee > 0) rows.push({ date: input.date, type: "payout_fee", amountMinor: fee, currency: "USD", description: `${p.name} payout fee (${input.method})`, processorId, accountId: p.availableAccountId, groupId });
  return addTransactions(db, rows, settings, fxRates);
}

// ---------------------------------------------------------------- fx

export function upsertFxRate(db: Db, r: { id?: string; date: string; currency: string; ratePerUsd: string; source?: string | null }) {
  const id = r.id ?? uid();
  const existing = db.select().from(s.fxRates).where(eq(s.fxRates.id, id)).get();
  if (existing) db.update(s.fxRates).set({ ...r, id }).where(eq(s.fxRates.id, id)).run();
  else db.insert(s.fxRates).values({ ...r, id, source: r.source ?? null, createdAt: nowIso() }).run();
  return id;
}
export function deleteFxRate(db: Db, id: string) {
  db.delete(s.fxRates).where(eq(s.fxRates.id, id)).run();
}

// ---------------------------------------------------------------- envelopes & month close

export function addAllocationEntry(db: Db, e: { month: string; bucket: Bucket; amountUsdCents: Minor; source: string; note?: string | null }) {
  db.insert(s.allocationEntries).values({ id: uid(), ...e, note: e.note ?? null, createdAt: nowIso() }).run();
}

/** Explicitly move money between virtual envelopes (e.g. unspent operating allowance -> reserve). */
export function reassignEnvelope(db: Db, month: string, from: Bucket, to: Bucket, amountUsdCents: Minor, note: string) {
  if (amountUsdCents <= 0) throw new Error("Amount must be positive");
  if (from === to) throw new Error("Choose two different envelopes");
  addAllocationEntry(db, { month, bucket: from, amountUsdCents: -amountUsdCents, source: "reassign", note });
  addAllocationEntry(db, { month, bucket: to, amountUsdCents, source: "reassign", note });
}

export function closeMonth(db: Db, month: string, allocations: Record<Bucket, Minor>, reportJson: string, checklistJson: string, disposition: { amount: Minor; to: "operating" | "reserve" | "profit" } | null, notes?: string) {
  const existing = db.select().from(s.monthCloses).where(eq(s.monthCloses.month, month)).get();
  if (existing && existing.status === "closed") throw new Error(`${month} is already closed`);
  // Remove any previous month_close entries for this month (re-close after reopen).
  const prev = db.select().from(s.allocationEntries).all().filter((e) => e.month === month && (e.source === "month_close" || e.source === "month_close_reassign"));
  for (const e of prev) db.delete(s.allocationEntries).where(eq(s.allocationEntries.id, e.id)).run();
  for (const b of Object.keys(allocations) as Bucket[]) {
    if (allocations[b] !== 0) addAllocationEntry(db, { month, bucket: b, amountUsdCents: allocations[b], source: "month_close", note: `Allocation booked at month close` });
  }
  if (disposition && disposition.amount > 0 && disposition.to !== "operating") {
    addAllocationEntry(db, { month, bucket: "opex", amountUsdCents: -disposition.amount, source: "month_close_reassign", note: `Unspent operating allowance moved to ${disposition.to}` });
    addAllocationEntry(db, { month, bucket: disposition.to, amountUsdCents: disposition.amount, source: "month_close_reassign", note: `Unspent operating allowance from ${month}` });
  }
  const now = nowIso();
  if (existing) db.update(s.monthCloses).set({ status: "closed", closedAt: now, reopenedAt: null, reportJson, checklistJson, notes: notes ?? null }).where(eq(s.monthCloses.id, existing.id)).run();
  else db.insert(s.monthCloses).values({ id: uid(), month, status: "closed", closedAt: now, reportJson, checklistJson, notes: notes ?? null }).run();
}

export function reopenMonth(db: Db, month: string) {
  const existing = db.select().from(s.monthCloses).where(eq(s.monthCloses.month, month)).get();
  if (!existing) throw new Error("Month is not closed");
  db.update(s.monthCloses).set({ status: "reopened", reopenedAt: nowIso() }).where(eq(s.monthCloses.id, existing.id)).run();
  // Booked allocations are withdrawn until the month is closed again.
  const entries = db.select().from(s.allocationEntries).all().filter((e) => e.month === month && (e.source === "month_close" || e.source === "month_close_reassign"));
  for (const e of entries) db.delete(s.allocationEntries).where(eq(s.allocationEntries.id, e.id)).run();
}

// ---------------------------------------------------------------- tax & compliance

export function upsertTaxProfile(db: Db, t: Omit<s.TaxProfile, "createdAt" | "id"> & { id?: string }) {
  const id = t.id ?? uid();
  const existing = db.select().from(s.taxProfiles).where(eq(s.taxProfiles.id, id)).get();
  if (existing) db.update(s.taxProfiles).set({ ...t, id }).where(eq(s.taxProfiles.id, id)).run();
  else db.insert(s.taxProfiles).values({ ...t, id, createdAt: nowIso() }).run();
  return id;
}
export function deleteTaxProfile(db: Db, id: string) {
  db.delete(s.taxProfiles).where(eq(s.taxProfiles.id, id)).run();
}
export function upsertComplianceItem(db: Db, c: Omit<s.NewComplianceItem, "id"> & { id?: string }) {
  const id = c.id ?? uid();
  const existing = db.select().from(s.complianceItems).where(eq(s.complianceItems.id, id)).get();
  if (existing) db.update(s.complianceItems).set({ ...c, id }).where(eq(s.complianceItems.id, id)).run();
  else db.insert(s.complianceItems).values({ ...c, id }).run();
  return id;
}
export function deleteComplianceItem(db: Db, id: string) {
  db.delete(s.complianceItems).where(eq(s.complianceItems.id, id)).run();
}

// ---------------------------------------------------------------- growth proposals

export function upsertGrowthProposal(db: Db, g: Omit<s.NewGrowthProposal, "createdAt" | "id"> & { id?: string }) {
  const id = g.id ?? uid();
  const existing = db.select().from(s.growthProposals).where(eq(s.growthProposals.id, id)).get();
  if (existing) db.update(s.growthProposals).set({ ...g, id }).where(eq(s.growthProposals.id, id)).run();
  else db.insert(s.growthProposals).values({ ...g, id, createdAt: nowIso() }).run();
  return id;
}
export function deleteGrowthProposal(db: Db, id: string) {
  db.delete(s.growthProposals).where(eq(s.growthProposals.id, id)).run();
}

// ---------------------------------------------------------------- vendors, categories, entities

export function upsertVendor(db: Db, v: { id?: string; name: string; website?: string | null; notes?: string | null }) {
  const id = v.id ?? uid();
  const existing = db.select().from(s.vendors).where(eq(s.vendors.id, id)).get();
  if (existing) db.update(s.vendors).set({ ...v, id }).where(eq(s.vendors.id, id)).run();
  else db.insert(s.vendors).values({ id, name: v.name, website: v.website ?? null, notes: v.notes ?? null, createdAt: nowIso() }).run();
  return id;
}
export function deleteVendor(db: Db, id: string) {
  db.update(s.transactions).set({ vendorId: null }).where(eq(s.transactions.vendorId, id)).run();
  db.update(s.recurringExpenses).set({ vendorId: null }).where(eq(s.recurringExpenses.vendorId, id)).run();
  db.delete(s.vendors).where(eq(s.vendors.id, id)).run();
}
export function upsertCategory(db: Db, c: { id?: string; name: string; scope: "business" | "personal"; isEssentialDefault?: boolean; sortOrder?: number }) {
  const id = c.id ?? uid();
  const existing = db.select().from(s.categories).where(eq(s.categories.id, id)).get();
  if (existing) db.update(s.categories).set({ name: c.name, isEssentialDefault: c.isEssentialDefault ?? existing.isEssentialDefault }).where(eq(s.categories.id, id)).run();
  else db.insert(s.categories).values({ id, name: c.name, scope: c.scope, isEssentialDefault: c.isEssentialDefault ?? false, sortOrder: c.sortOrder ?? 99, isSystem: false }).run();
  return id;
}
export function deleteCategory(db: Db, id: string) {
  db.update(s.transactions).set({ categoryId: null }).where(eq(s.transactions.categoryId, id)).run();
  db.update(s.recurringExpenses).set({ categoryId: null }).where(eq(s.recurringExpenses.categoryId, id)).run();
  db.delete(s.categories).where(eq(s.categories.id, id)).run();
}
export function upsertEntity(db: Db, e: Omit<s.Entity, "createdAt" | "id"> & { id?: string }) {
  const id = e.id ?? uid();
  const existing = db.select().from(s.entities).where(eq(s.entities.id, id)).get();
  if (existing) db.update(s.entities).set({ ...e, id }).where(eq(s.entities.id, id)).run();
  else db.insert(s.entities).values({ ...e, id, createdAt: nowIso() }).run();
  return id;
}

// ---------------------------------------------------------------- alerts

export function snoozeAlert(db: Db, key: string, until: string) {
  const existing = db.select().from(s.alertSnoozes).where(eq(s.alertSnoozes.alertKey, key)).get();
  if (existing) db.update(s.alertSnoozes).set({ snoozedUntil: until }).where(eq(s.alertSnoozes.alertKey, key)).run();
  else db.insert(s.alertSnoozes).values({ alertKey: key, snoozedUntil: until }).run();
}
export function clearSnoozes(db: Db) {
  db.delete(s.alertSnoozes).run();
}

export const nextMonth = (m: string) => addMonths(m, 1);
export const monthOf = mk;
