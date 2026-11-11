import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Database schema (SQLite via sql.js in the browser, Drizzle ORM for typed access).
 *
 * Conventions
 * - All money columns are INTEGER minor units (USD cents, PKR paisa).
 * - *_usd_cents columns hold the USD-converted value; original currency + rate
 *   are kept alongside so nothing is lost.
 * - Percentages and FX rates are TEXT decimal strings ("25", "280.5").
 * - Dates are ISO strings: "YYYY-MM-DD"; months are "YYYY-MM".
 * - IDs are text UUIDs generated client-side.
 */

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(), // always 1
  businessName: text("business_name").notNull(),
  ownerName: text("owner_name").notNull(),
  baseCurrency: text("base_currency").notNull().default("USD"),
  householdCurrency: text("household_currency").notNull().default("PKR"),
  defaultFxRatePkrPerUsd: text("default_fx_rate_pkr_per_usd").notNull().default("280"),
  householdBudgetUsdCents: integer("household_budget_usd_cents").notNull().default(100000),
  discretionaryGoalUsdCents: integer("discretionary_goal_usd_cents").notNull().default(500000),
  targetGrossMarginMinPct: text("target_gross_margin_min_pct").notNull().default("65"),
  targetGrossMarginMaxPct: text("target_gross_margin_max_pct").notNull().default("75"),
  reserveTargetMonths: text("reserve_target_months").notNull().default("3"),
  reserveMinMonths: text("reserve_min_months").notNull().default("3"),
  reserveMaxMonths: text("reserve_max_months").notNull().default("6"),
  concentrationWarnPct: text("concentration_warn_pct").notNull().default("50"),
  concentrationCriticalPct: text("concentration_critical_pct").notNull().default("75"),
  opexCeilingOverrideUsdCents: integer("opex_ceiling_override_usd_cents"),
  opexCeilingOverrideNote: text("opex_ceiling_override_note"),
  opexCeilingOverrideApprovedAt: text("opex_ceiling_override_approved_at"),
  renewalReminderDays: integer("renewal_reminder_days").notNull().default(7),
  invoiceOverdueGraceDays: integer("invoice_overdue_grace_days").notNull().default(0),
  pinnedPolicyId: text("pinned_policy_id"),
  theme: text("theme").notNull().default("system"),
  secondaryCurrencyDisplay: integer("secondary_currency_display", { mode: "boolean" }).notNull().default(true),
  /** Answers from the setup questionnaire (JSON). Null until the questionnaire has been completed. */
  onboardingJson: text("onboarding_json"),
  /** Per-workspace interface preferences (JSON): dashboard sections, order and custom trackers. */
  uiJson: text("ui_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const allocationPolicies = sqliteTable("allocation_policies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  appliesFromMonthlyRevenueUsdCents: integer("applies_from_monthly_revenue_usd_cents").notNull().default(0),
  opexPct: text("opex_pct").notNull(),
  ownerPct: text("owner_pct").notNull(),
  taxPct: text("tax_pct").notNull(),
  profitPct: text("profit_pct").notNull(),
  reservePct: text("reserve_pct").notNull(),
  growthPct: text("growth_pct").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const entities = sqliteTable("entities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'pk_individual' | 'us_llc' | 'other'
  jurisdiction: text("jurisdiction").notNull(),
  registrationNumber: text("registration_number"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // role: operating | tax | profit | savings | growth | personal | processor_available | processor_restricted | other
  role: text("role").notNull(),
  // kind: bank | processor | cash | virtual
  kind: text("kind").notNull(),
  currency: text("currency").notNull().default("USD"),
  openingBalanceMinor: integer("opening_balance_minor").notNull().default(0),
  openingBalanceDate: text("opening_balance_date").notNull(),
  entityId: text("entity_id"),
  processorId: text("processor_id"),
  institution: text("institution"),
  isBusiness: integer("is_business", { mode: "boolean" }).notNull().default(true),
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  scope: text("scope").notNull(), // 'business' | 'personal'
  isEssentialDefault: integer("is_essential_default", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
});

export const vendors = sqliteTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  website: text("website"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  agreementType: text("agreement_type").notNull(), // revenue_share | retainer | fixed_fee | hybrid
  startDate: text("start_date"),
  endDate: text("end_date"),
  revenueSharePct: text("revenue_share_pct"),
  monthlyRetainerUsdCents: integer("monthly_retainer_usd_cents").notNull().default(0),
  fixedFeeUsdCents: integer("fixed_fee_usd_cents").notNull().default(0),
  status: text("status").notNull().default("active"), // active | paused | churned | prospect
  entityId: text("entity_id"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(7),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

/** Revenue EARNED per client per month (accrual view). Collection is tracked in the ledger. */
export const clientRevenuePeriods = sqliteTable("client_revenue_periods", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  month: text("month").notNull(), // YYYY-MM
  clientAttributableRevenueUsdCents: integer("client_attributable_revenue_usd_cents").notNull().default(0),
  revenueSharePct: text("revenue_share_pct"),
  commissionUsdCents: integer("commission_usd_cents").notNull().default(0),
  retainerUsdCents: integer("retainer_usd_cents").notNull().default(0),
  fixedFeesUsdCents: integer("fixed_fees_usd_cents").notNull().default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  number: text("number"),
  periodMonth: text("period_month").notNull(),
  issueDate: text("issue_date").notNull(),
  dueDate: text("due_date").notNull(),
  expectedPaymentDate: text("expected_payment_date"),
  amountUsdCents: integer("amount_usd_cents").notNull(),
  status: text("status").notNull().default("sent"), // draft | sent | partially_paid | paid | void
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

/**
 * The single financial ledger. Every money movement is one row.
 *
 * type:
 *  income            business income not tied to a client (interest, misc)
 *  client_payment    collected revenue from a client (gross, before fees)
 *  expense           business expense (overhead or direct delivery via cost_type)
 *  contractor_payment, employee_payment  people costs (cost_type decides overhead vs delivery)
 *  growth_investment business spend charged to the growth envelope
 *  household_expense, personal_expense   owner-side spending from the personal account
 *  refund, chargeback                     revenue reversals
 *  processing_fee, conversion_fee, payout_fee, platform_fee  collection fees
 *  reserve_hold      processor moves funds available -> restricted
 *  reserve_release   processor moves funds restricted -> available
 *  payout            processor -> bank transfer (bank_withdrawal)
 *  owner_draw        business -> personal transfer (owner compensation actually paid)
 *  profit_distribution business profit paid out to owner
 *  tax_payment       tax actually paid
 *  transfer          internal transfer between own accounts (never income/expense)
 *  balance_adjustment manual correction to a real account balance
 */
export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  month: text("month").notNull(),
  type: text("type").notNull(),
  amountMinor: integer("amount_minor").notNull(), // original currency, always positive magnitude
  currency: text("currency").notNull().default("USD"),
  fxRatePerUsd: text("fx_rate_per_usd").notNull().default("1"),
  amountUsdCents: integer("amount_usd_cents").notNull(),
  description: text("description").notNull(),
  categoryId: text("category_id"),
  accountId: text("account_id"), // source account (money leaves) or receiving account for inflows
  toAccountId: text("to_account_id"), // destination for transfers/payouts/draws/holds
  clientId: text("client_id"),
  invoiceId: text("invoice_id"),
  processorId: text("processor_id"),
  vendorId: text("vendor_id"),
  recurringExpenseId: text("recurring_expense_id"),
  groupId: text("group_id"), // links the rows of one processor sale batch
  costType: text("cost_type"), // overhead | direct_delivery | null
  bucket: text("bucket"), // opex | owner | tax | profit | reserve | growth | null
  isEssential: integer("is_essential", { mode: "boolean" }).notNull().default(false),
  isRecurring: integer("is_recurring", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const recurringExpenses = sqliteTable("recurring_expenses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  vendorId: text("vendor_id"),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("USD"),
  frequency: text("frequency").notNull(), // monthly | annual | quarterly | weekly
  categoryId: text("category_id"),
  costType: text("cost_type").notNull().default("overhead"),
  bucket: text("bucket").notNull().default("opex"),
  accountId: text("account_id"),
  startDate: text("start_date"),
  nextRenewalDate: text("next_renewal_date"),
  cancelledAt: text("cancelled_at"),
  status: text("status").notNull().default("active"), // active | paused | cancelled | proposed | needs_config
  isEssential: integer("is_essential", { mode: "boolean" }).notNull().default(false),
  justification: text("justification"),
  roiEstimateUsdCents: integer("roi_estimate_usd_cents"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const householdBudgetLines = sqliteTable("household_budget_lines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  categoryId: text("category_id"),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("PKR"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const processors = sqliteTable("processors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  availableAccountId: text("available_account_id"),
  restrictedAccountId: text("restricted_account_id"),
  // Fee defaults (decimal strings in percent; fixed fees in USD cents)
  domesticCardPct: text("domestic_card_pct").notNull().default("2.7"),
  domesticCardFixedCents: integer("domestic_card_fixed_cents").notNull().default(30),
  intlCardSurchargePct: text("intl_card_surcharge_pct").notNull().default("1.5"),
  conversionPct: text("conversion_pct").notNull().default("1"),
  platformFeePct: text("platform_fee_pct").notNull().default("3"),
  platformFeeAppliesByDefault: integer("platform_fee_applies_by_default", { mode: "boolean" }).notNull().default(true),
  achPayoutFeeCents: integer("ach_payout_fee_cents").notNull().default(250),
  wirePayoutFeeCents: integer("wire_payout_fee_cents").notNull().default(2500),
  intlTransferFeeCents: integer("intl_transfer_fee_cents").notNull().default(2500),
  intlTransferPct: text("intl_transfer_pct").notNull().default("1"),
  instantPayoutPct: text("instant_payout_pct").notNull().default("4"),
  instantPayoutFixedCents: integer("instant_payout_fixed_cents").notNull().default(100),
  defaultReservePct: text("default_reserve_pct").notNull().default("0"),
  pricingSource: text("pricing_source"),
  pricingVerifiedAt: text("pricing_verified_at"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const processorReserves = sqliteTable("processor_reserves", {
  id: text("id").primaryKey(),
  processorId: text("processor_id").notNull(),
  amountUsdCents: integer("amount_usd_cents").notNull(),
  dateWithheld: text("date_withheld").notNull(),
  expectedReleaseDate: text("expected_release_date"),
  releasedDate: text("released_date"),
  status: text("status").notNull().default("held"), // held | released | forfeited
  reason: text("reason"),
  holdTransactionId: text("hold_transaction_id"),
  releaseTransactionId: text("release_transaction_id"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const fxRates = sqliteTable("fx_rates", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  currency: text("currency").notNull(), // quote currency, e.g. PKR
  ratePerUsd: text("rate_per_usd").notNull(),
  source: text("source"),
  createdAt: text("created_at").notNull(),
});

/** Credits/debits to the VIRTUAL Profit First envelopes. Spending debits come from the ledger via `bucket`. */
export const allocationEntries = sqliteTable("allocation_entries", {
  id: text("id").primaryKey(),
  month: text("month").notNull(),
  bucket: text("bucket").notNull(), // opex | owner | tax | profit | reserve | growth
  amountUsdCents: integer("amount_usd_cents").notNull(), // positive credit, negative debit
  source: text("source").notNull(), // month_close | reassign | manual
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

export const monthCloses = sqliteTable("month_closes", {
  id: text("id").primaryKey(),
  month: text("month").notNull().unique(),
  status: text("status").notNull().default("closed"), // closed | reopened
  closedAt: text("closed_at").notNull(),
  reopenedAt: text("reopened_at"),
  reportJson: text("report_json").notNull(),
  checklistJson: text("checklist_json"),
  notes: text("notes"),
});

export const taxProfiles = sqliteTable("tax_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  entityId: text("entity_id"),
  scope: text("scope").notNull(), // business | personal
  assumedRatePct: text("assumed_rate_pct"),
  isEstimate: integer("is_estimate", { mode: "boolean" }).notNull().default(true),
  filingFrequency: text("filing_frequency"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const complianceItems = sqliteTable("compliance_items", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  description: text("description"),
  dueDate: text("due_date"),
  frequency: text("frequency"), // annual | quarterly | monthly | once
  status: text("status").notNull().default("pending"), // pending | done | not_applicable
  applicable: integer("applicable", { mode: "boolean" }).notNull().default(true),
  valueLabel: text("value_label"), // e.g. "EIN"
  value: text("value"), // e.g. the EIN number
  lastCompletedAt: text("last_completed_at"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const growthProposals = sqliteTable("growth_proposals", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // subscription | hire | one_time | channel
  name: text("name").notNull(),
  description: text("description"),
  monthlyCostUsdCents: integer("monthly_cost_usd_cents").notNull().default(0),
  oneTimeCostUsdCents: integer("one_time_cost_usd_cents").notNull().default(0),
  expectedAdditionalRevenueUsdCents: integer("expected_additional_revenue_usd_cents").notNull().default(0),
  expectedBenefit: text("expected_benefit"),
  deliveryCapacityUsdCents: integer("delivery_capacity_usd_cents").notNull().default(0),
  costType: text("cost_type").notNull().default("overhead"),
  bucket: text("bucket").notNull().default("growth"),
  status: text("status").notNull().default("proposed"), // proposed | approved | rejected
  evaluationJson: text("evaluation_json"),
  decisionNote: text("decision_note"),
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
});

export const alertSnoozes = sqliteTable("alert_snoozes", {
  alertKey: text("alert_key").primaryKey(),
  snoozedUntil: text("snoozed_until").notNull(),
});

export type Settings = typeof settings.$inferSelect;
export type AllocationPolicy = typeof allocationPolicies.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Vendor = typeof vendors.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type ClientRevenuePeriod = typeof clientRevenuePeriods.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type HouseholdBudgetLine = typeof householdBudgetLines.$inferSelect;
export type Processor = typeof processors.$inferSelect;
export type ProcessorReserve = typeof processorReserves.$inferSelect;
export type FxRate = typeof fxRates.$inferSelect;
export type AllocationEntry = typeof allocationEntries.$inferSelect;
export type MonthClose = typeof monthCloses.$inferSelect;
export type TaxProfile = typeof taxProfiles.$inferSelect;
export type ComplianceItem = typeof complianceItems.$inferSelect;
export type GrowthProposal = typeof growthProposals.$inferSelect;
export type AlertSnooze = typeof alertSnoozes.$inferSelect;

export type NewTransaction = typeof transactions.$inferInsert;
export type NewRecurringExpense = typeof recurringExpenses.$inferInsert;
export type NewClient = typeof clients.$inferInsert;
export type NewInvoice = typeof invoices.$inferInsert;
export type NewAccount = typeof accounts.$inferInsert;
export type NewGrowthProposal = typeof growthProposals.$inferInsert;
export type NewComplianceItem = typeof complianceItems.$inferInsert;
export type NewAllocationPolicy = typeof allocationPolicies.$inferInsert;
export type NewProcessorReserve = typeof processorReserves.$inferInsert;
export type NewClientRevenuePeriod = typeof clientRevenuePeriods.$inferInsert;
export type NewHouseholdBudgetLine = typeof householdBudgetLines.$inferInsert;
