import type { Account, AllocationEntry, Settings, Transaction } from "@/db/schema";
import {
  BUCKETS,
  REVENUE_TYPES,
  REVENUE_REVERSAL_TYPES,
  COLLECTION_FEE_TYPES,
  BUSINESS_SPEND_TYPES,
  PERSONAL_SPEND_TYPES,
  TWO_SIDED_TYPES,
  type Bucket,
  type TransactionType,
} from "@/lib/constants";
import { convertFromUsdCents, convertToUsdCents, type CurrencyCode, type Minor } from "@/lib/money";
import type { Allocations } from "./types";

export const isRevenue = (t: Transaction) => REVENUE_TYPES.includes(t.type as TransactionType);
export const isReversal = (t: Transaction) => REVENUE_REVERSAL_TYPES.includes(t.type as TransactionType);
export const isCollectionFee = (t: Transaction) => COLLECTION_FEE_TYPES.includes(t.type as TransactionType);
export const isBusinessSpend = (t: Transaction) => BUSINESS_SPEND_TYPES.includes(t.type as TransactionType);
export const isPersonalSpend = (t: Transaction) => PERSONAL_SPEND_TYPES.includes(t.type as TransactionType);
export const isTwoSided = (t: Transaction) => TWO_SIDED_TYPES.includes(t.type as TransactionType);

/** Types that take money OUT of `accountId` (single-sided outflows). */
export const OUTFLOW_TYPES: TransactionType[] = [
  "expense",
  "contractor_payment",
  "employee_payment",
  "growth_investment",
  "household_expense",
  "personal_expense",
  "refund",
  "chargeback",
  "processing_fee",
  "conversion_fee",
  "payout_fee",
  "platform_fee",
  "tax_payment",
];

export function inMonth(t: { month: string }, month: string) {
  return t.month === month;
}

export function sumUsd(rows: Transaction[]): Minor {
  return rows.reduce((acc, t) => acc + t.amountUsdCents, 0);
}

/** Amount of a transaction expressed in the given account's currency. */
const isBase = (currency: string, settings: Settings) => currency === "USD" || currency === settings.baseCurrency;

export function amountInAccountCurrency(t: Transaction, account: Account, settings: Settings): Minor {
  if (t.currency === account.currency) return t.amountMinor;
  if (isBase(account.currency, settings)) return t.amountUsdCents;
  const rate = isBase(t.currency, settings) ? settings.defaultFxRatePkrPerUsd : t.fxRatePerUsd;
  return convertFromUsdCents(t.amountUsdCents, account.currency as CurrencyCode, rate);
}

/** Real balance of an account derived from its opening balance and the ledger. */
export function accountBalance(account: Account, transactions: Transaction[], settings: Settings, upToDate?: string): Minor {
  let bal = account.openingBalanceMinor;
  for (const t of transactions) {
    if (upToDate && t.date > upToDate) continue;
    if (t.date < account.openingBalanceDate) continue;
    const amt = amountInAccountCurrency(t, account, settings);
    const type = t.type as TransactionType;
    if (type === "balance_adjustment") {
      if (t.accountId === account.id) bal += amt; // signed
      continue;
    }
    if (isTwoSided(t)) {
      if (t.accountId === account.id) bal -= amt;
      if (t.toAccountId === account.id) bal += amt;
      continue;
    }
    if (REVENUE_TYPES.includes(type)) {
      if (t.accountId === account.id) bal += amt;
      continue;
    }
    if (OUTFLOW_TYPES.includes(type)) {
      if (t.accountId === account.id) bal -= amt;
    }
  }
  return bal;
}

/** Account balance converted to USD cents. */
export function accountBalanceUsd(account: Account, transactions: Transaction[], settings: Settings, upToDate?: string): Minor {
  const bal = accountBalance(account, transactions, settings, upToDate);
  if (isBase(account.currency, settings)) return bal;
  const rate = Number(settings.defaultFxRatePkrPerUsd) > 0 ? settings.defaultFxRatePkrPerUsd : "1";
  return convertToUsdCents(bal, account.currency as CurrencyCode, rate);
}

/** Which virtual envelope a ledger row draws from. Explicit bucket wins; otherwise inferred from the type. */
export function effectiveBucket(t: Transaction): Bucket | null {
  if (t.bucket && (BUCKETS as readonly string[]).includes(t.bucket)) return t.bucket as Bucket;
  // Direct delivery costs sit above the line (gross margin), not inside the
  // operating-overhead envelope, unless a bucket is set explicitly.
  if (t.costType === "direct_delivery") return null;
  switch (t.type as TransactionType) {
    case "expense":
    case "contractor_payment":
    case "employee_payment":
      return "opex";
    case "growth_investment":
      return "growth";
    case "owner_draw":
      return "owner";
    case "profit_distribution":
      return "profit";
    case "tax_payment":
      return "tax";
    default:
      return null;
  }
}

/** Actual spend / draws per bucket for a month (USD). Only business-side rows count; personal spending is never a bucket debit. */
export function actualByBucket(transactions: Transaction[], month: string): Allocations {
  const out: Allocations = { opex: 0, owner: 0, tax: 0, profit: 0, reserve: 0, growth: 0 };
  for (const t of transactions) {
    if (t.month !== month) continue;
    if (isPersonalSpend(t)) continue;
    const b = effectiveBucket(t);
    if (!b) continue;
    out[b] += t.amountUsdCents;
  }
  return out;
}

/** Envelope ledger: credits from allocation entries, debits from spend rows (all months up to and including `uptoMonth`). */
export function envelopeBalances(entries: AllocationEntry[], transactions: Transaction[], uptoMonth?: string): Record<Bucket, { credits: Minor; debits: Minor; balance: Minor }> {
  const out = {} as Record<Bucket, { credits: Minor; debits: Minor; balance: Minor }>;
  for (const b of BUCKETS) out[b] = { credits: 0, debits: 0, balance: 0 };
  for (const e of entries) {
    if (uptoMonth && e.month > uptoMonth) continue;
    const b = e.bucket as Bucket;
    if (!out[b]) continue;
    if (e.amountUsdCents >= 0) out[b].credits += e.amountUsdCents;
    else out[b].debits += -e.amountUsdCents;
  }
  for (const t of transactions) {
    if (uptoMonth && t.month > uptoMonth) continue;
    if (isPersonalSpend(t)) continue;
    const b = effectiveBucket(t);
    if (!b) continue;
    out[b].debits += t.amountUsdCents;
  }
  for (const b of BUCKETS) out[b].balance = out[b].credits - out[b].debits;
  return out;
}
