"use client";

import React, { useMemo, useState } from "react";
import { CheckCircle2, Circle, Lock, Unlock, FileText, Download } from "lucide-react";
import type { MonthClose } from "@/db/schema";
import { useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { Money, Pct } from "@/components/Money";
import { PageHeader, Card, Badge, Button, Callout, DefinitionList, Tabs, levelTone } from "@/components/ui/primitives";
import { Field, Select, Textarea } from "@/components/ui/forms";
import { Modal } from "@/components/ui/Modal";
import { AllocationTable } from "@/components/AllocationTable";
import { closeMonth, reopenMonth } from "@/db/repo";
import { buildMonthReport, CLOSE_STEPS, type MonthReport } from "@/engine/monthClose";
import { BUCKET_LABELS } from "@/lib/constants";
import { monthLabel, currentMonthKey, dateLabel } from "@/lib/dates";
import { downloadBlob } from "@/lib/csv";
import { clsx } from "clsx";

export default function MonthEndPage() {
  const { data, snapshot, mutate, month, today } = useReady();
  const toast = useToast();
  const [tab, setTab] = useState<"close" | "reports">("close");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [disposition, setDisposition] = useState<"operating" | "reserve" | "profit">("operating");
  const [notes, setNotes] = useState("");
  const [viewing, setViewing] = useState<MonthClose | null>(null);
  const existingClose = data.monthCloses.find((c) => c.month === month);
  const isClosed = existingClose?.status === "closed";
  const isFuture = month > currentMonthKey();
  const isCurrent = month === currentMonthKey();
  const report = useMemo(() => buildMonthReport(data, month, today, snapshot.expenses.unspentAllowance > 0 ? { amount: snapshot.expenses.unspentAllowance, to: disposition } : null), [data, month, today, disposition, snapshot.expenses.unspentAllowance]);
  const allChecked = CLOSE_STEPS.every((s) => checked[s.key]);
  const rev = snapshot.revenue;
  const ex = snapshot.expenses;

  const stepDetail: Record<string, React.ReactNode> = {
    revenue: <DefinitionList items={[{ label: "Collected", value: <Money cents={rev.collected} /> }, { label: "Earned (accrual)", value: <Money cents={rev.grossEarned} /> }, { label: "Invoiced", value: <Money cents={rev.invoiced} /> }, { label: "Still outstanding", value: <Money cents={rev.outstandingReceivables} /> }]} />,
    fees: <DefinitionList items={[{ label: "Processing", value: <Money cents={rev.processingFees} /> }, { label: "Conversion", value: <Money cents={rev.conversionFees} /> }, { label: "Platform", value: <Money cents={rev.platformFees} /> }, { label: "Payout", value: <Money cents={rev.payoutFees} /> }, { label: "Total fees", value: <Money cents={rev.totalFees} className="font-semibold" /> }]} />,
    reversals: <DefinitionList items={[{ label: "Refunds", value: <Money cents={rev.refunds} /> }, { label: "Chargebacks", value: <Money cents={rev.chargebacks} /> }, { label: "Net distributable revenue", value: <Money cents={rev.netDistributable} className="font-semibold" /> }, { label: "Allocatable (after reserve holds/releases)", value: <Money cents={rev.allocatable} /> }]} />,
    opex: <DefinitionList items={[{ label: "Ceiling", value: <Money cents={ex.ceiling} /> }, { label: "Overhead actual", value: <Money cents={ex.overheadActual} /> }, { label: "Direct delivery", value: <Money cents={ex.directDeliveryActual} /> }, { label: "Growth spend", value: <Money cents={ex.growthActual} /> }, { label: "Opex ratio", value: <Pct value={ex.opexRatioPct} /> }, { label: "Committed subscriptions", value: <Money cents={ex.committedSubscriptionsMonthly} />, hint: "If this is higher than overhead actual, some renewals may be missing from the ledger." }]} />,
    owner: <DefinitionList items={[{ label: "Owner compensation target", value: <Money cents={snapshot.owner.target} /> }, { label: "Drawn", value: <Money cents={snapshot.owner.drawn} /> }, { label: "Household spent", value: <Money cents={snapshot.owner.householdActual} /> }, { label: "Discretionary spent", value: <Money cents={snapshot.owner.discretionaryActual} /> }]} />,
    profit: <DefinitionList items={[{ label: "Gross profit / margin", value: <><Money cents={ex.grossProfit} /> · <Pct value={ex.grossMarginPct} /></> }, { label: "Operating result", value: <Money cents={ex.operatingResult} tone="auto" /> }, { label: "Net result after owner pay", value: <Money cents={ex.netResultAfterOwnerPay} tone="auto" className="font-semibold" /> }, { label: "Profit allocation (target)", value: <Money cents={snapshot.allocations.profit} /> }]} />,
    reserves: (
      <div className="space-y-3">
        <DefinitionList items={[{ label: "Reserve allocation this month", value: <Money cents={snapshot.allocations.reserve} /> }, { label: "Reserve envelope after close", value: <Money cents={snapshot.reserve.balance + snapshot.allocations.reserve + (disposition === "reserve" ? ex.unspentAllowance : 0)} /> }, { label: "Target", value: <Money cents={snapshot.reserve.target} /> }]} />
        {ex.unspentAllowance > 0 && (
          <Field label={<>Unspent operating allowance: <Money cents={ex.unspentAllowance} />. Where should it go?</>} hint="An explicit decision. It is never treated as income.">
            <Select value={disposition} onChange={(e) => setDisposition(e.target.value as typeof disposition)}>
              <option value="operating">Keep in operating envelope (business cash)</option>
              <option value="reserve">Move to business cash reserve</option>
              <option value="profit">Move to business profit</option>
            </Select>
          </Field>
        )}
      </div>
    ),
    tax: <DefinitionList items={[{ label: "Tax allocation this month", value: <Money cents={snapshot.allocations.tax} /> }, { label: "Tax envelope after close", value: <Money cents={snapshot.tax.envelopeBalance + snapshot.allocations.tax} /> }, { label: "Funded in tax account", value: <Money cents={snapshot.tax.fundedBalance} /> }]} />,
    clients: snapshot.clients.length === 0 ? <p className="text-xs text-fg-faint">No clients with activity.</p> : <DefinitionList items={snapshot.clients.map((c) => ({ label: `${c.name} (${c.sharePct ?? "0"}%)`, value: <><Money cents={c.earned || c.collected} /> earned · <Money cents={c.associatedExpenses} /> costs · <Pct value={c.marginPct} digits={0} /></> }))} />,
    report: <p className="text-xs text-fg-muted">Closing books the allocations above into the virtual envelopes, saves the report and locks every transaction in {monthLabel(month)}. You can reopen later; reopening withdraws the booked allocations until you close again.</p>,
  };

  const doClose = () => {
    try {
      mutate((db) => closeMonth(db, month, snapshot.allocations, JSON.stringify(report), JSON.stringify(checked), report.unspentOpexDisposition, notes || undefined));
      toast.success(`${monthLabel(month)} closed`, "Allocations booked to envelopes and the month is locked.");
      setChecked({});
      setTab("reports");
    } catch (e) {
      toast.error("Could not close", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <PageHeader title="Month-end closing & reports" description="Reconcile, decide what happens to unspent allowance, then close. Closed months are immutable until explicitly reopened." />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: "close", label: `Close ${monthLabel(month)}` }, { value: "reports", label: "Reports", count: data.monthCloses.length }]} />

      {tab === "close" && (
        <>
          {isClosed ? (
            <Card title={`${monthLabel(month)} is closed`} subtitle={`Closed ${dateLabel(existingClose!.closedAt.slice(0, 10))}`} actions={<><Button onClick={() => setViewing(existingClose!)}><FileText size={14} /> View report</Button><Button variant="danger" onClick={() => { mutate((db) => reopenMonth(db, month)); toast.info("Month reopened", "Booked allocations were withdrawn; close again when done."); }}><Unlock size={14} /> Reopen</Button></>}>
              <AllocationTable snap={snapshot} />
            </Card>
          ) : isFuture ? (
            <Callout tone="neutral">You cannot close a future month.</Callout>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-3 lg:col-span-2">
                {isCurrent && <Callout tone="caution" title="This month is still in progress">You can close it now, but transactions dated later this month will be blocked until you reopen. Most people close on the 1st of the following month.</Callout>}
                {existingClose?.status === "reopened" && <Callout tone="info">This month was reopened on {dateLabel(existingClose.reopenedAt?.slice(0, 10))}. Closing again re-books allocations with current figures.</Callout>}
                {CLOSE_STEPS.map((s, i) => (
                  <div key={s.key} className={clsx("rounded-xl border bg-surface p-4 shadow-card", checked[s.key] ? "border-positive/40" : "border-border")}>
                    <button className="flex w-full items-start gap-3 text-left" onClick={() => setChecked((c) => ({ ...c, [s.key]: !c[s.key] }))}>
                      {checked[s.key] ? <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-positive" /> : <Circle size={20} className="mt-0.5 shrink-0 text-fg-faint" />}
                      <div className="flex-1">
                        <div className="text-sm font-semibold">{i + 1}. {s.title}</div>
                        <div className="text-xs text-fg-muted">{s.hint}</div>
                      </div>
                    </button>
                    <div className="mt-3 pl-8">{stepDetail[s.key]}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-4">
                <Card title="Allocations to book" subtitle="Credited to the virtual envelopes on close">
                  <DefinitionList items={(Object.keys(snapshot.allocations) as (keyof typeof snapshot.allocations)[]).map((b) => ({ label: BUCKET_LABELS[b], value: <Money cents={snapshot.allocations[b]} /> }))} />
                  <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-semibold"><span>Total</span><Money cents={rev.allocatable} /></div>
                  {report.unspentOpexDisposition && report.unspentOpexDisposition.to !== "operating" && <p className="mt-2 text-xs text-fg-muted">Plus <Money cents={report.unspentOpexDisposition.amount} /> moved from operating to {report.unspentOpexDisposition.to}.</p>}
                </Card>
                <Card title="Warnings carried into the report">
                  {report.warnings.length === 0 ? <p className="text-xs text-fg-faint">None.</p> : <ul className="space-y-1.5 text-xs">{report.warnings.map((w) => <li key={w.key} className="flex items-center gap-2"><Badge tone={levelTone[w.level]}>{w.level}</Badge>{w.title}</li>)}</ul>}
                </Card>
                <Card title="Notes for this close">
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything unusual this month." />
                  <Button className="mt-3 w-full" variant="primary" disabled={!allChecked} onClick={doClose}><Lock size={14} /> {allChecked ? `Close ${monthLabel(month)}` : `Confirm all ${CLOSE_STEPS.length} steps to close`}</Button>
                </Card>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "reports" && (
        <div className="space-y-3">
          {data.monthCloses.length === 0 && <Callout tone="neutral">No months closed yet.</Callout>}
          {data.monthCloses.slice().sort((a, b) => (a.month < b.month ? 1 : -1)).map((c) => {
            const r = JSON.parse(c.reportJson) as MonthReport;
            return (
              <Card key={c.id} title={<span className="flex items-center gap-2">{monthLabel(c.month, "long")} <Badge tone={c.status === "closed" ? "positive" : "caution"}>{c.status}</Badge></span>} subtitle={`Closed ${dateLabel(c.closedAt.slice(0, 10))}${c.notes ? ` · ${c.notes}` : ""}`} actions={<><Button size="sm" onClick={() => setViewing(c)}><FileText size={13} /> Open</Button><Button size="sm" variant="ghost" onClick={() => downloadBlob(`report-${c.month}.json`, c.reportJson, "application/json")}><Download size={13} /></Button></>}>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
                  <Mini label="Net revenue" value={<Money cents={r.revenue.netDistributable} />} />
                  <Mini label="Overhead" value={<Money cents={r.expenses.overheadActual} />} />
                  <Mini label="Owner drawn" value={<Money cents={r.owner.drawn} />} />
                  <Mini label="Result" value={<Money cents={r.expenses.netResultAfterOwnerPay} tone="auto" />} />
                  <Mini label="Tax set aside" value={<Money cents={r.allocations.tax} />} />
                  <Mini label="Warnings" value={r.warnings.length} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {viewing && <ReportModal close={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="text-[11px] text-fg-muted">{label}</div><div className="tabular font-medium">{value}</div></div>;
}

function ReportModal({ close, onClose }: { close: MonthClose; onClose: () => void }) {
  const r = JSON.parse(close.reportJson) as MonthReport;
  return (
    <Modal open onClose={onClose} title={`Monthly financial report · ${monthLabel(r.month, "long")}`} description={`Generated ${new Date(r.generatedAt).toLocaleString()}`} size="xl" footer={<><Button onClick={() => downloadBlob(`report-${r.month}.json`, close.reportJson, "application/json")}><Download size={14} /> Download JSON</Button><Button variant="primary" onClick={onClose}>Close</Button></>}>
      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Revenue"><DefinitionList items={[{ label: "Earned", value: <Money cents={r.revenue.grossEarned} /> }, { label: "Invoiced", value: <Money cents={r.revenue.invoiced} /> }, { label: "Collected", value: <Money cents={r.revenue.collected} /> }, { label: "Refunds + chargebacks", value: <Money cents={r.revenue.refunds + r.revenue.chargebacks} /> }, { label: "Fees", value: <Money cents={r.revenue.totalFees} /> }, { label: "Net distributable", value: <Money cents={r.revenue.netDistributable} className="font-semibold" /> }, { label: "Outstanding receivables", value: <Money cents={r.revenue.outstandingReceivables} /> }]} /></Section>
        <Section title="Expenses & profit"><DefinitionList items={[{ label: "Overhead (ceiling)", value: <><Money cents={r.expenses.overheadActual} /> <span className="text-xs text-fg-faint">/ <Money cents={r.expenses.ceiling} /></span></> }, { label: "Direct delivery", value: <Money cents={r.expenses.directDeliveryActual} /> }, { label: "Growth investments", value: <Money cents={r.expenses.growthActual} /> }, { label: "Gross margin", value: <Pct value={r.expenses.grossMarginPct} /> }, { label: "Operating margin", value: <Pct value={r.expenses.operatingMarginPct} /> }, { label: "Net result after owner pay", value: <Money cents={r.expenses.netResultAfterOwnerPay} tone="auto" className="font-semibold" /> }]} /></Section>
        <Section title="Owner compensation"><DefinitionList items={[{ label: "Target", value: <Money cents={r.owner.target} /> }, { label: "Drawn", value: <Money cents={r.owner.drawn} /> }, { label: "Household", value: <Money cents={r.owner.householdActual} /> }, { label: "Discretionary", value: <Money cents={r.owner.discretionaryActual} /> }, { label: "Personal savings", value: <Money cents={r.owner.personalSavings} tone="auto" /> }]} /></Section>
        <Section title="Tax, reserve & growth"><DefinitionList items={[{ label: "Tax allocation", value: <Money cents={r.allocations.tax} /> }, { label: "Tax envelope", value: <Money cents={r.tax.envelopeBalance} /> }, { label: "Reserve allocation", value: <Money cents={r.allocations.reserve} /> }, { label: "Reserve balance / target", value: <><Money cents={r.reserve.balance} /> / <Money cents={r.reserve.target} /></> }, { label: "Growth allocation", value: <Money cents={r.allocations.growth} /> }, { label: "Unspent operating allowance", value: <>{r.unspentOpexDisposition ? <><Money cents={r.unspentOpexDisposition.amount} /> → {r.unspentOpexDisposition.to}</> : <Money cents={0} />}</> }]} /></Section>
        <Section title="Budget variances">
          <table className="w-full text-xs"><thead><tr className="text-left text-fg-muted"><th className="py-1">Category</th><th className="py-1 text-right">Target</th><th className="py-1 text-right">Actual</th><th className="py-1 text-right">Variance</th></tr></thead><tbody>{r.variances.map((v) => <tr key={v.bucket} className="border-t border-border"><td className="py-1">{v.label}</td><td className="tabular py-1 text-right"><Money cents={v.target} /></td><td className="tabular py-1 text-right"><Money cents={v.actual} /></td><td className="tabular py-1 text-right"><Money cents={v.variance} tone="auto" signed /></td></tr>)}</tbody></table>
        </Section>
        <Section title="Clients">{r.clients.length === 0 ? <p className="text-xs text-fg-faint">No client activity.</p> : <DefinitionList items={r.clients.map((c) => ({ label: `${c.name} · ${c.sharePct ?? "0"}%`, value: <><Money cents={c.earned || c.collected} /> · margin <Pct value={c.marginPct} digits={0} /></> }))} />}{r.concentration.largestSharePct && <p className="mt-2 text-xs text-fg-muted">Largest client: {r.concentration.largestClientName} at {r.concentration.largestSharePct}% ({r.concentration.basis}).</p>}</Section>
        <Section title="Financial warnings">{r.warnings.length === 0 ? <p className="text-xs text-fg-faint">None at close.</p> : <ul className="space-y-2 text-xs">{r.warnings.map((w) => <li key={w.key}><Badge tone={levelTone[w.level]} className="mr-1.5">{w.level}</Badge><span className="font-medium">{w.title}</span><div className="text-fg-muted">{w.action}</div></li>)}</ul>}</Section>
        <Section title="Recommendations for next month"><ul className="list-disc space-y-1 pl-4 text-xs text-fg">{r.recommendations.map((x, i) => <li key={i}>{x}</li>)}</ul></Section>
        {r.previousMonth && <Section title="Versus previous month"><DefinitionList items={[{ label: "Net revenue change", value: <Money cents={r.revenue.netDistributable - r.previousMonth.netDistributable} tone="auto" signed /> }, { label: "Overhead change", value: <Money cents={r.expenses.overheadActual - r.previousMonth.overheadActual} signed /> }, { label: "Result change", value: <Money cents={r.expenses.netResultAfterOwnerPay - r.previousMonth.netResultAfterOwnerPay} tone="auto" signed /> }]} /></Section>}
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-border p-3"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</div>{children}</div>;
}
