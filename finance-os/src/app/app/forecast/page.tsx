"use client";

import React, { useMemo, useState } from "react";
import { useReady } from "@/store/FinanceProvider";
import { Money } from "@/components/Money";
import { PageHeader, Card, Callout, Stat, DefinitionList } from "@/components/ui/primitives";
import { Select } from "@/components/ui/forms";
import { CashProjection } from "@/components/charts";
import { buildForecast } from "@/engine/forecast";
import { invoiceOutstanding, invoiceStatus } from "@/engine/revenue";
import { monthLabel, dateLabel } from "@/lib/dates";

export default function ForecastPage() {
  const { data, snapshot, today } = useReady();
  const [months, setMonths] = useState(6);
  const forecast = useMemo(() => buildForecast(data, snapshot, months, today), [data, snapshot, months, today]);
  const chart = forecast.map((f) => ({ label: monthLabel(f.month), cash: f.projectedBankCash, inflow: f.expectedInvoiceCollections + f.expectedReserveReleases + f.projectedRecurringRevenue, outflow: f.committedSubscriptions + f.plannedOwnerComp }));
  const openInvoices = data.invoices.filter((i) => invoiceOutstanding(i, data.transactions) > 0).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const heldReserves = data.reserves.filter((r) => r.status === "held");
  const clientName = new Map(data.clients.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader
        title="Cash-flow forecast"
        description="Rolling projection from dated receivables, processor reserve releases and recurring revenue, against committed subscriptions and planned owner compensation. Every figure here is an expectation, not a fact."
        actions={
          <Select className="w-36" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {[3, 6, 9, 12].map((m) => (
              <option key={m} value={m}>
                {m} months
              </option>
            ))}
          </Select>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Starting cash (bank + processor available)" value={<Money cents={snapshot.cash.bankBusinessCash + snapshot.cash.processorAvailable} />} />
        <Stat label="Outstanding receivables" value={<Money cents={snapshot.revenue.outstandingReceivables} />} sub={<>Overdue <Money cents={snapshot.revenue.overdueReceivables} /></>} tone={snapshot.revenue.overdueReceivables > 0 ? "caution" : "neutral"} />
        <Stat label="Restricted at processor" value={<Money cents={snapshot.cash.processorRestricted} />} sub={`${heldReserves.filter((r) => !r.expectedReleaseDate).length} without release date`} />
        <Stat label={`Projected cash in ${months} months`} value={<Money cents={forecast[forecast.length - 1]?.projectedBankCash ?? 0} tone="auto" />} />
      </div>

      <Card className="mt-4" title="Projection" subtitle="Dashed lines are expected inflows and planned outflows per month">
        <CashProjection data={chart} />
      </Card>

      <Card className="mt-4" title="Month by month" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wide text-fg-muted">
                <th className="px-4 py-2 text-left font-semibold">Month</th>
                <th className="px-3 py-2 text-right font-semibold">Invoice collections</th>
                <th className="px-3 py-2 text-right font-semibold">Reserve releases</th>
                <th className="px-3 py-2 text-right font-semibold">Recurring revenue (est.)</th>
                <th className="px-3 py-2 text-right font-semibold">Subscriptions</th>
                <th className="px-3 py-2 text-right font-semibold">Owner comp (plan)</th>
                <th className="px-3 py-2 text-right font-semibold">Tax set-aside</th>
                <th className="px-3 py-2 text-right font-semibold">Net change</th>
                <th className="px-4 py-2 text-right font-semibold">Projected cash</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map((f) => (
                <tr key={f.month} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2 font-medium">{monthLabel(f.month)}</td>
                  <td className="tabular px-3 py-2 text-right"><Money cents={f.expectedInvoiceCollections} /></td>
                  <td className="tabular px-3 py-2 text-right">
                    <Money cents={f.expectedReserveReleases} />
                    {f.reserveReleasesUnknownDate > 0 && <div className="text-[10px] text-fg-faint">+<Money cents={f.reserveReleasesUnknownDate} /> undated</div>}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-fg-muted"><Money cents={f.projectedRecurringRevenue} /></td>
                  <td className="tabular px-3 py-2 text-right">−<Money cents={f.committedSubscriptions} /></td>
                  <td className="tabular px-3 py-2 text-right">−<Money cents={f.plannedOwnerComp} /></td>
                  <td className="tabular px-3 py-2 text-right text-fg-muted"><Money cents={f.plannedTaxSetAside} /></td>
                  <td className="tabular px-3 py-2 text-right"><Money cents={f.netCashChange} tone="auto" signed /></td>
                  <td className="tabular px-4 py-2 text-right font-medium"><Money cents={f.projectedBankCash} tone="auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Open invoices" subtitle="Expected collections, by due or expected payment date">
          {openInvoices.length === 0 ? (
            <Callout tone="neutral">No outstanding invoices. Earned revenue that is not yet invoiced will not appear in the forecast until you create an invoice under Clients.</Callout>
          ) : (
            <DefinitionList
              items={openInvoices.map((i) => ({
                label: (
                  <span>
                    {clientName.get(i.clientId)} · {i.number ?? i.periodMonth}
                    <span className="ml-2 text-[11px] text-fg-faint">{invoiceStatus(i, data.transactions, today) === "overdue" ? `overdue since ${dateLabel(i.dueDate)}` : `expected ${dateLabel(i.expectedPaymentDate ?? i.dueDate)}`}</span>
                  </span>
                ),
                value: <Money cents={invoiceOutstanding(i, data.transactions)} />,
              }))}
            />
          )}
        </Card>
        <Card title="Processor reserves" subtitle="Restricted funds and when they are expected back">
          {heldReserves.length === 0 ? (
            <Callout tone="neutral">No funds are currently held by a processor.</Callout>
          ) : (
            <DefinitionList items={heldReserves.map((r) => ({ label: <span>{r.reason ?? "Reserve"} <span className="ml-2 text-[11px] text-fg-faint">{r.expectedReleaseDate ? `release ${dateLabel(r.expectedReleaseDate)}` : "release date unknown"}</span></span>, value: <Money cents={r.amountUsdCents} /> }))} />
          )}
        </Card>
      </div>
      <p className="mt-4 text-xs text-fg-faint">Assumptions: recurring revenue = active retainers + trailing 3-month average commission; owner compensation and tax follow the active policy applied to each month&apos;s expected inflow; subscriptions are the active recurring expenses normalised to monthly. Reserves without a release date are not counted in any month.</p>
    </>
  );
}
