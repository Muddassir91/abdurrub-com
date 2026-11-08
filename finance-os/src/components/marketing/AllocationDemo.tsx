"use client";

import React, { useMemo, useState } from "react";
import { clsx } from "clsx";
import { computeAllocations } from "@/engine/allocation";
import { BUCKETS, BUCKET_LABELS, type Bucket } from "@/lib/constants";
import { formatMoney } from "@/lib/money";

const PCTS = { opex: "25", owner: "35", tax: "15", profit: "10", reserve: "10", growth: "5" } as const;
const STEPS = [200000, 400000, 600000, 800000, 1000000, 1500000, 2000000, 3000000, 5000000, 10000000, 20000000, 40000000];
const COLORS: Record<Bucket, string> = { opex: "#f59e0b", owner: "#4f46e5", tax: "#64748b", profit: "#22c55e", reserve: "#0ea5a4", growth: "#ec4899" };
const WHAT: Record<Bucket, string> = {
  opex: "the most you spend on tools and overhead",
  owner: "what you pay yourself, household first",
  tax: "set aside before you can miss it",
  profit: "kept, not reinvested by accident",
  reserve: "your cushion for a slow month",
  growth: "for hires, tools and new channels",
};

/** Live demo of the allocation engine: move the slider, every number recalculates with the real code the app uses. */
export function AllocationDemo() {
  const [step, setStep] = useState(1); // $4,000
  const [spend, setSpend] = useState(83100);
  const revenue = STEPS[step];
  const alloc = useMemo(() => computeAllocations(revenue, PCTS), [revenue]);
  const unspent = Math.max(0, alloc.opex - spend);
  const over = Math.max(0, spend - alloc.opex);
  const usd = (c: number) => formatMoney(c, "USD", { decimals: 0 });

  return (
    <div className="rounded-3xl border border-border bg-surface p-5 shadow-[0_30px_80px_-30px_rgba(16,24,40,0.35)] sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-fg-faint">Try it: money collected this month</div>
          <div className="tabular mt-1 text-4xl font-semibold tracking-tight text-fg">{usd(revenue)}</div>
        </div>
        <div className="text-right text-xs text-fg-muted">
          Every dollar gets a job.
          <br />
          Six envelopes, adding up exactly.
        </div>
      </div>
      <input type="range" min={0} max={STEPS.length - 1} step={1} value={step} onChange={(e) => setStep(Number(e.target.value))} aria-label="Monthly revenue" className="mt-5 h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-[var(--accent)]" />
      <div className="mt-1 flex justify-between text-[11px] text-fg-faint">
        <span>$2k</span>
        <span>$10k</span>
        <span>$50k</span>
        <span>$400k</span>
      </div>

      {/* Stacked bar */}
      <div className="mt-6 flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
        {BUCKETS.map((b) => (
          <div key={b} style={{ width: `${PCTS[b]}%`, background: COLORS[b] }} className="h-full transition-all" title={BUCKET_LABELS[b]} />
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BUCKETS.map((b) => (
          <div key={b} className="rounded-2xl border border-border bg-surface-2/50 p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[b] }} />
              {BUCKET_LABELS[b]} · {PCTS[b]}%
            </div>
            <div className="tabular mt-1.5 text-2xl font-semibold text-fg">{usd(alloc[b])}</div>
            <div className="mt-0.5 text-[11px] text-fg-faint">{WHAT[b]}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-dashed border-border-strong p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-fg">
            <span className="font-medium">Your actual tool spend:</span> <span className="tabular">{usd(spend)}</span>
          </div>
          <input type="range" min={0} max={Math.max(alloc.opex * 1.5, 100000)} step={1000} value={Math.min(spend, Math.max(alloc.opex * 1.5, 100000))} onChange={(e) => setSpend(Number(e.target.value))} aria-label="Actual operating spend" className="h-2 w-full max-w-xs cursor-pointer appearance-none rounded-full bg-surface-2 accent-[var(--accent)]" />
        </div>
        <p className={clsx("mt-2 text-sm", over > 0 ? "text-critical" : "text-fg-muted")}>
          {over > 0 ? <>You are {usd(over)} over the operating ceiling. That money is coming out of owner pay, tax or reserves. CFoh! tells you the day it happens, not at month end.</> : <>{usd(unspent)} of the operating ceiling is unspent. It stays in business cash. It is not a reason to buy another tool, and it is not personal income.</>}
        </p>
      </div>
    </div>
  );
}
