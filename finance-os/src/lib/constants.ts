export const BUCKETS = ["opex", "owner", "tax", "profit", "reserve", "growth"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_LABELS: Record<Bucket, string> = {
  opex: "Operating expense ceiling",
  owner: "Owner compensation",
  tax: "Tax reserve",
  profit: "Business profit",
  reserve: "Business cash reserve",
  growth: "Growth investment",
};

export const BUCKET_SHORT: Record<Bucket, string> = {
  opex: "Operating",
  owner: "Owner pay",
  tax: "Tax",
  profit: "Profit",
  reserve: "Reserve",
  growth: "Growth",
};

export const TRANSACTION_TYPES = [
  "client_payment",
  "income",
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
  "reserve_hold",
  "reserve_release",
  "payout",
  "owner_draw",
  "profit_distribution",
  "tax_payment",
  "transfer",
  "balance_adjustment",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  client_payment: "Client payment (collected)",
  income: "Other business income",
  expense: "Business expense",
  contractor_payment: "Contractor payment",
  employee_payment: "Employee payment",
  growth_investment: "Growth investment",
  household_expense: "Household expense",
  personal_expense: "Personal expense",
  refund: "Refund",
  chargeback: "Chargeback",
  processing_fee: "Payment processing fee",
  conversion_fee: "Currency conversion fee",
  payout_fee: "Payout fee",
  platform_fee: "Platform fee",
  reserve_hold: "Processor reserve hold",
  reserve_release: "Processor reserve release",
  payout: "Processor payout to bank",
  owner_draw: "Owner draw",
  profit_distribution: "Profit distribution",
  tax_payment: "Tax payment",
  transfer: "Internal transfer",
  balance_adjustment: "Balance adjustment",
};

/** Types that represent collected revenue (inflows). */
export const REVENUE_TYPES: TransactionType[] = ["client_payment", "income"];
/** Types that reverse revenue. */
export const REVENUE_REVERSAL_TYPES: TransactionType[] = ["refund", "chargeback"];
/** Direct collection fees (subtracted once in net distributable revenue). */
export const COLLECTION_FEE_TYPES: TransactionType[] = ["processing_fee", "conversion_fee", "payout_fee", "platform_fee"];
/** Business spending types (overhead or delivery depending on cost_type). */
export const BUSINESS_SPEND_TYPES: TransactionType[] = ["expense", "contractor_payment", "employee_payment", "growth_investment"];
/** Owner-side spending. */
export const PERSONAL_SPEND_TYPES: TransactionType[] = ["household_expense", "personal_expense"];
/** Movements between own accounts; never income nor expense. */
export const TRANSFER_TYPES: TransactionType[] = ["reserve_hold", "reserve_release", "payout", "owner_draw", "profit_distribution", "transfer", "balance_adjustment"];
/** Types that require a destination account. */
export const TWO_SIDED_TYPES: TransactionType[] = ["reserve_hold", "reserve_release", "payout", "owner_draw", "profit_distribution", "transfer"];

export const ACCOUNT_ROLES = ["operating", "tax", "profit", "savings", "growth", "personal", "processor_available", "processor_restricted", "other"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = {
  operating: "Business operating",
  tax: "Tax reserve",
  profit: "Business profit",
  savings: "Business savings / reserve",
  growth: "Growth",
  personal: "Personal",
  processor_available: "Processor available balance",
  processor_restricted: "Processor restricted / reserved",
  other: "Other",
};

export const BUSINESS_CASH_ROLES: AccountRole[] = ["operating", "tax", "profit", "savings", "growth", "other"];

export const COST_TYPES = ["overhead", "direct_delivery"] as const;
export type CostType = (typeof COST_TYPES)[number];
export const COST_TYPE_LABELS: Record<CostType, string> = { overhead: "General overhead", direct_delivery: "Direct delivery cost" };

export const BUSINESS_CATEGORY_NAMES = [
  "Software and AI",
  "Lead generation",
  "Marketing",
  "Sales tools",
  "Communication",
  "Operations",
  "Contractors",
  "Administrative",
  "Education",
  "Other",
] as const;

export const PERSONAL_CATEGORY_NAMES = [
  "Family support",
  "Food",
  "Utilities",
  "Internet",
  "Entertainment",
  "Streaming",
  "Shopping",
  "Travel",
  "Personal technology",
  "Other",
] as const;

export const FREQUENCIES = ["monthly", "quarterly", "annual", "weekly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABELS: Record<Frequency, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual", weekly: "Weekly" };
/** Months per billing cycle, used to normalise to monthly cost. */
export const FREQUENCY_MONTHS: Record<Frequency, number> = { monthly: 1, quarterly: 3, annual: 12, weekly: 12 / 52 };

export const AGREEMENT_TYPES = ["revenue_share", "retainer", "fixed_fee", "hybrid"] as const;
export type AgreementType = (typeof AGREEMENT_TYPES)[number];
export const AGREEMENT_LABELS: Record<AgreementType, string> = { revenue_share: "Revenue share", retainer: "Monthly retainer", fixed_fee: "Fixed fee", hybrid: "Hybrid" };

export const SCENARIO_PRESETS = [400000, 500000, 600000, 800000, 1000000, 2000000, 5000000, 10000000, 20000000, 40000000];

export type AlertLevel = "info" | "caution" | "critical";
