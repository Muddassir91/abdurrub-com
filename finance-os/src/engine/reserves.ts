import Decimal from "decimal.js";
import type { Settings } from "@/db/schema";
import { addMonths } from "@/lib/dates";
import { ratioPct, type Minor } from "@/lib/money";
import type { ReserveMetrics } from "./types";

/**
 * Business cash reserve coverage.
 *   Reserve Coverage = Available Business Reserves / Average Monthly Essential Operating Costs
 */
export function computeReserve(month: string, balance: Minor, fundedBalance: Minor, essentialMonthly: Minor, monthlyContribution: Minor, settings: Settings): ReserveMetrics {
  const targetMonths = settings.reserveTargetMonths;
  const target = new Decimal(essentialMonthly).mul(targetMonths).toDecimalPlaces(0).toNumber();
  const pctOfTarget = target > 0 ? ratioPct(balance, target)?.toDecimalPlaces(1).toString() ?? null : null;
  const coverageMonths = essentialMonthly > 0 ? new Decimal(balance).div(essentialMonthly).toDecimalPlaces(1).toString() : null;
  let monthsToTarget: number | null = null;
  let projectedTargetDate: string | null = null;
  if (target > 0 && balance >= target) {
    monthsToTarget = 0;
    projectedTargetDate = `${month}-01`;
  } else if (target > 0 && monthlyContribution > 0) {
    monthsToTarget = Math.ceil((target - balance) / monthlyContribution);
    projectedTargetDate = `${addMonths(month, monthsToTarget)}-01`;
  }
  return { balance, fundedBalance, essentialMonthly, targetMonths, target, pctOfTarget, coverageMonths, monthlyContribution, projectedTargetDate, monthsToTarget };
}
