"use client";

import React, { useMemo, useState } from "react";
import { useReady } from "@/store/FinanceProvider";
import { Money, Pct } from "@/components/Money";
import { PageHeader, Card, Stat, Tabs, Callout } from "@/components/ui/primitives";
import { TrendLine } from "@/components/charts";
import { buildTrend, summarizeTrend, type Granularity } from "@/engine/trends";
import { dateLabel } from "@/lib/dates";

const LABELS: Record<Granularity, { tab: string; unit: string; count: number }> = {
  day: { tab: "Daily", unit: "day", count: 30 },
  week: { tab: "Weekly", unit: "week", count: 12 },
  month: { tab: "Monthly", unit: "month", count: 12 },
  year: { tab: "Yearly", unit: "year", count: 5 },
};

export default function TrendsPage() {
  const { data, today } = useReady();
  const [g, setG] = useState<Granularity>("week");
  const points = useMemo(() => buildTrend(data.transactions, g, today, LABELS[g].count), [data.transactions, g, today]);
  const summary = useMemo(() => summarizeTrend(points), [points]);
  const chart = points.map((p) => ({ label: p.label, net: p.net, spend: p.businessSpend, draws: p.ownerDraws, result: p.result, cumulative: p.cumulativeResult }));
  const hasData = points.some((p) => p.transactions > 0);
  const cur = summary.current;

  return (
    <>
      <PageHeader title="Trends & progress" description="How the business is moving by day, week, month and year. Net revenue is collected revenue after refunds and fees; result is what the business kept after spend and owner draws. Transfers never count." actions={<Tabs value={g} onChange={setG} tabs={(Object.keys(LABELS) as Granularity[]).map((k) => ({ value: k, label: LABELS[k].tab }))} />} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Net revenue this ${LABELS[g].unit}`} value={<Money cents={cur.net} />} sub={summary.netChangePct !== null ? <><Pct value={summary.netChangePct} /> vs previous {LABELS[g].unit}</> : "No previous period with data"} tone={summary.netChangePct !== null ? (Number(summary.netChangePct) >= 0 ? "positive" : "caution") : "neutral"} />
        <Stat label={`Business spend this ${LABELS[g].unit}`} value={<Money cents={cur.businessSpend} />} sub={summary.spendChangePct !== null ? <><Pct value={summary.spendChangePct} /> vs previous</> : undefined} />
        <Stat label={`Result this ${LABELS[g].unit}`} value={<Money cents={cur.result} tone="auto" />} sub={<>Owner draws <Money cents={cur.ownerDraws} /></>} />
        <Stat label={`Average net per ${LABELS[g].unit}`} value={<Money cents={summary.averageNet} />} sub={summary.bestPeriod ? <>Best: {summary.bestPeriod.label} (<Money cents={summary.bestPeriod.net} compact />)</> : "—"} />
      </div>

      {!hasData && <Callout tone="neutral" className="mt-4">No transactions in this range yet. Record client payments and expenses and the trend fills in.</Callout>}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title={`Net revenue, spend and draws per ${LABELS[g].unit}`} className="lg:col-span-2">
          <TrendLine data={chart} series={[{ key: "net", name: "Net revenue", color: "var(--chart-1)" }, { key: "spend", name: "Business spend", color: "var(--chart-3)" }, { key: "draws", name: "Owner draws", color: "var(--chart-2)" }]} height={280} />
        </Card>
        <Card title="Cumulative result" subtitle="Running total of what the business kept over the range">
          <TrendLine data={chart} series={[{ key: "cumulative", name: "Cumulative result", color: "var(--chart-6)" }]} height={280} />
        </Card>
      </div>

      <Card className="mt-4" title={`${LABELS[g].tab} breakdown`} padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wide text-fg-muted">
                <th className="px-4 py-2 text-left font-semibold">Period</th>
                <th className="px-3 py-2 text-right font-semibold">Collected</th>
                <th className="px-3 py-2 text-right font-semibold">Fees + reversals</th>
                <th className="px-3 py-2 text-right font-semibold">Net revenue</th>
                <th className="px-3 py-2 text-right font-semibold">Overhead</th>
                <th className="px-3 py-2 text-right font-semibold">Delivery</th>
                <th className="px-3 py-2 text-right font-semibold">Growth</th>
                <th className="px-3 py-2 text-right font-semibold">Owner draws</th>
                <th className="px-3 py-2 text-right font-semibold">Personal spend</th>
                <th className="px-3 py-2 text-right font-semibold">Result</th>
                <th className="px-4 py-2 text-right font-semibold">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {points
                .slice()
                .reverse()
                .map((p) => (
                  <tr key={p.key} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2 font-medium">
                      {p.label}
                      {g !== "day" && <div className="text-[11px] text-fg-faint">{dateLabel(p.start)} to {dateLabel(p.end)}</div>}
                    </td>
                    <td className="tabular px-3 py-2 text-right"><Money cents={p.collected} /></td>
                    <td className="tabular px-3 py-2 text-right text-fg-muted">−<Money cents={p.fees + p.reversals} /></td>
                    <td className="tabular px-3 py-2 text-right font-medium"><Money cents={p.net} /></td>
                    <td className="tabular px-3 py-2 text-right"><Money cents={p.overhead} /></td>
                    <td className="tabular px-3 py-2 text-right"><Money cents={p.direct} /></td>
                    <td className="tabular px-3 py-2 text-right"><Money cents={p.growth} /></td>
                    <td className="tabular px-3 py-2 text-right"><Money cents={p.ownerDraws} /></td>
                    <td className="tabular px-3 py-2 text-right text-fg-muted"><Money cents={p.personalSpend} /></td>
                    <td className="tabular px-3 py-2 text-right"><Money cents={p.result} tone="auto" /></td>
                    <td className="tabular px-4 py-2 text-right font-medium"><Money cents={p.cumulativeResult} tone="auto" /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
