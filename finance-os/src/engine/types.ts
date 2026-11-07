import type * as s from "@/db/schema";
import type { Bucket, AlertLevel } from "@/lib/constants";
import type { Minor } from "@/lib/money";

/** Everything the engine needs, loaded from the database. Engine functions are pure. */
export interface EngineData {
  settings: s.Settings;
  policies: s.AllocationPolicy[];
  entities: s.Entity[];
  accounts: s.Account[];
  categories: s.Category[];
  vendors: s.Vendor[];
  clients: s.Client[];
  revenuePeriods: s.ClientRevenuePeriod[];
  invoices: s.Invoice[];
  transactions: s.Transaction[];
  recurringExpenses: s.RecurringExpense[];
  householdLines: s.HouseholdBudgetLine[];
  processors: s.Processor[];
  reserves: s.ProcessorReserve[];
  fxRates: s.FxRate[];
  allocationEntries: s.AllocationEntry[];
  monthCloses: s.MonthClose[];
  taxProfiles: s.TaxProfile[];
  complianceItems: s.ComplianceItem[];
  growthProposals: s.GrowthProposal[];
  snoozes: s.AlertSnooze[];
}

export type Allocations = Record<Bucket, Minor>;

export interface RevenueMetrics {
  grossEarned: Minor;
  invoiced: Minor;
  collected: Minor;
  refunds: Minor;
  chargebacks: Minor;
  processingFees: Minor;
  conversionFees: Minor;
  payoutFees: Minor;
  platformFees: Minor;
  totalFees: Minor;
  reservesHeld: Minor;
  reservesReleased: Minor;
  /** Collected − refunds − chargebacks − fees. */
  netDistributable: Minor;
  /** Net distributable adjusted for processor reserves held/released this month; the allocation base. Never below zero. */
  allocatable: Minor;
  allocatableRaw: Minor;
  /** Earned but not yet collected across all open invoices (as of month end). */
  outstandingReceivables: Minor;
  overdueReceivables: Minor;
}

export interface ExpenseMetrics {
  ceiling: Minor;
  ceilingSource: "policy" | "override";
  policyCeiling: Minor;
  overheadActual: Minor;
  directDeliveryActual: Minor;
  growthActual: Minor;
  remainingAllowance: Minor;
  unspentAllowance: Minor;
  spendPct: string | null; // of ceiling
  opexRatioPct: string | null; // overhead / net distributable
  committedSubscriptionsMonthly: Minor;
  essentialMonthly: Minor;
  grossProfit: Minor;
  grossMarginPct: string | null;
  operatingResult: Minor;
  operatingMarginPct: string | null;
  netResultAfterOwnerPay: Minor;
  netMarginPct: string | null;
  byCategory: { categoryId: string | null; name: string; amount: Minor }[];
}

export interface OwnerMetrics {
  target: Minor;
  drawn: Minor;
  undrawn: Minor;
  householdBudget: Minor;
  householdLinesBudget: Minor;
  householdActual: Minor;
  householdActualPkr: Minor;
  discretionaryActual: Minor;
  discretionaryAvailable: Minor;
  remainingPersonalBudget: Minor;
  personalSavings: Minor;
  discretionaryGoal: Minor;
  discretionaryGoalGap: Minor;
  byCategory: { categoryId: string | null; name: string; amount: Minor }[];
}

export interface EnvelopeState {
  bucket: Bucket;
  credits: Minor;
  debits: Minor;
  balance: Minor;
  /** Real account balance for the matching account role (sum), USD. */
  fundedBalance: Minor | null;
}

export interface ReserveMetrics {
  balance: Minor;
  fundedBalance: Minor;
  essentialMonthly: Minor;
  targetMonths: string;
  target: Minor;
  pctOfTarget: string | null;
  coverageMonths: string | null;
  monthlyContribution: Minor;
  projectedTargetDate: string | null;
  monthsToTarget: number | null;
}

export interface ProfitMetrics {
  target: Minor;
  monthlyActual: Minor;
  marginPct: string | null;
  cumulativeRetained: Minor;
  distributed: Minor;
  availableForDistribution: Minor;
}

export interface TaxMetrics {
  target: Minor;
  envelopeBalance: Minor;
  fundedBalance: Minor;
  paidThisMonth: Minor;
  paidTotal: Minor;
}

export interface ClientMetrics {
  clientId: string;
  name: string;
  earned: Minor;
  collected: Minor;
  invoiced: Minor;
  outstanding: Minor;
  directCosts: Minor;
  associatedExpenses: Minor;
  profit: Minor;
  marginPct: string | null;
  sharePct: string | null;
  trailingEarned: Minor;
}

export interface ConcentrationMetrics {
  largestClientId: string | null;
  largestClientName: string | null;
  largestSharePct: string | null;
  trailingLargestSharePct: string | null;
  basis: "earned" | "collected" | "none";
}

export interface CashMetrics {
  bankBusinessCash: Minor;
  personalCash: Minor;
  processorAvailable: Minor;
  processorRestricted: Minor;
  totalEnvelopes: Minor;
  receivables: Minor;
  runwayMonths: string | null;
  avgMonthlyOutflow: Minor;
  recurringMonthlyRevenue: Minor;
}

export interface MonthSnapshot {
  month: string;
  isClosed: boolean;
  policy: s.AllocationPolicy;
  policyValid: boolean;
  allocations: Allocations;
  actualByBucket: Allocations;
  revenue: RevenueMetrics;
  expenses: ExpenseMetrics;
  owner: OwnerMetrics;
  envelopes: EnvelopeState[];
  reserve: ReserveMetrics;
  profit: ProfitMetrics;
  tax: TaxMetrics;
  clients: ClientMetrics[];
  concentration: ConcentrationMetrics;
  cash: CashMetrics;
}

export interface Alert {
  key: string;
  level: AlertLevel;
  title: string;
  what: string;
  why: string;
  impact: string;
  action: string;
  href?: string;
}
