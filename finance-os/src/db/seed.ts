import type { Db } from "./client";
import { eq } from "drizzle-orm";
import * as s from "./schema";
import { BUSINESS_CATEGORY_NAMES, PERSONAL_CATEGORY_NAMES } from "@/lib/constants";
import { addMonths, currentMonthKey, todayKey, monthRange } from "@/lib/dates";
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

export interface SeedOptions {
  /** "retention_rules" = the owner's full starting position; "blank" = generic scaffolding for another business. */
  template?: "retention_rules" | "blank" | "demo";
  businessName?: string;
  ownerName?: string;
  baseCurrency?: string;
  householdCurrency?: string;
  fxRatePerUsd?: string;
}

/**
 * Seeds the database. Idempotent: it only runs when the settings row is missing.
 * The default template is the owner's actual starting position; the blank
 * template creates the policy, accounts, categories, entity and a generic
 * processor so a second business starts clean but usable.
 */
export function seedDatabase(db: Db, opts: SeedOptions = {}): boolean {
  const existing = db.select().from(s.settings).all();
  if (existing.length > 0) return false;
  if ((opts.template ?? "retention_rules") === "blank") return seedBlank(db, opts);
  if (opts.template === "demo") return seedDemo(db);
  const now = nowIso();
  const today = todayKey();
  const month = currentMonthKey();

  db.insert(s.settings)
    .values({
      id: 1,
      businessName: opts.businessName ?? "Retention Rules",
      ownerName: opts.ownerName ?? "Muddassir Abdur Rub",
      baseCurrency: "USD",
      householdCurrency: "PKR",
      defaultFxRatePkrPerUsd: opts.fxRatePerUsd ?? "280",
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

function seedBlank(db: Db, opts: SeedOptions): boolean {
  const now = nowIso();
  const today = todayKey();
  const businessName = opts.businessName?.trim() || "My business";
  const ownerName = opts.ownerName?.trim() || "Owner";
  const baseCurrency = opts.baseCurrency ?? "USD";
  const householdCurrency = opts.householdCurrency ?? "PKR";

  db.insert(s.settings)
    .values({
      id: 1,
      businessName,
      ownerName,
      baseCurrency,
      householdCurrency,
      defaultFxRatePkrPerUsd: opts.fxRatePerUsd ?? "280",
      householdBudgetUsdCents: 0,
      discretionaryGoalUsdCents: 0,
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

  db.insert(s.allocationPolicies)
    .values({
      id: IDS.policyLean,
      name: "Starting policy",
      description: "Profit First starting split. Edit the percentages to fit this business; they must add up to 100%.",
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

  db.insert(s.entities).values({ id: uid(), name: businessName, type: "other", jurisdiction: "To be set", notes: "Edit under Tax & compliance.", createdAt: now }).run();

  db.insert(s.processors)
    .values({ id: IDS.processorWhop, name: "Payment processor", availableAccountId: IDS.acctWhopAvailable, restrictedAccountId: IDS.acctWhopRestricted, pricingSource: "Generic card-processing defaults (2.7% + $0.30, +1.5% international, +1% conversion). Rename the processor and set its real fees under Fee defaults.", notes: null, createdAt: now })
    .run();

  const acct = (id: string, name: string, role: string, kind: string, isBusiness: boolean, sortOrder: number, extra: Partial<s.NewAccount> = {}) => ({ id, name, role, kind, currency: baseCurrency, openingBalanceMinor: 0, openingBalanceDate: today, isBusiness, isArchived: false, sortOrder, createdAt: now, ...extra });
  db.insert(s.accounts)
    .values([
      acct(IDS.acctOperating, "Business operating account", "operating", "bank", true, 1),
      acct(IDS.acctTax, "Tax reserve account", "tax", "bank", true, 2),
      acct(IDS.acctProfit, "Business profit account", "profit", "bank", true, 3),
      acct(IDS.acctSavings, "Business savings account", "savings", "bank", true, 4),
      acct(IDS.acctGrowth, "Growth account", "growth", "bank", true, 5),
      acct(IDS.acctPersonal, "Personal account", "personal", "bank", false, 6),
      acct(IDS.acctWhopAvailable, "Processor available balance", "processor_available", "processor", true, 7, { processorId: IDS.processorWhop }),
      acct(IDS.acctWhopRestricted, "Processor restricted balance", "processor_restricted", "processor", true, 8, { processorId: IDS.processorWhop }),
    ])
    .run();

  const essentialBusiness = new Set(["Software and AI", "Communication", "Administrative", "Operations"]);
  db.insert(s.categories)
    .values([
      ...BUSINESS_CATEGORY_NAMES.map((name, i) => ({ id: categoryId("business", name), name, scope: "business", isEssentialDefault: essentialBusiness.has(name), sortOrder: i, isSystem: true })),
      ...PERSONAL_CATEGORY_NAMES.map((name, i) => ({ id: categoryId("personal", name), name, scope: "personal", isEssentialDefault: ["Family support", "Food", "Utilities", "Internet"].includes(name), sortOrder: i, isSystem: true })),
    ])
    .run();

  db.insert(s.taxProfiles).values({ id: uid(), name: `${businessName} business tax`, jurisdiction: "To be set", entityId: null, scope: "business", assumedRatePct: null, isEstimate: true, filingFrequency: "annual", notes: "Set the jurisdiction and confirm obligations with a professional.", createdAt: now }).run();
  db.insert(s.complianceItems).values({ id: uid(), title: "Business registration and tax filings", jurisdiction: "To be set", description: "Add the registrations, returns and deadlines that apply to this business.", frequency: "annual", status: "pending", applicable: true, sortOrder: 1 }).run();

  return true;
}

/**
 * Demo workspace: a fictional two-client agency with six months of history so
 * visitors can explore every page with realistic numbers. Deterministic.
 */
function seedDemo(db: Db): boolean {
  seedBlank(db, { businessName: "Northstar Studio (demo)", ownerName: "Sam Rivera", baseCurrency: "USD", householdCurrency: "USD" });
  const now = nowIso();
  const month = currentMonthKey();
  db.update(s.settings).set({ householdBudgetUsdCents: 250000, discretionaryGoalUsdCents: 300000, defaultFxRatePkrPerUsd: "1" }).run();
  db.update(s.processors).set({ name: "Stripe", pricingSource: "Demo defaults: 2.9% + $0.30 per card payment." , domesticCardPct: "2.9", platformFeePct: "0", platformFeeAppliesByDefault: false }).run();

  const clientA = "demo-client-a";
  const clientB = "demo-client-b";
  db.insert(s.clients)
    .values([
      { id: clientA, name: "Harbor Coffee Co.", agreementType: "retainer", startDate: `${addMonths(month, -8)}-01`, revenueSharePct: null, monthlyRetainerUsdCents: 450000, fixedFeeUsdCents: 0, status: "active", paymentTermsDays: 7, notes: "Email and lifecycle marketing retainer.", createdAt: now },
      { id: clientB, name: "Lumen Skincare", agreementType: "revenue_share", startDate: `${addMonths(month, -5)}-01`, revenueSharePct: "15", monthlyRetainerUsdCents: 0, fixedFeeUsdCents: 0, status: "active", paymentTermsDays: 14, notes: "15% of attributed store revenue.", createdAt: now },
    ])
    .run();

  const subs: [string, string, number, string, boolean][] = [
    ["demo-sub-klaviyo", "Klaviyo", 15000, "Software and AI", true],
    ["demo-sub-figma", "Figma", 1500, "Software and AI", false],
    ["demo-sub-ai", "AI assistant", 2000, "Software and AI", true],
    ["demo-sub-gw", "Google Workspace", 1400, "Administrative", true],
    ["demo-sub-notion", "Notion", 1000, "Operations", false],
    ["demo-sub-leads", "Lead data tool", 9900, "Lead generation", true],
  ];
  db.insert(s.recurringExpenses)
    .values(
      subs.map(([id, name, cents, cat, essential]) => ({
        id,
        name,
        amountMinor: cents,
        currency: "USD",
        frequency: "monthly",
        categoryId: categoryId("business", cat),
        costType: "overhead",
        bucket: "opex",
        accountId: IDS.acctOperating,
        startDate: `${addMonths(month, -8)}-01`,
        nextRenewalDate: `${addMonths(month, 1)}-03`,
        status: "active",
        isEssential: essential,
        justification: `${name} is used every week for client delivery.`,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();

  db.insert(s.householdBudgetLines)
    .values([
      { id: "demo-hh-rent", name: "Rent", categoryId: categoryId("personal", "Utilities"), amountMinor: 140000, currency: "USD", isActive: true, sortOrder: 1 },
      { id: "demo-hh-food", name: "Groceries", categoryId: categoryId("personal", "Food"), amountMinor: 60000, currency: "USD", isActive: true, sortOrder: 2 },
      { id: "demo-hh-util", name: "Utilities and internet", categoryId: categoryId("personal", "Internet"), amountMinor: 25000, currency: "USD", isActive: true, sortOrder: 3 },
    ])
    .run();

  const tx = (date: string, type: string, usd: number, description: string, extra: Partial<s.NewTransaction> = {}): s.NewTransaction => ({
    id: uid(),
    date,
    month: date.slice(0, 7),
    type,
    amountMinor: usd,
    currency: "USD",
    fxRatePerUsd: "1",
    amountUsdCents: usd,
    description,
    isEssential: false,
    isRecurring: false,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });

  const rows: s.NewTransaction[] = [];
  const entries: (typeof s.allocationEntries.$inferInsert)[] = [];
  const storeRevenue = [3200000, 2800000, 4100000, 3600000, 4500000, 5200000, 3900000];
  for (let i = 6; i >= 0; i--) {
    const m = addMonths(month, -i);
    const { start, end } = monthRange(m);
    const day = (d: number) => `${m}-${String(d).padStart(2, "0")}`;
    const lumenRev = storeRevenue[6 - i];
    const commission = Math.round(lumenRev * 0.15);
    db.insert(s.clientRevenuePeriods).values([
      { id: uid(), clientId: clientA, month: m, clientAttributableRevenueUsdCents: 0, revenueSharePct: null, commissionUsdCents: 0, retainerUsdCents: 450000, fixedFeesUsdCents: 0, createdAt: now, updatedAt: now },
      { id: uid(), clientId: clientB, month: m, clientAttributableRevenueUsdCents: lumenRev, revenueSharePct: "15", commissionUsdCents: commission, retainerUsdCents: 0, fixedFeesUsdCents: 0, createdAt: now, updatedAt: now },
    ]).run();
    const invA = uid();
    db.insert(s.invoices).values({ id: invA, clientId: clientA, number: `HC-${m.replace("-", "")}`, periodMonth: m, issueDate: start, dueDate: day(7), amountUsdCents: 450000, status: "sent", createdAt: now }).run();
    rows.push(tx(day(i === 0 ? 5 : 6), "client_payment", 450000, "Harbor Coffee retainer", { clientId: clientA, invoiceId: invA, accountId: IDS.acctOperating }));
    if (i > 0 || Number(todayKey().slice(8, 10)) > 15) {
      const gross = commission;
      const fee = Math.round(gross * 0.029) + 30;
      const g = uid();
      rows.push(tx(day(15), "client_payment", gross, "Lumen Skincare revenue share", { clientId: clientB, processorId: IDS.processorWhop, accountId: IDS.acctWhopAvailable, groupId: g }));
      rows.push(tx(day(15), "processing_fee", fee, "Stripe card processing fee", { processorId: IDS.processorWhop, accountId: IDS.acctWhopAvailable, groupId: g }));
      rows.push(tx(day(17), "payout", gross - fee, "Stripe payout", { processorId: IDS.processorWhop, accountId: IDS.acctWhopAvailable, toAccountId: IDS.acctOperating }));
    }
    for (const [id, name, cents, cat, essential] of subs) {
      if (i === 0 && Number(todayKey().slice(8, 10)) < 3) continue;
      rows.push(tx(day(3), "expense", cents, `${name} (monthly renewal)`, { categoryId: categoryId("business", cat), recurringExpenseId: id, accountId: IDS.acctOperating, costType: "overhead", bucket: "opex", isRecurring: true, isEssential: essential }));
    }
    if (i >= 1) {
      rows.push(tx(day(12), "contractor_payment", 120000, "Freelance designer: Lumen creatives", { clientId: clientB, accountId: IDS.acctOperating, costType: "direct_delivery", categoryId: categoryId("business", "Contractors") }));
      rows.push(tx(day(20), "owner_draw", 300000, "Owner draw", { accountId: IDS.acctOperating, toAccountId: IDS.acctPersonal, bucket: "owner" }));
      rows.push(tx(day(21), "household_expense", 140000, "Rent", { accountId: IDS.acctPersonal, categoryId: categoryId("personal", "Utilities") }));
      rows.push(tx(day(24), "household_expense", 58000 + (i % 3) * 4000, "Groceries", { accountId: IDS.acctPersonal, categoryId: categoryId("personal", "Food") }));
      rows.push(tx(day(26), "personal_expense", 22000 + (i % 2) * 9000, "Dinners and shopping", { accountId: IDS.acctPersonal, categoryId: categoryId("personal", "Shopping") }));
      if (i === 3) rows.push(tx(day(9), "growth_investment", 50000, "Paid pilot: new lead channel", { accountId: IDS.acctOperating, bucket: "growth", categoryId: categoryId("business", "Lead generation") }));
      // Book the month's allocations as a closed month.
      const net = 450000 + (commission - (Math.round(commission * 0.029) + 30));
      const parts = { opex: Math.round(net * 0.25), owner: Math.round(net * 0.35), tax: Math.round(net * 0.15), profit: Math.round(net * 0.1), reserve: Math.round(net * 0.1), growth: 0 };
      parts.growth = net - (parts.opex + parts.owner + parts.tax + parts.profit + parts.reserve);
      for (const [bucket, amountUsdCents] of Object.entries(parts)) entries.push({ id: uid(), month: m, bucket, amountUsdCents, source: "month_close", note: "Allocation booked at month close", createdAt: now });
      db.insert(s.monthCloses).values({ id: uid(), month: m, status: "closed", closedAt: `${end}T18:00:00.000Z`, reportJson: "{}", checklistJson: null, notes: "Demo data" }).run();
    }
  }
  for (const r of rows) db.insert(s.transactions).values(r).run();
  for (const e of entries) db.insert(s.allocationEntries).values(e).run();
  // Real cash in the reserve and tax accounts so envelopes look funded.
  db.insert(s.transactions).values([
    tx(`${addMonths(month, -1)}-28`, "transfer", 900000, "Move reserve allocations to savings", { accountId: IDS.acctOperating, toAccountId: IDS.acctSavings }),
    tx(`${addMonths(month, -1)}-28`, "transfer", 1200000, "Move tax allocations to tax account", { accountId: IDS.acctOperating, toAccountId: IDS.acctTax }),
  ]).run();
  db.update(s.accounts).set({ openingBalanceDate: `${addMonths(month, -7)}-01` }).run();
  db.update(s.accounts).set({ openingBalanceMinor: 1500000 }).where(eq(s.accounts.id, IDS.acctOperating)).run();
  return true;
}
