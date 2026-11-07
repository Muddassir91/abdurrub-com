import Decimal from "decimal.js";
import type { Settings } from "@/db/schema";
import { type Minor } from "@/lib/money";
import type { MonthSnapshot } from "./types";

export interface InvestmentInput {
  type: "subscription" | "hire" | "one_time" | "channel";
  monthlyCost: Minor;
  oneTimeCost: Minor;
  expectedAdditionalRevenue: Minor; // monthly
  deliveryCapacity: Minor; // monthly revenue the hire lets you deliver
  costType: "overhead" | "direct_delivery";
  bucket: "opex" | "growth";
}

export interface InvestmentEvaluation {
  currentMonthlyRevenue: Minor;
  currentOpexActual: Minor;
  currentOpexRatioPct: string | null;
  newMonthlyCost: Minor;
  newOpexActual: Minor;
  newOpexRatioPct: string | null;
  newOpexRatioWithRevenuePct: string | null;
  opexCeiling: Minor;
  remainingAllowance: Minor;
  fitsInRemainingAllowance: boolean;
  growthEnvelopeBalance: Minor;
  growthMonthlyBudget: Minor;
  fitsInGrowthBudget: boolean;
  /** Revenue needed so the cost sits inside the operating ceiling percentage. */
  revenueNeededToFundInsideCeiling: Minor;
  monthlyBreakEvenRevenue: Minor;
  /** Months to recover one-time cost from net monthly benefit; null when never. */
  breakEvenMonths: number | null;
  expectedNetMonthlyBenefit: Minor;
  currentGrossMarginPct: string | null;
  projectedGrossMarginPct: string | null;
  grossMarginWithinTarget: boolean | null;
  reserveCoverageMonths: string | null;
  reserveOk: boolean;
  verdict: "affordable" | "conditional" | "not_recommended";
  reasons: string[];
}

const fmt = (d: Decimal | null) => (d ? d.toDecimalPlaces(1).toString() : null);
const ratio = (a: Minor, b: Minor) => (b > 0 ? new Decimal(a).div(b).mul(100) : null);

/**
 * Evaluates a proposed recurring expense or hire against the current month's
 * finances. Having money in the growth envelope is never sufficient on its own:
 * the proposal has to earn its place through revenue, capacity or margin.
 */
export function evaluateInvestment(snap: MonthSnapshot, settings: Settings, input: InvestmentInput): InvestmentEvaluation {
  const revenue = snap.revenue.netDistributable;
  const opexActual = snap.expenses.overheadActual;
  const isOverhead = input.costType === "overhead";
  const newOpexActual = isOverhead ? opexActual + input.monthlyCost : opexActual;
  const newRevenue = revenue + input.expectedAdditionalRevenue;
  const growthEnv = snap.envelopes.find((e) => e.bucket === "growth")?.balance ?? 0;
  const opexPct = new Decimal(snap.policy.opexPct);
  const revenueNeeded = opexPct.gt(0) ? new Decimal(input.monthlyCost).div(opexPct).mul(100).toDecimalPlaces(0).toNumber() : 0;
  const netBenefit = input.expectedAdditionalRevenue - input.monthlyCost;
  const breakEvenMonths = input.oneTimeCost > 0 ? (netBenefit > 0 ? Math.ceil(input.oneTimeCost / netBenefit) : null) : netBenefit >= 0 ? 0 : null;

  const direct = snap.expenses.directDeliveryActual;
  const newDirect = isOverhead ? direct : direct + input.monthlyCost;
  const currentGm = ratio(revenue - direct, revenue);
  const projectedGm = ratio(newRevenue - newDirect, newRevenue);
  const gmMin = new Decimal(settings.targetGrossMarginMinPct);
  const grossMarginWithinTarget = projectedGm ? projectedGm.gte(gmMin) : null;

  const coverage = snap.reserve.coverageMonths ? new Decimal(snap.reserve.coverageMonths) : null;
  const reserveOk = coverage ? coverage.gte(1) : false;

  const remaining = snap.expenses.remainingAllowance;
  const fitsInRemainingAllowance = isOverhead && input.bucket === "opex" ? input.monthlyCost <= remaining : true;
  const fitsInGrowthBudget = input.bucket === "growth" ? input.monthlyCost <= Math.max(growthEnv, snap.allocations.growth) : true;

  const reasons: string[] = [];
  let score = 0;
  if (input.type === "hire") {
    if (input.deliveryCapacity <= 0 && input.expectedAdditionalRevenue <= 0) {
      reasons.push("No additional revenue or delivery capacity is attached to this hire. A hire must be justified by what it lets you earn or deliver, not by available cash.");
      score -= 2;
    }
    if (!reserveOk) {
      reasons.push(`Reserves cover ${snap.reserve.coverageMonths ?? "0"} month(s) of essential costs. Build at least one month before committing to payroll.`);
      score -= 1;
    } else reasons.push("Reserve coverage is at least one month.");
    if (grossMarginWithinTarget === false) {
      reasons.push(`Projected gross margin ${fmt(projectedGm)}% falls below your ${settings.targetGrossMarginMinPct}% target.`);
      score -= 1;
    } else if (grossMarginWithinTarget) reasons.push(`Projected gross margin ${fmt(projectedGm)}% stays inside target.`);
    if (netBenefit > 0) {
      reasons.push(`Expected net monthly benefit is positive.`);
      score += 1;
    } else {
      reasons.push("Expected additional revenue does not cover the monthly cost.");
      score -= 1;
    }
  } else {
    if (input.bucket === "opex") {
      if (fitsInRemainingAllowance) {
        reasons.push("Fits inside this month's remaining operating allowance.");
        score += 1;
      } else {
        reasons.push(`Exceeds the remaining operating allowance by ${new Decimal(input.monthlyCost - remaining).div(100).toFixed(2)} USD. Revenue of about ${new Decimal(revenueNeeded).div(100).toFixed(0)} USD/month would be needed to carry it inside the ${snap.policy.opexPct}% ceiling.`);
        score -= 1;
      }
    } else {
      if (fitsInGrowthBudget) reasons.push("Fits inside the growth budget, but that alone is not a reason to approve.");
      else {
        reasons.push("Exceeds the growth envelope and this month's growth allocation.");
        score -= 1;
      }
    }
    if (input.expectedAdditionalRevenue > 0 && netBenefit > 0) {
      reasons.push(`Expected to add more revenue than it costs (break-even ${breakEvenMonths ?? 0} month(s)).`);
      score += 1;
    } else if (input.expectedAdditionalRevenue === 0) {
      reasons.push("No expected revenue benefit documented. Treat it as pure overhead and keep it inside the ceiling.");
    } else {
      reasons.push("Expected revenue does not cover the cost; this is a net drain.");
      score -= 1;
    }
    const newRatio = ratio(newOpexActual, revenue);
    if (newRatio && newRatio.gt(opexPct)) {
      reasons.push(`Operating expense ratio would rise to ${fmt(newRatio)}% against a ${snap.policy.opexPct}% ceiling.`);
      score -= 1;
    }
  }

  const verdict: InvestmentEvaluation["verdict"] = score >= 1 ? "affordable" : score === 0 ? "conditional" : "not_recommended";

  return {
    currentMonthlyRevenue: revenue,
    currentOpexActual: opexActual,
    currentOpexRatioPct: fmt(ratio(opexActual, revenue)),
    newMonthlyCost: input.monthlyCost,
    newOpexActual,
    newOpexRatioPct: fmt(ratio(newOpexActual, revenue)),
    newOpexRatioWithRevenuePct: fmt(ratio(newOpexActual, newRevenue)),
    opexCeiling: snap.expenses.ceiling,
    remainingAllowance: remaining,
    fitsInRemainingAllowance,
    growthEnvelopeBalance: growthEnv,
    growthMonthlyBudget: snap.allocations.growth,
    fitsInGrowthBudget,
    revenueNeededToFundInsideCeiling: revenueNeeded,
    monthlyBreakEvenRevenue: input.monthlyCost,
    breakEvenMonths,
    expectedNetMonthlyBenefit: netBenefit,
    currentGrossMarginPct: fmt(currentGm),
    projectedGrossMarginPct: fmt(projectedGm),
    grossMarginWithinTarget,
    reserveCoverageMonths: snap.reserve.coverageMonths,
    reserveOk,
    verdict,
    reasons,
  };
}
