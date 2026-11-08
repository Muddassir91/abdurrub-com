"use client";

import React, { useMemo, useState } from "react";
import { useReady } from "@/store/FinanceProvider";
import { Money, Pct } from "@/components/Money";
import { PageHeader, Card, Badge, Callout, DefinitionList, Toggle } from "@/components/ui/primitives";
import { Field, MoneyInput, PercentInput, Select } from "@/components/ui/forms";
import { simulate } from "@/engine/scenarios";
import { policyPercentages, validatePercentages, type PolicyPercentages } from "@/engine/allocation";
import { BUCKETS, BUCKET_LABELS, SCENARIO_PRESETS, type Bucket } from "@/lib/constants";
import { addMonths, monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { clsx } from "clsx";

export default function ScenariosPage() {
  const { data, snapshot, snapshotFor, month } = useReady();
  const [revenue, setRevenue] = useState(1000000);
  const [custom, setCustom] = useState(false);
  const [pcts, setPcts] = useState<PolicyPercentages>(policyPercentages(snapshot.policy));
  const [usePolicy, setUsePolicy] = useState(true);
  const [opexActual, setOpexActual] = useState(snapshot.expenses.committedSubscriptionsMonthly || snapshot.expenses.overheadActual);
  const [direct, setDirect] = useState(snapshot.expenses.directDeliveryActual);
  const [horizon, setHorizon] = useState(12);

  const effectivePcts = usePolicy ? policyPercentages(snapshot.policy) : pcts;
  const validation = validatePercentages(effectivePcts);
  const result = useMemo(() => (validation.ok ? simulate({ revenue, pcts: effectivePcts, settings: data.settings, expectedOpexActual: opexActual, expectedDirectCosts: direct, months: horizon }) : null), [revenue, effectivePcts, data.settings, opexActual, direct, horizon, validation.ok]);

  const prev = snapshotFor(addMonths(month, -1));
  const next = snapshotFor(addMonths(month, 1));
  const comparison = [
    { label: `Previous (${monthLabel(prev.month)})`, alloc: prev.allocations, base: prev.revenue.allocatable, owner: prev.owner, opex: prev.expenses.overheadActual },
    { label: `Current (${monthLabel(month)})`, alloc: snapshot.allocations, base: snapshot.revenue.allocatable, owner: snapshot.owner, opex: snapshot.expenses.overheadActual },
    { label: `Forecast (${monthLabel(next.month)})`, alloc: simulate({ revenue: snapshot.cash.recurringMonthlyRevenue, pcts: policyPercentages(snapshot.policy), settings: data.settings, expectedOpexActual: snapshot.expenses.committedSubscriptionsMonthly }).allocations, base: snapshot.cash.recurringMonthlyRevenue, owner: null, opex: snapshot.expenses.committedSubscriptionsMonthly, estimate: true },
    result ? { label: `Scenario (${formatMoney(revenue, "USD", { compact: true })})`, alloc: result.allocations, base: revenue, owner: null, opex: opexActual, estimate: true } : null,
  ].filter(Boolean) as { label: string; alloc: Record<Bucket, number>; base: number; owner: typeof snapshot.owner | null; opex: number; estimate?: boolean }[];

  return (
    <>
      <PageHeader title="Scenario planning" description="See how the same allocation rules behave at different revenue levels. Household and discretionary budgets stay fixed: revenue growth builds reserves and profit, it does not automatically raise personal spending." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Inputs" className="lg:col-span-1">
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 text-xs font-medium text-fg-muted">Monthly net revenue</div>
              <div className="grid grid-cols-5 gap-1.5">
                {SCENARIO_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setRevenue(p);
                      setCustom(false);
                    }}
                    className={clsx("rounded-md border px-1 py-1.5 text-[11px] font-medium tabular", revenue === p && !custom ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface-2 text-fg-muted hover:text-fg")}
                  >
                    {formatMoney(p, "USD", { compact: true, decimals: 0 })}
                  </button>
                ))}
              </div>
              <div className="mt-2">
                <MoneyInput
                  value={revenue}
                  onChange={(v) => {
                    setRevenue(v);
                    setCustom(true);
                  }}
                  placeholder="Custom amount"
                />
              </div>
            </div>
            <Field label="Expected operating overhead at this revenue" hint="Defaults to your committed subscriptions. The allowance is a ceiling; this is what you'd actually spend.">
              <MoneyInput value={opexActual} onChange={setOpexActual} />
            </Field>
            <Field label="Expected direct delivery costs" hint="Contractors or staff working on client accounts, for the gross-margin preview.">
              <MoneyInput value={direct} onChange={setDirect} />
            </Field>
            <Field label="Horizon">
              <Select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
                {[3, 6, 12, 24, 36].map((m) => (
                  <option key={m} value={m}>
                    {m} months
                  </option>
                ))}
              </Select>
            </Field>
            <Toggle checked={usePolicy} onChange={setUsePolicy} label={`Use active policy (${snapshot.policy.name})`} />
            {!usePolicy && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                {BUCKETS.map((b) => (
                  <div key={b} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-fg-muted">{BUCKET_LABELS[b]}</span>
                    <PercentInput className="w-24" value={pcts[b]} onChange={(v) => setPcts((p) => ({ ...p, [b]: v }))} />
                  </div>
                ))}
                <div className={clsx("text-xs", validation.ok ? "text-positive" : "text-critical")}>Total {validation.total}% {validation.ok ? "✓" : "(must be 100%)"}</div>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {!result ? (
            <Callout tone="critical" title="Percentages must add up to 100%">
              {validation.errors.join("; ")}
            </Callout>
          ) : (
            <>
              <Card title={`At ${formatMoney(revenue, "USD")} per month`} subtitle="Allocation with the selected rules">
                <div className="grid gap-3 sm:grid-cols-3">
                  {BUCKETS.map((b) => (
                    <div key={b} className="rounded-lg border border-border bg-surface-2/50 p-3">
                      <div className="text-[11px] font-medium text-fg-muted">{BUCKET_LABELS[b]}</div>
                      <div className="tabular mt-1 text-lg font-semibold">
                        <Money cents={result.allocations[b]} />
                      </div>
                      <div className="text-[11px] text-fg-faint">{effectivePcts[b]}%</div>
                    </div>
                  ))}
                </div>
                <DefinitionList
                  className="mt-4"
                  items={[
                    { label: "Household budget (fixed)", value: <Money cents={result.householdBudget} /> },
                    { label: "Discretionary income", value: <><Money cents={result.discretionaryIncome} className={result.discretionaryIncome < 0 ? "text-critical" : ""} /> {result.discretionaryGoalMet && <Badge tone="positive" className="ml-2">$5k goal met</Badge>}</>, hint: "Owner compensation − household budget" },
                    { label: "Gap to discretionary goal", value: <Money cents={Math.max(0, result.discretionaryGoal - result.discretionaryIncome)} /> },
                    { label: "Operating expense ratio at this spend", value: <Pct value={result.opexRatioPct} /> },
                    { label: "Unspent operating allowance", value: <Money cents={result.unspentOpexAllowance} />, hint: "Stays in business cash." },
                    { label: "Gross margin", value: <Pct value={result.grossMarginPct} /> },
                  ]}
                />
              </Card>
              <Card title={`Projected accumulation over ${horizon} months`} subtitle="Assumes the scenario repeats every month with no new fixed costs">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-[11px] text-fg-muted">Business cash (profit + reserve + unspent allowance)</div>
                    <div className="tabular mt-1 text-lg font-semibold">
                      <Money cents={result.projectedBusinessCash} />
                    </div>
                    <div className="text-[11px] text-fg-faint">
                      <Money cents={result.monthlyBusinessCashAccumulation} /> per month
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-[11px] text-fg-muted">Tax reserve set aside</div>
                    <div className="tabular mt-1 text-lg font-semibold">
                      <Money cents={result.projectedTaxReserve} />
                    </div>
                    <div className="text-[11px] text-fg-faint">estimate pending professional confirmation</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-[11px] text-fg-muted">Owner savings</div>
                    <div className="tabular mt-1 text-lg font-semibold">
                      <Money cents={result.projectedOwnerSavings} />
                    </div>
                    <div className="text-[11px] text-fg-faint">discretionary capped at the goal</div>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      <Card className="mt-4" title="Comparison" subtitle="Previous month, current month, next-month forecast and the scenario side by side">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-fg-muted">
                <th className="py-2 pr-3 text-left font-semibold">Line</th>
                {comparison.map((c) => (
                  <th key={c.label} className="py-2 px-3 text-right font-semibold">
                    {c.label}
                    {c.estimate && <span className="ml-1 font-normal normal-case text-fg-faint">(est.)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="py-2 pr-3 font-medium">Allocatable revenue</td>
                {comparison.map((c) => (
                  <td key={c.label} className="tabular py-2 px-3 text-right">
                    <Money cents={c.base} />
                  </td>
                ))}
              </tr>
              {BUCKETS.map((b) => (
                <tr key={b} className="border-b border-border">
                  <td className="py-2 pr-3 text-fg-muted">{BUCKET_LABELS[b]}</td>
                  {comparison.map((c) => (
                    <td key={c.label} className="tabular py-2 px-3 text-right">
                      <Money cents={c.alloc[b]} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-b border-border">
                <td className="py-2 pr-3 text-fg-muted">Operating overhead (actual / expected)</td>
                {comparison.map((c) => (
                  <td key={c.label} className="tabular py-2 px-3 text-right">
                    <Money cents={c.opex} />
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-3 text-fg-muted">Household budget</td>
                {comparison.map((c) => (
                  <td key={c.label} className="tabular py-2 px-3 text-right">
                    <Money cents={c.owner ? c.owner.householdActual : data.settings.householdBudgetUsdCents} />
                    {!c.owner && <span className="ml-1 text-[10px] text-fg-faint">budget</span>}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
