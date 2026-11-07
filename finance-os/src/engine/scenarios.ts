import Decimal from "decimal.js";
import type { Settings } from "@/db/schema";
import type { Minor } from "@/lib/money";
import { computeAllocations, type PolicyPercentages } from "./allocation";
import type { Allocations } from "./types";

export interface ScenarioInput {
  /** Net distributable (allocatable) monthly revenue for the scenario. */
  revenue: Minor;
  pcts: PolicyPercentages;
  settings: Settings;
  /** Operating costs you expect to actually run at this revenue; defaults to current committed subscriptions. */
  expectedOpexActual: Minor;
  /** Expected direct delivery costs at this revenue (for gross-margin preview). */
  expectedDirectCosts?: Minor;
  months?: number;
}

export interface ScenarioResult {
  revenue: Minor;
  allocations: Allocations;
  householdBudget: Minor;
  discretionaryIncome: Minor;
  discretionaryGoal: Minor;
  discretionaryGoalMet: boolean;
  expectedOpexActual: Minor;
  unspentOpexAllowance: Minor;
  opexRatioPct: string | null;
  grossMarginPct: string | null;
  /** Monthly cash the business keeps: profit + reserve + unspent operating allowance. */
  monthlyBusinessCashAccumulation: Minor;
  /** Monthly cash the owner keeps: owner comp − household budget − discretionary (assumed at goal cap). */
  monthlyOwnerSavings: Minor;
  horizonMonths: number;
  projectedBusinessCash: Minor;
  projectedTaxReserve: Minor;
  projectedOwnerSavings: Minor;
}

/**
 * Revenue simulator. Uses the same allocation rules as the live engine. Personal
 * spending is NOT scaled with revenue: the household budget stays at its
 * configured ceiling and discretionary spending is capped at the configured goal.
 */
export function simulate(input: ScenarioInput): ScenarioResult {
  const { revenue, pcts, settings } = input;
  const allocations = computeAllocations(revenue, pcts);
  const householdBudget = settings.householdBudgetUsdCents;
  const discretionaryIncome = allocations.owner - householdBudget;
  const discretionaryGoal = settings.discretionaryGoalUsdCents;
  const expectedOpexActual = input.expectedOpexActual;
  const unspentOpexAllowance = Math.max(0, allocations.opex - expectedOpexActual);
  const direct = input.expectedDirectCosts ?? 0;
  const months = input.months ?? 12;
  const monthlyBusinessCashAccumulation = allocations.profit + allocations.reserve + unspentOpexAllowance;
  const discretionarySpend = Math.min(Math.max(0, discretionaryIncome), discretionaryGoal);
  const monthlyOwnerSavings = allocations.owner - householdBudget - discretionarySpend;
  return {
    revenue,
    allocations,
    householdBudget,
    discretionaryIncome,
    discretionaryGoal,
    discretionaryGoalMet: discretionaryIncome >= discretionaryGoal,
    expectedOpexActual,
    unspentOpexAllowance,
    opexRatioPct: revenue > 0 ? new Decimal(expectedOpexActual).div(revenue).mul(100).toDecimalPlaces(1).toString() : null,
    grossMarginPct: revenue > 0 ? new Decimal(revenue - direct).div(revenue).mul(100).toDecimalPlaces(1).toString() : null,
    monthlyBusinessCashAccumulation,
    monthlyOwnerSavings,
    horizonMonths: months,
    projectedBusinessCash: monthlyBusinessCashAccumulation * months,
    projectedTaxReserve: allocations.tax * months,
    projectedOwnerSavings: monthlyOwnerSavings * months,
  };
}
