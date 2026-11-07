import Decimal from "decimal.js";
import type { AllocationPolicy } from "@/db/schema";
import { BUCKETS, type Bucket } from "@/lib/constants";
import { allocateExact, percentagesSumTo100, type Minor } from "@/lib/money";
import type { Allocations } from "./types";

export type PolicyPercentages = Record<Bucket, string>;

export function policyPercentages(p: AllocationPolicy): PolicyPercentages {
  return { opex: p.opexPct, owner: p.ownerPct, tax: p.taxPct, profit: p.profitPct, reserve: p.reservePct, growth: p.growthPct };
}

export interface PolicyValidation {
  ok: boolean;
  total: string;
  errors: string[];
}

/** A policy is valid only when every percentage is a finite non-negative decimal and they sum to exactly 100. */
export function validatePercentages(pcts: PolicyPercentages): PolicyValidation {
  const errors: string[] = [];
  const values: Decimal[] = [];
  for (const b of BUCKETS) {
    const raw = pcts[b];
    let d: Decimal;
    try {
      d = new Decimal(raw === "" ? NaN : raw);
    } catch {
      d = new Decimal(NaN);
    }
    if (!d.isFinite()) errors.push(`${b}: "${raw}" is not a number`);
    else if (d.isNegative()) errors.push(`${b}: cannot be negative`);
    else values.push(d);
  }
  const { ok, total } = percentagesSumTo100(values);
  if (errors.length === 0 && !ok) errors.push(`Percentages add up to ${total.toString()}%, they must add up to exactly 100%`);
  return { ok: errors.length === 0 && ok, total: total.toString(), errors };
}

export function validatePolicy(p: AllocationPolicy): PolicyValidation {
  return validatePercentages(policyPercentages(p));
}

/**
 * Pick the policy for a month: the pinned policy if set, else the policy with
 * the highest revenue threshold that the month's allocatable revenue reaches,
 * else the default.
 */
export function selectPolicy(policies: AllocationPolicy[], allocatable: Minor, pinnedPolicyId?: string | null): AllocationPolicy {
  if (policies.length === 0) throw new Error("No allocation policy configured");
  if (pinnedPolicyId) {
    const pinned = policies.find((p) => p.id === pinnedPolicyId);
    if (pinned) return pinned;
  }
  const eligible = policies.filter((p) => p.appliesFromMonthlyRevenueUsdCents <= allocatable);
  if (eligible.length > 0) {
    return eligible.sort((a, b) => b.appliesFromMonthlyRevenueUsdCents - a.appliesFromMonthlyRevenueUsdCents)[0];
  }
  return policies.find((p) => p.isDefault) ?? policies.slice().sort((a, b) => a.appliesFromMonthlyRevenueUsdCents - b.appliesFromMonthlyRevenueUsdCents)[0];
}

/** Allocate a revenue base across the buckets. Parts always add up EXACTLY to the base. */
export function computeAllocations(base: Minor, pcts: PolicyPercentages): Allocations {
  const v = validatePercentages(pcts);
  if (!v.ok) throw new Error(`Invalid allocation policy: ${v.errors.join("; ")}`);
  const safeBase = Math.max(0, base);
  return allocateExact(
    safeBase,
    BUCKETS.map((b) => ({ key: b, pct: pcts[b] })),
  );
}

export function emptyAllocations(): Allocations {
  return { opex: 0, owner: 0, tax: 0, profit: 0, reserve: 0, growth: 0 };
}

export function sumAllocations(a: Allocations): Minor {
  return BUCKETS.reduce((acc, b) => acc + a[b], 0);
}
