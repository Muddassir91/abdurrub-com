"use client";

import React from "react";
import { BUCKETS, BUCKET_LABELS, type Bucket } from "@/lib/constants";
import type { MonthSnapshot } from "@/engine/types";
import { Money, Pct } from "./Money";
import { Progress, spendTone } from "./ui/primitives";
import { policyPercentages } from "@/engine/allocation";

const ACTUAL_HINT: Record<Bucket, string> = {
  opex: "Overhead actually spent this month (target shown is the ceiling, a maximum, not a goal).",
  owner: "Owner draws actually transferred to the personal account this month.",
  tax: "Tax actually paid this month. Unpaid allocation accumulates in the tax envelope at month close.",
  profit: "Profit distributions actually paid out this month.",
  reserve: "Reserve money spent this month (should normally be zero).",
  growth: "Growth investments actually made this month.",
};

export function AllocationTable({ snap }: { snap: MonthSnapshot }) {
  const pcts = policyPercentages(snap.policy);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-fg-muted">
            <th className="py-2 pr-3 text-left font-semibold">Category</th>
            <th className="py-2 px-3 text-right font-semibold">Target %</th>
            <th className="py-2 px-3 text-right font-semibold">Target amount</th>
            <th className="py-2 px-3 text-right font-semibold">Actual</th>
            <th className="py-2 px-3 text-right font-semibold">Remaining</th>
            <th className="py-2 pl-3 text-left font-semibold" style={{ width: "26%" }}>
              Progress
            </th>
          </tr>
        </thead>
        <tbody>
          {BUCKETS.map((b) => {
            const target = b === "opex" ? snap.expenses.ceiling : snap.allocations[b];
            const actual = snap.actualByBucket[b];
            const remaining = target - actual;
            const tone = b === "opex" ? spendTone(actual, target) : actual > target ? "critical" : "accent";
            return (
              <tr key={b} className="border-b border-border last:border-b-0" title={ACTUAL_HINT[b]}>
                <td className="py-2.5 pr-3">
                  <div className="font-medium text-fg">{BUCKET_LABELS[b]}</div>
                  {b === "opex" && snap.expenses.ceilingSource === "override" && <div className="text-[11px] text-fg-faint">Approved ceiling override (policy: <Money cents={snap.expenses.policyCeiling} />)</div>}
                </td>
                <td className="py-2.5 px-3 text-right">
                  <Pct value={pcts[b]} digits={0} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <Money cents={target} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <Money cents={actual} />
                </td>
                <td className={`py-2.5 px-3 text-right ${remaining < 0 ? "text-critical" : ""}`}>
                  <Money cents={remaining} />
                </td>
                <td className="py-2.5 pl-3">
                  <Progress value={actual} max={target} tone={tone} thin />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="text-xs text-fg-muted">
            <td className="pt-2.5 pr-3">Total</td>
            <td className="pt-2.5 px-3 text-right">100%</td>
            <td className="pt-2.5 px-3 text-right">
              <Money cents={snap.revenue.allocatable} />
            </td>
            <td className="pt-2.5 px-3 text-right">
              <Money cents={BUCKETS.reduce((a, b) => a + snap.actualByBucket[b], 0)} />
            </td>
            <td colSpan={2} className="pt-2.5 px-3 text-right">
              based on allocatable net revenue
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
