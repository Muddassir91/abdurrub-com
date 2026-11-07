import type { Db } from "./client";
import * as s from "./schema";
import { BUSINESS_CATEGORY_NAMES, PERSONAL_CATEGORY_NAMES } from "@/lib/constants";
import { addMonths, currentMonthKey, todayKey } from "@/lib/dates";
import { uid, nowIso } from "@/lib/ids";

/** Well-known ids so the UI and engine can address system rows without lookups. */
export const IDS = {
  policyLean: "policy-lean-solo",
  entityPk: "entity-pk-individual",
  entityLlc: "entity-abdullah-llc",
  acctOperating: "acct-operating",
  acctTax: "acct-tax",
  acctProfit: "acct-profit",
  acctSavings: "acct-savings",
  acctGrowth: "acct-growth",
  acctPersonal: "acct-personal",
  acctWhopAvailable: "acct-whop-available",
  acctWhopRestricted: "acct-whop-restricted",
  processorWhop: "processor-whop",
  clientOne: "client-shopify-revshare",
} as const;

export function categoryId(scope: "business" | "personal", name: string) {
  return `cat-${scope}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/**
 * Seeds the database with the owner's actual starting position.
 * Idempotent: it only runs when the settings row is missing.
 */
export function seedDatabase(db: Db): boolean {
  const existing = db.select().from(s.settings).all();
  if (existing.length > 0) return false;
  const now = nowIso();
  const today = todayKey();
  const month = currentMonthKey();

  db.insert(s.settings)
    .values({
      id: 1,
      businessName: "Retention Rules",
      ownerName: "Muddassir Abdur Rub",
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
      renewalReminderDays: 7,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  db.insert(s.fxRates).values({ id: uid(), date: today, currency: "PKR", ratePerUsd: "280", source: "Initial planning rate. Update with the rate you actually receive.", createdAt: now }).run();

  db.insert(s.allocationPolicies)
    .values({
      id: IDS.policyLean,
      name: "Lean solo operation",
      description: "Initial Profit First targets for a solo agency. Operating % is a ceiling, not a spending target.",
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
    })
    .run();

  db.insert(s.entities)
    .values([
      { id: IDS.entityPk, name: "Individual business registration (Pakistan)", type: "pk_individual", jurisdiction: "Pakistan", notes: "Marketing services. Owner resident in Pakistan.", createdAt: now },
      { id: IDS.entityLlc, name: "Abdullah LLC", type: "us_llc", jurisdiction: "Wyoming, United States", notes: "Single-member LLC, one non-US-resident owner. Does not remove Pakistani tax obligations.", createdAt: now },
    ])
    .run();

  db.insert(s.processors)
    .values({
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
      pricingSource: "Defaults based on Whop's published pricing as commonly reported (2.7% + $0.30 domestic cards, +1.5% international, +1% currency conversion, 3% platform fee, $2.50 ACH payout). Wire and international transfer fees are placeholders. Verify at docs.whop.com/fees and adjust.",
      notes: "Never assume every payment incurs the same fee. Each recorded sale carries its own fee lines.",
      createdAt: now,
    })
    .run();

  const acct = (id: string, name: string, role: string, kind: string, isBusiness: boolean, sortOrder: number, extra: Partial<s.NewAccount> = {}) => ({
    id,
    name,
    role,
    kind,
    currency: "USD",
    openingBalanceMinor: 0,
    openingBalanceDate: today,
    isBusiness,
    isArchived: false,
    sortOrder,
    createdAt: now,
    ...extra,
  });
  db.insert(s.accounts)
    .values([
      acct(IDS.acctOperating, "Business operating account", "operating", "bank", true, 1, { entityId: IDS.entityLlc }),
      acct(IDS.acctTax, "Tax reserve account", "tax", "bank", true, 2),
      acct(IDS.acctProfit, "Business profit account", "profit", "bank", true, 3),
      acct(IDS.acctSavings, "Business savings account", "savings", "bank", true, 4),
      acct(IDS.acctGrowth, "Growth account", "growth", "bank", true, 5),
      acct(IDS.acctPersonal, "Personal account", "personal", "bank", false, 6),
      acct(IDS.acctWhopAvailable, "Whop available balance", "processor_available", "processor", true, 7, { processorId: IDS.processorWhop }),
      acct(IDS.acctWhopRestricted, "Whop restricted balance", "processor_restricted", "processor", true, 8, { processorId: IDS.processorWhop }),
    ])
    .run();

  const essentialBusiness = new Set(["Software and AI", "Communication", "Administrative", "Operations"]);
  db.insert(s.categories)
    .values([
      ...BUSINESS_CATEGORY_NAMES.map((name, i) => ({ id: categoryId("business", name), name, scope: "business", isEssentialDefault: essentialBusiness.has(name), sortOrder: i, isSystem: true })),
      ...PERSONAL_CATEGORY_NAMES.map((name, i) => ({ id: categoryId("personal", name), name, scope: "personal", isEssentialDefault: ["Family support", "Food", "Utilities", "Internet"].includes(name), sortOrder: i, isSystem: true })),
    ])
    .run();

  const vendorRows = [
    { id: "vendor-listkit", name: "ListKit", website: "https://listkit.io" },
    { id: "vendor-anthropic", name: "Anthropic (Claude)", website: "https://claude.ai" },
    { id: "vendor-loom", name: "Loom", website: "https://loom.com" },
    { id: "vendor-kit", name: "Kit", website: "https://kit.com" },
    { id: "vendor-linkedin", name: "LinkedIn", website: "https://linkedin.com" },
    { id: "vendor-google", name: "Google", website: "https://workspace.google.com" },
    { id: "vendor-upwork", name: "Upwork", website: "https://upwork.com" },
    { id: "vendor-whop", name: "Whop", website: "https://whop.com" },
  ];
  db.insert(s.vendors).values(vendorRows.map((v) => ({ ...v, createdAt: now }))).run();

  const nextRenewal = `${addMonths(month, 1)}-01`;
  const sub = (id: string, name: string, vendorId: string, usd: number, category: string, status: string, isEssential: boolean, justification: string, extra: Partial<s.NewRecurringExpense> = {}) => ({
    id,
    name,
    vendorId,
    amountMinor: usd * 100,
    currency: "USD",
    frequency: "monthly",
    categoryId: categoryId("business", category),
    costType: "overhead",
    bucket: "opex",
    accountId: IDS.acctOperating,
    startDate: `${month}-01`,
    nextRenewalDate: nextRenewal,
    status,
    isEssential,
    justification,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  db.insert(s.recurringExpenses)
    .values([
      sub("sub-listkit", "ListKit", "vendor-listkit", 600, "Lead generation", "active", false, "Outbound lead data and sending infrastructure for new client acquisition."),
      sub("sub-claude", "Claude", "vendor-anthropic", 100, "Software and AI", "active", true, "AI assistant for strategy, copy, analysis and this finance system."),
      sub("sub-loom", "Loom", "vendor-loom", 24, "Communication", "active", false, "Async video for client communication and sales."),
      sub("sub-kit", "Kit", "vendor-kit", 39, "Marketing", "active", false, "Email marketing platform."),
      sub("sub-linkedin", "LinkedIn Sales Navigator", "vendor-linkedin", 68, "Sales tools", "active", false, "Prospecting and outbound research."),
      sub("sub-google-workspace", "Google Workspace", "vendor-google", 0, "Administrative", "needs_config", true, "Business email and documents. Amount to be configured.", { notes: "Set the actual plan price." }),
      sub("sub-upwork", "Upwork membership", "vendor-upwork", 0, "Lead generation", "proposed", false, "Optional acquisition channel. Evaluate under Growth before activating.", { bucket: "growth" }),
    ])
    .run();

  db.insert(s.householdBudgetLines)
    .values([
      { id: "hh-food", name: "Food and water", categoryId: categoryId("personal", "Food"), amountMinor: 50000 * 100, currency: "PKR", isActive: true, sortOrder: 1 },
      { id: "hh-brother", name: "Brother", categoryId: categoryId("personal", "Family support"), amountMinor: 50000 * 100, currency: "PKR", isActive: true, sortOrder: 2 },
      { id: "hh-parents", name: "Parents", categoryId: categoryId("personal", "Family support"), amountMinor: 50000 * 100, currency: "PKR", isActive: true, sortOrder: 3 },
      { id: "hh-internet", name: "Internet", categoryId: categoryId("personal", "Internet"), amountMinor: 15000 * 100, currency: "PKR", isActive: true, sortOrder: 4 },
      { id: "hh-electricity", name: "Electricity", categoryId: categoryId("personal", "Utilities"), amountMinor: 30000 * 100, currency: "PKR", isActive: true, sortOrder: 5, notes: "Budgeted with a cushion." },
      { id: "hh-streaming", name: "Streaming subscriptions", categoryId: categoryId("personal", "Streaming"), amountMinor: 0, currency: "PKR", isActive: true, sortOrder: 6, notes: "Configurable." },
      { id: "hh-other", name: "Other household costs", categoryId: categoryId("personal", "Other"), amountMinor: 0, currency: "PKR", isActive: true, sortOrder: 7, notes: "Configurable." },
    ])
    .run();

  db.insert(s.clients)
    .values({
      id: IDS.clientOne,
      name: "Client 1 (Shopify store)",
      agreementType: "revenue_share",
      startDate: `${month}-01`,
      revenueSharePct: "20",
      monthlyRetainerUsdCents: 0,
      fixedFeeUsdCents: 0,
      status: "active",
      entityId: IDS.entityLlc,
      paymentTermsDays: 7,
      notes: "I manage the store's marketing and receive 20% of Shopify store revenue. Only the commission is agency revenue; the store's revenue is the client's.",
      createdAt: now,
    })
    .run();

  db.insert(s.taxProfiles)
    .values([
      { id: "tax-pk-business", name: "Pakistani individual business registration", jurisdiction: "Pakistan", entityId: IDS.entityPk, scope: "business", assumedRatePct: null, isEstimate: true, filingFrequency: "annual", notes: "Business income taxed in Pakistan. Rate depends on slab and status; confirm with a tax professional.", createdAt: now },
      { id: "tax-us-llc", name: "Wyoming single-member LLC (Abdullah LLC)", jurisdiction: "United States / Wyoming", entityId: IDS.entityLlc, scope: "business", assumedRatePct: null, isEstimate: true, filingFrequency: "annual", notes: "Disregarded entity with a foreign owner: Form 5472 + pro forma 1120 informational filing typically applies. US income tax exposure depends on effectively connected income analysis. Not tax-free by default.", createdAt: now },
      { id: "tax-owner-personal", name: "Owner personal tax obligations", jurisdiction: "Pakistan", entityId: null, scope: "personal", assumedRatePct: null, isEstimate: true, filingFrequency: "annual", notes: "Owner draws and distributions may be taxable in Pakistan as personal income. Confirm treatment.", createdAt: now },
    ])
    .run();

  const year = Number(month.slice(0, 4));
  const nextYear = year + 1;
  db.insert(s.complianceItems)
    .values([
      { id: "comp-ein", title: "US EIN", jurisdiction: "United States", description: "Employer Identification Number for Abdullah LLC. Required for 5472/1120 filings and US banking/processors.", frequency: "once", status: "pending", applicable: true, valueLabel: "EIN", sortOrder: 1 },
      { id: "comp-5472", title: "Form 5472 applicability", jurisdiction: "United States", description: "Foreign-owned single-member LLCs generally must file Form 5472 with a pro forma Form 1120 each year reporting reportable transactions with the owner. Confirm applicability.", dueDate: `${nextYear}-04-15`, frequency: "annual", status: "pending", applicable: true, valueLabel: "Applicable?", sortOrder: 2 },
      { id: "comp-1120", title: "Pro forma Form 1120 filing", jurisdiction: "United States", description: "Filed together with Form 5472. Penalties for non-filing are significant.", dueDate: `${nextYear}-04-15`, frequency: "annual", status: "pending", applicable: true, sortOrder: 3 },
      { id: "comp-wy-report", title: "Wyoming annual report", jurisdiction: "Wyoming", description: "Due on the first day of the LLC's anniversary month each year, with the annual license tax.", frequency: "annual", status: "pending", applicable: true, valueLabel: "Anniversary month", sortOrder: 4 },
      { id: "comp-agent", title: "Registered agent renewal", jurisdiction: "Wyoming", description: "Keep the Wyoming registered agent paid and current.", frequency: "annual", status: "pending", applicable: true, valueLabel: "Agent", sortOrder: 5 },
      { id: "comp-pk-return", title: "Pakistani income tax return", jurisdiction: "Pakistan", description: "Annual return for individual / business income (tax year ends 30 June; filing typically due 30 September, subject to FBR extensions).", dueDate: `${year}-09-30` >= todayKey() ? `${year}-09-30` : `${nextYear}-09-30`, frequency: "annual", status: "pending", applicable: true, sortOrder: 6 },
      { id: "comp-pk-registration", title: "Pakistani business registration requirements", jurisdiction: "Pakistan", description: "NTN, FBR registration, any provincial sales tax on services registration where applicable.", frequency: "once", status: "pending", applicable: true, valueLabel: "NTN", sortOrder: 7 },
      { id: "comp-deadlines", title: "Other relevant tax deadlines", jurisdiction: "Both", description: "Add quarterly estimates or withholding statements as advised by your accountant.", frequency: "annual", status: "pending", applicable: true, sortOrder: 8 },
    ])
    .run();

  return true;
}
