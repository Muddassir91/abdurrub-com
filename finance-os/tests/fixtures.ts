import type * as s from "@/db/schema";
import type { EngineData } from "@/engine/types";
import { IDS, categoryId } from "@/db/seed";
import { monthKeyOf } from "@/lib/dates";
import { convertToUsdCents, type CurrencyCode } from "@/lib/money";

const now = "2026-11-01T00:00:00.000Z";
export const MONTH = "2026-11";
export const TODAY = "2026-11-15";

export function baseSettings(overrides: Partial<s.Settings> = {}): s.Settings {
  return {
    id: 1,
    businessName: "Retention Rules",
    ownerName: "Owner",
    baseCurrency: "USD",
    householdCurrency: "PKR",
    defaultFxRatePkrPerUsd: "280",
    householdBudgetUsdCents: 100000,
    discretionaryGoalUsdCents: 500000,
    targetGrossMarginMinPct: "65",
    targetGrossMarginMaxPct: "75",
    reserveTargetMonths: "3",
    reserveMinMonths: "3",
    reserveMaxMonths: "6",
    concentrationWarnPct: "50",
    concentrationCriticalPct: "75",
    opexCeilingOverrideUsdCents: null,
    opexCeilingOverrideNote: null,
    opexCeilingOverrideApprovedAt: null,
    renewalReminderDays: 7,
    invoiceOverdueGraceDays: 0,
    pinnedPolicyId: null,
    theme: "system",
    secondaryCurrencyDisplay: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function leanPolicy(overrides: Partial<s.AllocationPolicy> = {}): s.AllocationPolicy {
  return {
    id: IDS.policyLean,
    name: "Lean",
    description: null,
    appliesFromMonthlyRevenueUsdCents: 0,
    opexPct: "25",
    ownerPct: "35",
    taxPct: "15",
    profitPct: "10",
    reservePct: "10",
    growthPct: "5",
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function account(id: string, role: string, isBusiness = true, kind = "bank", extra: Partial<s.Account> = {}): s.Account {
  return { id, name: id, role, kind, currency: "USD", openingBalanceMinor: 0, openingBalanceDate: "2020-01-01", entityId: null, processorId: null, institution: null, isBusiness, isArchived: false, sortOrder: 0, notes: null, createdAt: now, ...extra };
}

export function standardAccounts(): s.Account[] {
  return [
    account(IDS.acctOperating, "operating"),
    account(IDS.acctTax, "tax"),
    account(IDS.acctProfit, "profit"),
    account(IDS.acctSavings, "savings"),
    account(IDS.acctGrowth, "growth"),
    account(IDS.acctPersonal, "personal", false),
    account(IDS.acctWhopAvailable, "processor_available", true, "processor", { processorId: IDS.processorWhop }),
    account(IDS.acctWhopRestricted, "processor_restricted", true, "processor", { processorId: IDS.processorWhop }),
  ];
}

let counter = 0;
export function tx(partial: Partial<s.Transaction> & { type: string; amountUsdCents?: number; date?: string }): s.Transaction {
  counter += 1;
  const date = partial.date ?? `${MONTH}-10`;
  const currency = (partial.currency ?? "USD") as CurrencyCode;
  const fx = partial.fxRatePerUsd ?? (currency === "USD" ? "1" : "280");
  const amountMinor = partial.amountMinor ?? partial.amountUsdCents ?? 0;
  const amountUsdCents = partial.amountUsdCents ?? convertToUsdCents(amountMinor, currency, fx);
  return {
    id: partial.id ?? `tx-${counter}`,
    date,
    month: monthKeyOf(date),
    type: partial.type,
    amountMinor,
    currency,
    fxRatePerUsd: fx,
    amountUsdCents,
    description: partial.description ?? partial.type,
    categoryId: partial.categoryId ?? null,
    accountId: partial.accountId ?? null,
    toAccountId: partial.toAccountId ?? null,
    clientId: partial.clientId ?? null,
    invoiceId: partial.invoiceId ?? null,
    processorId: partial.processorId ?? null,
    vendorId: partial.vendorId ?? null,
    recurringExpenseId: partial.recurringExpenseId ?? null,
    groupId: partial.groupId ?? null,
    costType: partial.costType ?? null,
    bucket: partial.bucket ?? null,
    isEssential: partial.isEssential ?? false,
    isRecurring: partial.isRecurring ?? false,
    notes: partial.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function client(overrides: Partial<s.Client> = {}): s.Client {
  return { id: IDS.clientOne, name: "Client 1", agreementType: "revenue_share", startDate: "2026-01-01", endDate: null, revenueSharePct: "20", monthlyRetainerUsdCents: 0, fixedFeeUsdCents: 0, status: "active", entityId: null, paymentTermsDays: 7, notes: null, createdAt: now, ...overrides };
}

export function processor(overrides: Partial<s.Processor> = {}): s.Processor {
  return {
    id: IDS.processorWhop,
    name: "Whop",
    availableAccountId: IDS.acctWhopAvailable,
    restrictedAccountId: IDS.acctWhopRestricted,
    domesticCardPct: "2.7",
    domesticCardFixedCents: 30,
    intlCardSurchargePct: "1.5",
    conversionPct: "1",
    platformFeePct: "3",
    platformFeeAppliesByDefault: true,
    achPayoutFeeCents: 250,
    wirePayoutFeeCents: 2500,
    intlTransferFeeCents: 2500,
    intlTransferPct: "1",
    instantPayoutPct: "4",
    instantPayoutFixedCents: 100,
    defaultReservePct: "0",
    pricingSource: null,
    pricingVerifiedAt: null,
    notes: null,
    createdAt: now,
    ...overrides,
  };
}

export function data(overrides: Partial<EngineData> = {}): EngineData {
  return {
    settings: baseSettings(),
    policies: [leanPolicy()],
    entities: [],
    accounts: standardAccounts(),
    categories: [
      { id: categoryId("business", "Software and AI"), name: "Software and AI", scope: "business", isEssentialDefault: true, sortOrder: 0, isSystem: true },
      { id: categoryId("personal", "Food"), name: "Food", scope: "personal", isEssentialDefault: true, sortOrder: 0, isSystem: true },
    ],
    vendors: [],
    clients: [client()],
    revenuePeriods: [],
    invoices: [],
    transactions: [],
    recurringExpenses: [],
    householdLines: [],
    processors: [processor()],
    reserves: [],
    fxRates: [],
    allocationEntries: [],
    monthCloses: [],
    taxProfiles: [],
    complianceItems: [],
    growthProposals: [],
    snoozes: [],
    ...overrides,
  };
}

/** A collected client payment landing in the operating account. */
export function payment(usdCents: number, extra: Partial<s.Transaction> = {}) {
  return tx({ type: "client_payment", amountUsdCents: usdCents, accountId: IDS.acctOperating, clientId: IDS.clientOne, ...extra });
}
