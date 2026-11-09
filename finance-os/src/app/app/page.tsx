"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { ArrowDownLeft, ArrowUpRight, ArrowRight, AlertTriangle, ShieldAlert, Repeat, Star, CalendarClock } from "lucide-react";
import { useReady } from "@/store/FinanceProvider";
import { Money, toDisplay, useDisplayCurrency } from "@/components/Money";
import { Card, Progress, spendTone } from "@/components/ui/primitives";
import { CategoryDonut, CATEGORY_COLORS, InOutBars, BUCKET_COLORS } from "@/components/charts";
import { useQuickAdd } from "@/components/QuickAdd";
import { buildTrend } from "@/engine/trends";
import { upcomingRenewals } from "@/engine/expenses";
import { isBusinessSpend, isPersonalSpend, isRevenue, isTwoSided } from "@/engine/ledger";
import { parseAnswers, isPersonal } from "@/onboarding/model";
import { BUCKETS, type Bucket } from "@/lib/constants";
import { monthLabel, monthRange, daysBetween, dateLabel, currentMonthKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { Transaction } from "@/db/schema";

const SPLIT_LABEL: Record<Bucket, string> = { opex: "Running costs", owner: "Your pay", tax: "Tax", profit: "Profit", reserve: "Cushion", growth: "Growth" };

export default function HomePage() {
  const { data, snapshot: snap, alerts, month, today } = useReady();
  const { open } = useQuickAdd();
  const d = useDisplayCurrency();
  const answers = useMemo(() => parseAnswers(data.settings.onboardingJson), [data.settings.onboardingJson]);
  const personal = answers ? isPersonal(answers) : false;
  const firstName = (data.settings.ownerName || "there").split(/\s+/)[0];
  const isCurrent = month === currentMonthKey();
  const { end } = monthRange(month);
  const daysLeft = isCurrent ? Math.max(0, daysBetween(today, end)) : 0;

  const rev = snap.revenue;
  const ex = snap.expenses;
  const own = snap.owner;
  const businessSpend = ex.overheadActual + ex.directDeliveryActual + ex.growthActual;
  const personalSpend = own.householdActual + own.discretionaryActual;
  const moneyIn = rev.netDistributable;
  const moneyOut = businessSpend + personalSpend;
  const kept = ex.netResultAfterOwnerPay;
  const monthRows = data.transactions.filter((t) => t.month === month);
  const empty = monthRows.length === 0;

  const expected = answers?.monthlyIncomeMinor ?? 0;
  const expectedPct = expected > 0 ? Math.min(100, Math.round((rev.collected / expected) * 100)) : null;

  // Where the money went: business and personal categories together.
  const byCategory = useMemo(() => {
    const all = [...ex.byCategory, ...own.byCategory].filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
    const top = all.slice(0, 5);
    const rest = all.slice(5).reduce((a, c) => a + c.amount, 0);
    const rows = top.map((c) => ({ name: c.name, value: toDisplay(c.amount, d), raw: c.amount }));
    if (rest > 0) rows.push({ name: "Everything else", value: toDisplay(rest, d), raw: rest });
    return rows;
  }, [ex.byCategory, own.byCategory, d]);

  const weeks = useMemo(() => buildTrend(data.transactions, "week", today, 8).map((p) => ({ label: p.label.replace("w/c ", ""), in: toDisplay(p.net, d), out: toDisplay(p.businessSpend + p.personalSpend, d) })), [data.transactions, today, d]);
  const recent = useMemo(() => data.transactions.slice(0, 6), [data.transactions]);
  const renewals = useMemo(() => upcomingRenewals(data.recurringExpenses, today, 14).slice(0, 4), [data.recurringExpenses, today]);
  const topAlerts = alerts.filter((a) => a.level !== "info").slice(0, 2);
  const householdBudget = own.householdBudget > 0 ? own.householdBudget : own.householdLinesBudget;
  const goals = answers?.goals ?? [];
  const taxShouldHave = snap.tax.envelopeBalance + snap.tax.target;

  return (
    <div className="mx-auto max-w-5xl">
      {/* Greeting + actions */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Hi {firstName}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {monthLabel(month, "long")}
            {isCurrent ? ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : snap.isClosed ? " · closed" : ""}
          </p>
        </div>
        <div className="hidden gap-2 sm:flex">
          <button type="button" onClick={() => open("in")} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 text-sm font-semibold text-fg hover:bg-surface-2">
            <ArrowDownLeft size={16} className="text-positive" /> Money in
          </button>
          <button type="button" onClick={() => open("out")} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-sm font-semibold text-accent-fg shadow-sm hover:brightness-110">
            <ArrowUpRight size={16} /> Money out
          </button>
        </div>
      </div>

      {topAlerts.length > 0 && (
        <div className="mb-4 space-y-2">
          {topAlerts.map((a) => (
            <Link key={a.key} href={a.href ?? "/app/alerts/"} className={clsx("flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm", a.level === "critical" ? "border-critical/30 bg-critical-soft" : "border-caution/30 bg-caution-soft")}>
              {a.level === "critical" ? <ShieldAlert size={16} className="mt-0.5 shrink-0 text-critical" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-caution" />}
              <span className="min-w-0 flex-1">
                <span className="font-medium text-fg">{a.title}</span>
                <span className="ml-1.5 text-fg-muted">{a.what}</span>
              </span>
              <ArrowRight size={14} className="mt-0.5 shrink-0 text-fg-faint" />
            </Link>
          ))}
        </div>
      )}

      {/* Hero: in, out, kept, and the split */}
      <section className="rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-6">
        {empty ? (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Star size={24} />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-fg">Nothing recorded for {monthLabel(month)} yet</h2>
            <p className="mt-1 max-w-sm text-sm text-fg-muted">Add the first payment that came in, or the last thing you paid for. The split, the budgets and the charts fill in from there.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => open("in")} className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg shadow-sm hover:brightness-110">
                <ArrowDownLeft size={16} /> Add money in
              </button>
              <button type="button" onClick={() => open("out")} className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-fg hover:bg-surface-2">
                <ArrowUpRight size={16} /> Add money out
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Big label="Money in" cents={moneyIn} icon={<ArrowDownLeft size={14} className="text-positive" />} sub={rev.totalFees > 0 ? <>after <Money cents={rev.totalFees} decimals={0} /> fees</> : "after fees"} />
              <Big label="Money out" cents={moneyOut} icon={<ArrowUpRight size={14} className="text-critical" />} sub={<>{personal ? "bills" : "business"} <Money cents={businessSpend} decimals={0} /> · personal <Money cents={personalSpend} decimals={0} /></>} />
              <Big label="Kept" cents={kept} tone="auto" sub={own.drawn > 0 ? <>after paying you <Money cents={own.drawn} decimals={0} /></> : "after costs and pay"} />
            </div>
            {expectedPct !== null && (
              <div className="mt-5">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-fg-muted">Collected vs a usual month</span>
                  <span className="tabular text-fg">
                    <Money cents={rev.collected} decimals={0} /> of <Money cents={expected} decimals={0} /> · {expectedPct}%
                  </span>
                </div>
                <Progress value={rev.collected} max={expected} tone={expectedPct >= 100 ? "positive" : "accent"} />
              </div>
            )}
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-fg">Where this month&rsquo;s money goes</h2>
                <Link href="/app/settings/" className="text-xs font-medium text-accent hover:underline">
                  Change split
                </Link>
              </div>
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface-2">
                {BUCKETS.map((b) => (
                  <div key={b} className="h-full bar-fill" style={{ width: `${rev.allocatable > 0 ? (snap.allocations[b] / rev.allocatable) * 100 : 0}%`, background: BUCKET_COLORS[b] }} title={`${SPLIT_LABEL[b]} ${snap.policy[`${b}Pct` as keyof typeof snap.policy]}%`} />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
                {BUCKETS.filter((b) => !(personal && b === "growth" && snap.allocations[b] === 0)).map((b) => (
                  <div key={b} className="flex items-center gap-2">
                    <span className="h-7 w-1.5 shrink-0 rounded-full" style={{ background: BUCKET_COLORS[b] }} />
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-medium text-fg-muted">
                        {SPLIT_LABEL[b]} · {String(snap.policy[`${b}Pct` as keyof typeof snap.policy])}%
                      </div>
                      <div className="tabular text-sm font-semibold text-fg">
                        <Money cents={snap.allocations[b]} decimals={0} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Budgets */}
      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <BudgetCard title={personal ? "Bills & subscriptions" : "Running costs"} spent={ex.overheadActual} budget={ex.ceiling} hint="Your ceiling this month" href="/app/expenses/" />
        <BudgetCard title="Home essentials" spent={own.householdActual} budget={householdBudget} hint="Your home budget" href="/app/personal/" />
        <BudgetCard title={personal ? "Everyday spending" : "Your pay"} spent={personal ? own.discretionaryActual : own.drawn} budget={personal ? Math.max(0, own.target - own.householdActual) : own.target} hint={personal ? "What is left for you" : "Your share this month"} href="/app/personal/" invert={!personal} />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Where it went" subtitle={`Spending by category, ${monthLabel(month)}`}>
          <div className="grid gap-4 sm:grid-cols-2 sm:items-center">
            <CategoryDonut rows={byCategory} total={byCategory.reduce((a, r) => a + r.value, 0)} currency={d.primary} />
            <ul className="space-y-2">
              {byCategory.length === 0 && <li className="text-xs text-fg-faint">Add money out and the breakdown appears here.</li>}
              {byCategory.map((r, i) => {
                const total = byCategory.reduce((a, x) => a + x.value, 0);
                return (
                  <li key={r.name} className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                    <span className="min-w-0 flex-1 truncate text-fg">{r.name}</span>
                    <span className="text-xs text-fg-faint">{total > 0 ? Math.round((r.value / total) * 100) : 0}%</span>
                    <span className="tabular w-20 text-right font-medium text-fg">{formatMoney(r.value, d.primary, { decimals: 0 })}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
        <Card title="In and out, week by week" subtitle="Last eight weeks" actions={<Link href="/app/trends/" className="text-xs font-medium text-accent hover:underline">All trends</Link>}>
          <InOutBars data={weeks} currency={d.primary} />
          <div className="mt-2 flex items-center gap-4 text-[11px] text-fg-muted">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--chart-6)]" /> In (after fees)</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--chart-3)]" /> Out (bills and personal)</span>
          </div>
        </Card>
      </section>

      {/* Set aside */}
      {!personal && (
        <section className="mt-4 grid gap-3 sm:grid-cols-3">
          <SetAside title="Tax set aside" star={goals.includes("tax_ready")} have={snap.tax.fundedBalance} want={taxShouldHave} line={<>Should be <Money cents={taxShouldHave} decimals={0} /> by month end</>} href="/app/tax/" />
          <SetAside title="Cash cushion" star={goals.includes("cushion")} have={snap.reserve.fundedBalance} want={snap.reserve.target} line={snap.reserve.coverageMonths ? <>{snap.reserve.coverageMonths} months of costs covered · target {snap.reserve.targetMonths}</> : <>Target <Money cents={snap.reserve.target} decimals={0} /></>} href="/app/reserves/" />
          <SetAside title="Profit kept" star={goals.includes("profit")} have={Math.max(0, snap.profit.cumulativeRetained)} want={Math.max(snap.profit.cumulativeRetained, snap.profit.target)} line={<>This month adds <Money cents={snap.profit.target} decimals={0} /></>} href="/app/reserves/" />
        </section>
      )}

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Recent activity" className="lg:col-span-2" padded={false} actions={<Link href="/app/transactions/" className="text-xs font-medium text-accent hover:underline">See all</Link>}>
          {recent.length === 0 ? (
            <div className="p-5 text-xs text-fg-faint">Your latest payments and spending show up here.</div>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((t) => (
                <ActivityRow key={t.id} t={t} categoryName={data.categories.find((c) => c.id === t.categoryId)?.name} />
              ))}
            </ul>
          )}
        </Card>
        <Card title="Coming up" subtitle="Next 14 days">
          {renewals.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-fg-faint">
              <CalendarClock size={14} /> No renewals due in the next two weeks.
            </div>
          ) : (
            <ul className="space-y-2.5">
              {renewals.map((r) => (
                <li key={r.id} className="flex items-center gap-2.5 text-sm">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
                    <Repeat size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-fg">{r.name}</span>
                    <span className="block text-[11px] text-fg-faint">{dateLabel(r.nextRenewalDate)}</span>
                  </span>
                  <span className="tabular font-medium text-fg">{formatMoney(r.amountMinor, r.currency as "USD")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <p className="mt-6 text-center text-[11px] text-fg-faint">CFoh! shows your own numbers so decisions are easier to see. It does not give financial, investment or tax advice.</p>
    </div>
  );
}

function Big({ label, cents, sub, icon, tone }: { label: string; cents: number; sub?: React.ReactNode; icon?: React.ReactNode; tone?: "auto" }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-xl font-semibold tracking-tight sm:text-3xl">
        <Money cents={cents} tone={tone} decimals={0} />
      </div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-fg-faint">{sub}</div>}
    </div>
  );
}

function BudgetCard({ title, spent, budget, hint, href, invert }: { title: string; spent: number; budget: number; hint: string; href: string; invert?: boolean }) {
  const left = budget - spent;
  const tone = invert ? (budget > 0 && spent >= budget ? "positive" : "accent") : spendTone(spent, budget);
  const pct = budget > 0 ? Math.round((spent / budget) * 100) : null;
  return (
    <Link href={href} className="block rounded-2xl border border-border bg-surface p-4 shadow-card transition-colors hover:bg-surface-2/60">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-fg">{title}</div>
          <div className="text-[11px] text-fg-faint">{hint}</div>
        </div>
        {pct !== null && <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone === "critical" ? "bg-critical-soft text-critical" : tone === "caution" ? "bg-caution-soft text-caution" : tone === "positive" ? "bg-positive-soft text-positive" : "bg-accent-soft text-accent")}>{pct}%</span>}
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="tabular text-xl font-semibold text-fg">
          <Money cents={spent} decimals={0} />
        </span>
        <span className="text-xs text-fg-muted">
          of <Money cents={budget} decimals={0} />
        </span>
      </div>
      <Progress className="mt-2" value={spent} max={budget} tone={tone} />
      <div className={clsx("mt-1.5 text-[11px]", !invert && left < 0 ? "text-critical" : "text-fg-muted")}>
        {budget <= 0 ? "No budget set yet" : invert ? (left > 0 ? <><Money cents={left} decimals={0} /> still to take</> : "Fully taken") : left >= 0 ? <><Money cents={left} decimals={0} /> left</> : <><Money cents={-left} decimals={0} /> over</>}
      </div>
    </Link>
  );
}

function SetAside({ title, have, want, line, href, star }: { title: string; have: number; want: number; line: React.ReactNode; href: string; star?: boolean }) {
  const pct = want > 0 ? Math.min(100, Math.round((have / want) * 100)) : 0;
  return (
    <Link href={href} className="block rounded-2xl border border-border bg-surface p-4 shadow-card transition-colors hover:bg-surface-2/60">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-fg">{title}</div>
        {star && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
            <Star size={10} /> Your goal
          </span>
        )}
      </div>
      <div className="mt-2 tabular text-xl font-semibold text-fg">
        <Money cents={have} decimals={0} />
      </div>
      <Progress className="mt-2" value={have} max={Math.max(want, 1)} tone={pct >= 100 ? "positive" : "accent"} />
      <div className="mt-1.5 text-[11px] text-fg-muted">{line}</div>
    </Link>
  );
}

function ActivityRow({ t, categoryName }: { t: Transaction; categoryName?: string }) {
  const dir = isRevenue(t) ? "in" : isBusinessSpend(t) || isPersonalSpend(t) ? "out" : isTwoSided(t) ? "move" : "fee";
  const Icon = dir === "in" ? ArrowDownLeft : dir === "out" ? ArrowUpRight : Repeat;
  const label = isPersonalSpend(t) ? "Personal" : isBusinessSpend(t) ? "Business" : dir === "in" ? "Money in" : dir === "move" ? "Transfer" : "Fee";
  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <span className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", dir === "in" ? "bg-positive-soft text-positive" : dir === "out" ? "bg-critical-soft text-critical" : "bg-surface-2 text-fg-muted")}>
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{t.description}</span>
        <span className="block truncate text-[11px] text-fg-faint">
          {dateLabel(t.date)} · {categoryName ?? label}
        </span>
      </span>
      <span className={clsx("tabular text-sm font-semibold", dir === "in" ? "text-positive" : dir === "out" ? "text-fg" : "text-fg-muted")}>
        {dir === "in" ? "+" : dir === "out" ? "−" : ""}
        <Money cents={t.amountUsdCents} />
      </span>
    </li>
  );
}
