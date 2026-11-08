"use client";

import React, { useMemo, useState } from "react";
import { ArrowRightLeft, Banknote } from "lucide-react";
import { useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { Money, Pct } from "@/components/Money";
import { PageHeader, Card, Progress, Button, Callout, DefinitionList, Badge } from "@/components/ui/primitives";
import { Field, Input, Select, MoneyInput } from "@/components/ui/forms";
import { Modal } from "@/components/ui/Modal";
import { TransactionForm } from "@/components/TransactionForm";
import { TrendLine } from "@/components/charts";
import { reassignEnvelope, updateSettings } from "@/db/repo";
import { monthlySeries } from "@/engine/snapshot";
import { BUCKETS, BUCKET_LABELS, type Bucket } from "@/lib/constants";
import { lastNMonths, monthLabel, dateLabel } from "@/lib/dates";

export default function ReservesPage() {
  const { data, snapshot, mutate, month, today } = useReady();
  const toast = useToast();
  const [reassign, setReassign] = useState(false);
  const [distribute, setDistribute] = useState(false);
  const [targetMonths, setTargetMonths] = useState(data.settings.reserveTargetMonths);
  const res = snapshot.reserve;
  const profit = snapshot.profit;
  const tax = snapshot.tax;
  const env = Object.fromEntries(snapshot.envelopes.map((e) => [e.bucket, e])) as Record<Bucket, (typeof snapshot.envelopes)[number]>;
  const series = useMemo(() => monthlySeries(data, lastNMonths(month, 12), today).map((s) => ({ label: monthLabel(s.month), profit: s.profit, net: s.net })), [data, month, today]);
  const entries = data.allocationEntries.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 15);

  return (
    <>
      <PageHeader
        title="Profit, reserves & tax"
        description="Three separate envelopes. Profit is retained earnings you may distribute; the cash reserve is insurance; tax is money that is not yours. Bank balance is not profit."
        actions={
          <>
            <Button onClick={() => setReassign(true)}><ArrowRightLeft size={14} /> Reassign between envelopes</Button>
            <Button variant="primary" onClick={() => setDistribute(true)} disabled={profit.availableForDistribution <= 0}><Banknote size={14} /> Distribute profit</Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Business profit" subtitle={`${snapshot.policy.profitPct}% allocation · kept separate from reserves`}>
          <div className="tabular text-2xl font-semibold"><Money cents={profit.cumulativeRetained} /></div>
          <div className="text-xs text-fg-muted">cumulative retained profit (envelope)</div>
          <DefinitionList
            className="mt-3"
            items={[
              { label: `Profit allocation ${monthLabel(month)}`, value: <Money cents={profit.target} /> },
              { label: "Actual result after owner pay", value: <Money cents={profit.monthlyActual} tone="auto" />, hint: "Net revenue − delivery − overhead − growth − owner draws." },
              { label: "Profit margin", value: <Pct value={profit.marginPct} /> },
              { label: "Distributed to date", value: <Money cents={profit.distributed} /> },
              { label: "Available for distribution", value: <span className="font-semibold"><Money cents={profit.availableForDistribution} /></span> },
              { label: "Funded in profit account", value: <Money cents={env.profit.fundedBalance ?? 0} /> },
            ]}
          />
        </Card>

        <Card title="Business cash reserve" subtitle={`${snapshot.policy.reservePct}% allocation · target ${res.targetMonths} months of essential costs`}>
          <div className="flex items-end justify-between">
            <div>
              <div className="tabular text-2xl font-semibold"><Money cents={res.balance} /></div>
              <div className="text-xs text-fg-muted">reserve envelope · {res.coverageMonths ?? "—"} months of cover</div>
            </div>
            <Badge tone={res.essentialMonthly > 0 && res.balance < res.essentialMonthly ? "critical" : Number(res.pctOfTarget ?? 0) >= 100 ? "positive" : "caution"}>{res.pctOfTarget ? `${res.pctOfTarget}% of target` : "no target yet"}</Badge>
          </div>
          <Progress className="mt-3" value={res.balance} max={res.target} tone={res.essentialMonthly > 0 && res.balance < res.essentialMonthly ? "critical" : "positive"} />
          <DefinitionList
            className="mt-3"
            items={[
              { label: "Target reserve", value: <Money cents={res.target} /> },
              { label: "Essential monthly costs", value: <Money cents={res.essentialMonthly} />, hint: "Trailing average of essential overhead, or essential subscriptions." },
              { label: "Monthly contribution (this month)", value: <Money cents={res.monthlyContribution} /> },
              { label: "Projected target date", value: res.projectedTargetDate ? dateLabel(res.projectedTargetDate) : "—", hint: "At the current monthly contribution." },
              { label: "Funded in savings account", value: <Money cents={res.fundedBalance} /> },
            ]}
          />
          <div className="mt-4 flex items-end gap-2 border-t border-border pt-3">
            <Field label="Target months" className="flex-1" hint={`Between ${data.settings.reserveMinMonths} and ${data.settings.reserveMaxMonths}`}>
              <Input inputMode="decimal" value={targetMonths} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setTargetMonths(e.target.value)} />
            </Field>
            <Button size="sm" onClick={() => { const n = Number(targetMonths); if (!(n >= 1 && n <= 12)) return toast.error("Target months must be between 1 and 12"); mutate((db) => updateSettings(db, { reserveTargetMonths: targetMonths })); toast.success("Reserve target updated"); }}>Save</Button>
          </div>
        </Card>

        <Card title="Tax reserve" subtitle={`${snapshot.policy.taxPct}% provisional allocation · estimate pending professional confirmation`}>
          <div className="tabular text-2xl font-semibold"><Money cents={tax.envelopeBalance} /></div>
          <div className="text-xs text-fg-muted">tax envelope balance</div>
          <DefinitionList
            className="mt-3"
            items={[
              { label: `Tax allocation ${monthLabel(month)}`, value: <Money cents={tax.target} /> },
              { label: "Funded in tax account", value: <Money cents={tax.fundedBalance} className={tax.fundedBalance < tax.envelopeBalance * 0.95 && tax.envelopeBalance > 0 ? "text-caution" : ""} /> },
              { label: "Tax paid this month", value: <Money cents={tax.paidThisMonth} /> },
              { label: "Tax paid to date", value: <Money cents={tax.paidTotal} /> },
            ]}
          />
          <Callout tone="caution" className="mt-4">
            The percentage is a planning provision, not a computed liability. Pakistani obligations are not removed by the Wyoming LLC. See Tax & compliance for the profiles and checklist.
          </Callout>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Historical profitability" subtitle="Net result after owner pay vs net revenue, last 12 months" className="lg:col-span-2">
          <TrendLine data={series} series={[{ key: "net", name: "Net revenue", color: "var(--chart-1)" }, { key: "profit", name: "Result after owner pay", color: "var(--chart-6)" }]} height={260} />
        </Card>
        <Card title="Envelope ledger" subtitle="Latest allocation credits and reassignments" padded={false}>
          <ul className="max-h-[300px] divide-y divide-border overflow-y-auto">
            {entries.length === 0 && <li className="px-5 py-4 text-xs text-fg-faint">No allocations booked yet. Close a month to credit the envelopes.</li>}
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{BUCKET_LABELS[e.bucket as Bucket]}</div>
                  <div className="truncate text-[11px] text-fg-faint">{monthLabel(e.month)} · {e.source.replace(/_/g, " ")}{e.note ? ` · ${e.note}` : ""}</div>
                </div>
                <Money cents={e.amountUsdCents} signed tone="auto" />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {reassign && <ReassignModal onClose={() => setReassign(false)} />}
      <TransactionForm open={distribute} onClose={() => setDistribute(false)} preset={{ type: "profit_distribution", amountMinor: profit.availableForDistribution, description: `Profit distribution ${monthLabel(month)}` }} />
    </>
  );
}

function ReassignModal({ onClose }: { onClose: () => void }) {
  const { snapshot, mutate, month } = useReady();
  const toast = useToast();
  const [from, setFrom] = useState<Bucket>("opex");
  const [to, setTo] = useState<Bucket>("reserve");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const fromBal = snapshot.envelopes.find((e) => e.bucket === from)?.balance ?? 0;
  return (
    <Modal open onClose={onClose} title="Reassign between envelopes" description="An explicit decision to move virtual budget, e.g. unspent operating allowance into reserves. It does not move real cash." size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={amount <= 0 || from === to} onClick={() => { try { mutate((db) => reassignEnvelope(db, month, from, to, amount, note || `Reassigned from ${BUCKET_LABELS[from]}`)); toast.success("Envelopes updated"); onClose(); } catch (e) { toast.error("Could not reassign", e instanceof Error ? e.message : String(e)); } }}>Reassign</Button></>}>
      <div className="space-y-3">
        <Field label="From" hint={<>Balance: <Money cents={fromBal} /></>}><Select value={from} onChange={(e) => setFrom(e.target.value as Bucket)}>{BUCKETS.map((b) => <option key={b} value={b}>{BUCKET_LABELS[b]}</option>)}</Select></Field>
        <Field label="To"><Select value={to} onChange={(e) => setTo(e.target.value as Bucket)}>{BUCKETS.map((b) => <option key={b} value={b}>{BUCKET_LABELS[b]}</option>)}</Select></Field>
        <Field label="Amount (USD)"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Reason"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Unspent operating allowance" /></Field>
        {amount > fromBal && <Callout tone="caution">This takes the source envelope below zero. Allowed, but make sure that is intentional.</Callout>}
      </div>
    </Modal>
  );
}
