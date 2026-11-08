"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { useReady } from "@/store/FinanceProvider";
import { Money, Pct } from "@/components/Money";
import { Card, Stat, Progress, spendTone, Badge, PageHeader, levelTone, Callout, DefinitionList } from "@/components/ui/primitives";
import { AllocationTable } from "@/components/AllocationTable";
import { AllocationDonut, RevenueExpenseChart } from "@/components/charts";
import { monthlySeries } from "@/engine/snapshot";
import { lastNMonths, monthLabel } from "@/lib/dates";

export default function DashboardPage() {
  const { data, snapshot: snap, alerts, month, today } = useReady();
  const series = useMemo(() => monthlySeries(data, lastNMonths(month, 6), today), [data, month, today]);
  const rev = snap.revenue;
  const ex = snap.expenses;
  const own = snap.owner;
  const topAlerts = alerts.slice(0, 4);
  const reserveEnvelope = snap.envelopes.find((e) => e.bucket === "reserve")!;

  return (
    <>
      <PageHeader
        title={`${monthLabel(month, "long")} overview`}
        description={
          <>
            Allocations use <strong>collected and accessible</strong> net revenue, never earned or invoiced figures. Policy: <Badge tone="accent">{snap.policy.name}</Badge>
            {snap.isClosed && (
              <>
                {" "}
                <Badge>Month closed</Badge>
              </>
            )}
          </>
        }
      />

      {/* Top summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Revenue collected" value={<Money cents={rev.collected} />} sub={<>Net distributable <Money cents={rev.netDistributable} /></>} hint="Client payments and other income actually received this month, before fees." />
        <Stat label="Available cash (bank)" value={<Money cents={snap.cash.bankBusinessCash} />} sub={<>+ <Money cents={snap.cash.processorAvailable} /> withdrawable at processor</>} hint="Sum of business bank accounts derived from the ledger. Processor balances are shown separately." />
        <Stat label="Restricted processor funds" value={<Money cents={snap.cash.processorRestricted} />} tone={snap.cash.processorRestricted > 0 ? "caution" : "neutral"} sub="Never counted as spendable" />
        <Stat label="Monthly business spend" value={<Money cents={ex.overheadActual + ex.directDeliveryActual + ex.growthActual} />} sub={<>Overhead <Money cents={ex.overheadActual} /> · Delivery <Money cents={ex.directDeliveryActual} /></>} />
        <Stat label="Owner compensation" value={<Money cents={own.target} />} sub={<>Drawn <Money cents={own.drawn} /></>} hint="35% (policy) of allocatable revenue. The amount drawn is what actually moved to your personal account." />
        <Stat label="Business profit" value={<Money cents={snap.profit.target} />} sub={<>Retained to date <Money cents={snap.profit.cumulativeRetained} /></>} hint="This month's profit allocation target. Retained profit is the virtual envelope balance booked at month closes." />
        <Stat label="Tax reserve" value={<Money cents={snap.tax.target} />} sub={<>Envelope <Money cents={snap.tax.envelopeBalance} /> · Funded <Money cents={snap.tax.fundedBalance} /></>} tone={snap.tax.fundedBalance < snap.tax.envelopeBalance * 0.95 && snap.tax.envelopeBalance > 0 ? "caution" : "neutral"} hint="Estimate pending professional confirmation." />
        <Stat label="Business cash reserve" value={<Money cents={reserveEnvelope.balance} />} sub={<>{snap.reserve.coverageMonths ?? "—"} months cover · target <Money cents={snap.reserve.target} compact /></>} tone={snap.reserve.essentialMonthly > 0 && reserveEnvelope.balance < snap.reserve.essentialMonthly ? "critical" : "neutral"} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Monthly allocation" subtitle="Target vs actual per Profit First category" className="lg:col-span-2">
          <AllocationTable snap={snap} />
          {rev.allocatableRaw !== rev.netDistributable && (
            <p className="mt-3 text-xs text-fg-faint">
              Allocatable revenue differs from net distributable because <Money cents={rev.reservesHeld} /> was held by a processor and <Money cents={rev.reservesReleased} /> was released this month.
            </p>
          )}
        </Card>
        <Card title="Allocation mix" subtitle="Where this month's net revenue is directed">
          <AllocationDonut allocations={snap.allocations} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Expense health" subtitle="Operating overhead vs the ceiling (a maximum, not a target)">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs text-fg-muted">Operating expense ratio</div>
              <div className="tabular text-2xl font-semibold">
                <Pct value={ex.opexRatioPct} />
              </div>
            </div>
            <div className="text-right text-xs text-fg-muted">
              Policy ceiling {snap.policy.opexPct}%
            </div>
          </div>
          <Progress className="mt-3" value={ex.overheadActual} max={ex.ceiling} tone={spendTone(ex.overheadActual, ex.ceiling)} />
          <DefinitionList
            className="mt-3"
            items={[
              { label: "Operating expense ceiling", value: <Money cents={ex.ceiling} /> },
              { label: "Current monthly spend", value: <Money cents={ex.overheadActual} /> },
              { label: "Remaining allowance", value: <Money cents={ex.remainingAllowance} className={ex.remainingAllowance < 0 ? "text-critical" : ""} /> },
              { label: "Committed subscriptions", value: <Money cents={ex.committedSubscriptionsMonthly} />, hint: "Active recurring overhead normalised to a monthly figure." },
            ]}
          />
          <p className="mt-3 text-[11px] text-fg-faint">Unspent allowance stays in business cash. Reassign it to reserves or profit at month-end if you want it put to work.</p>
        </Card>

        <Card title="Personal finance" subtitle="Owner compensation is the budget; household comes out first">
          <DefinitionList
            items={[
              { label: "Owner compensation target", value: <Money cents={own.target} /> },
              { label: "Household spending", value: <><Money cents={own.householdActual} /> <span className="text-xs text-fg-faint">/ <Money cents={own.householdBudget} compact /></span></> },
              { label: "Discretionary spending", value: <Money cents={own.discretionaryActual} /> },
              { label: "Discretionary available", value: <Money cents={own.discretionaryAvailable} className={own.discretionaryAvailable < 0 ? "text-critical" : ""} />, hint: "Owner compensation − actual household expenses" },
              { label: "Remaining personal budget", value: <Money cents={own.remainingPersonalBudget} className={own.remainingPersonalBudget < 0 ? "text-critical" : ""} /> },
            ]}
          />
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[11px] text-fg-muted">
              <span>Household</span>
              <span>
                <Pct value={own.householdBudget > 0 ? (own.householdActual / own.householdBudget) * 100 : null} digits={0} /> of budget
              </span>
            </div>
            <Progress value={own.householdActual} max={own.householdBudget} tone={spendTone(own.householdActual, own.householdBudget)} thin />
          </div>
        </Card>

        <Card title="Business health" subtitle="Margins, runway and concentration">
          <DefinitionList
            items={[
              { label: "Gross margin", value: <Pct value={ex.grossMarginPct} />, hint: "(Net revenue − direct delivery costs) / net revenue. Target 65–75%." },
              { label: "Operating margin", value: <Pct value={ex.operatingMarginPct} />, hint: "After overhead and growth spend, before owner pay." },
              { label: "Net result after owner pay", value: <Money cents={ex.netResultAfterOwnerPay} tone="auto" />, hint: "Accounting result. Not the same as cash in the bank." },
              { label: "Cash runway", value: snap.cash.runwayMonths ? `${snap.cash.runwayMonths} months` : "—", hint: "Business bank cash / average monthly outflow (trailing 3 months)." },
              { label: "Revenue concentration", value: snap.concentration.largestSharePct ? <><Pct value={snap.concentration.largestSharePct} digits={0} /> <span className="text-xs text-fg-faint">{snap.concentration.largestClientName}</span></> : "—" },
              { label: "Recurring monthly revenue", value: <Money cents={snap.cash.recurringMonthlyRevenue} />, hint: "Retainers + trailing 3-month average commission." },
            ]}
          />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Revenue and spending, last 6 months" className="lg:col-span-2">
          <RevenueExpenseChart data={series} />
        </Card>
        <Card title="Alerts" subtitle={alerts.length ? `${alerts.length} active` : "All clear"} actions={<Link href="/app/alerts/" className="text-xs font-medium text-accent hover:underline">View all</Link>}>
          {topAlerts.length === 0 ? (
            <Callout tone="positive" title="No alerts">
              Nothing needs your attention right now.
            </Callout>
          ) : (
            <ul className="space-y-2">
              {topAlerts.map((a) => (
                <li key={a.key} className="rounded-lg border border-border bg-surface-2/50 p-3">
                  <div className="flex items-start gap-2">
                    {a.level === "critical" ? <ShieldAlert size={14} className="mt-0.5 text-critical" /> : a.level === "caution" ? <AlertTriangle size={14} className="mt-0.5 text-caution" /> : <Info size={14} className="mt-0.5 text-info" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{a.title}</span>
                        <Badge tone={levelTone[a.level]}>{a.level}</Badge>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{a.action}</p>
                    </div>
                    {a.href && (
                      <Link href={a.href} className="text-fg-faint hover:text-accent">
                        <ArrowRight size={14} />
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="How these numbers are built" subtitle="Read once, then trust the dashboard">
        <div className="grid gap-4 text-xs text-fg-muted md:grid-cols-3">
          <div>
            <div className="font-medium text-fg">Revenue</div>
            <p className="mt-1">Net distributable = collected − refunds − chargebacks − processing, conversion, platform and payout fees. Each fee is a separate ledger row, counted once. Allocatable = net distributable − new processor holds + releases.</p>
          </div>
          <div>
            <div className="font-medium text-fg">Allocations</div>
            <p className="mt-1">The active policy splits allocatable revenue into six envelopes that add up exactly. The operating share is a ceiling; unspent allowance stays in business cash. Owner compensation funds household first, then discretionary.</p>
          </div>
          <div>
            <div className="font-medium text-fg">Cash vs budget</div>
            <p className="mt-1">Bank balances come from the ledger (opening balance ± rows). Envelopes are virtual: they fill at month close. Transfers, draws and payouts are never income or expense. Restricted processor funds are excluded until released.</p>
          </div>
        </div>
      </Card>
    </>
  );
}
