"use client";

import React, { useMemo, useState } from "react";
import { Plus, Upload, ArrowDownToLine, Unlock, Settings2, ShieldAlert } from "lucide-react";
import type { Processor, ProcessorReserve } from "@/db/schema";
import { useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { Money, Pct } from "@/components/Money";
import { PageHeader, Card, Stat, Badge, Button, Callout, DefinitionList, Tabs } from "@/components/ui/primitives";
import { Field, Input, Select, Textarea, MoneyInput, PercentInput, Checkbox, FormRow, FormError } from "@/components/ui/forms";
import { Table, type Column } from "@/components/ui/Table";
import { Modal } from "@/components/ui/Modal";
import { recordProcessorSale, recordPayout, recordManualReserve, releaseReserve, updateReserve, updateProcessor, deleteTransactionGroup, type SaleRecordInput } from "@/db/repo";
import { computeSaleFees, computePayoutFee, reserveReleaseSchedule, type PayoutMethod } from "@/engine/processor";
import { accountBalanceUsd } from "@/engine/ledger";
import { dateLabel, monthLabel, todayKey, addMonths } from "@/lib/dates";
import { formatMoney, parseMajorToMinor } from "@/lib/money";
import { parseCsv, readFileText, pickColumn, normaliseDate } from "@/lib/csv";

export default function WhopPage() {
  const { data, mutate, month } = useReady();
  const toast = useToast();
  const processor = data.processors[0];
  const [tab, setTab] = useState<"sales" | "reserves" | "payouts" | "fees">("sales");
  const [saleOpen, setSaleOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [releasing, setReleasing] = useState<ProcessorReserve | null>(null);

  const available = data.accounts.find((a) => a.id === processor?.availableAccountId);
  const restricted = data.accounts.find((a) => a.id === processor?.restrictedAccountId);
  const availableBal = available ? accountBalanceUsd(available, data.transactions, data.settings) : 0;
  const restrictedBal = restricted ? accountBalanceUsd(restricted, data.transactions, data.settings) : 0;

  const procTx = useMemo(() => data.transactions.filter((t) => t.processorId === processor?.id), [data.transactions, processor]);
  const monthTx = procTx.filter((t) => t.month === month);
  const gross = monthTx.filter((t) => t.type === "client_payment").reduce((a, t) => a + t.amountUsdCents, 0);
  const fees = monthTx.filter((t) => ["processing_fee", "conversion_fee", "platform_fee", "payout_fee"].includes(t.type)).reduce((a, t) => a + t.amountUsdCents, 0);
  const reversals = monthTx.filter((t) => t.type === "refund" || t.type === "chargeback").reduce((a, t) => a + t.amountUsdCents, 0);
  const earned = gross - fees - reversals;
  const payouts = monthTx.filter((t) => t.type === "payout").reduce((a, t) => a + t.amountUsdCents, 0);
  const allTimeGross = procTx.filter((t) => t.type === "client_payment").reduce((a, t) => a + t.amountUsdCents, 0);
  const allTimeFees = procTx.filter((t) => ["processing_fee", "conversion_fee", "platform_fee", "payout_fee"].includes(t.type)).reduce((a, t) => a + t.amountUsdCents, 0);
  const allTimeReversals = procTx.filter((t) => t.type === "refund" || t.type === "chargeback").reduce((a, t) => a + t.amountUsdCents, 0);
  const earnedBalance = allTimeGross - allTimeFees - allTimeReversals;

  const groups = useMemo(() => {
    const map = new Map<string, typeof monthTx>();
    for (const t of procTx) {
      const k = t.groupId ?? t.id;
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return [...map.entries()]
      .map(([groupId, rows]) => ({ groupId, rows, date: rows[0].date, sale: rows.find((r) => r.type === "client_payment"), payout: rows.find((r) => r.type === "payout") }))
      .filter((g) => g.sale)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [procTx]);

  const schedule = reserveReleaseSchedule(data.reserves, month, 6);
  const heldReserves = data.reserves.filter((r) => r.processorId === processor?.id).sort((a, b) => (a.dateWithheld < b.dateWithheld ? 1 : -1));

  if (!processor) return <Callout tone="caution">No payment processor configured.</Callout>;

  const saleCols: Column<(typeof groups)[number]>[] = [
    { key: "d", header: "Date", width: "110px", render: (g) => <span className="text-fg-muted">{dateLabel(g.date)}</span> },
    { key: "desc", header: "Sale", render: (g) => <div><div className="font-medium">{g.sale!.description}</div><div className="text-[11px] text-fg-faint">{g.sale!.notes}</div></div> },
    { key: "g", header: "Gross", align: "right", render: (g) => <Money cents={g.sale!.amountUsdCents} /> },
    { key: "f", header: "Fees", align: "right", render: (g) => <span className="text-fg-muted">−<Money cents={g.rows.filter((r) => r.type.endsWith("_fee")).reduce((a, r) => a + r.amountUsdCents, 0)} /></span> },
    { key: "r", header: "Reserve held", align: "right", render: (g) => <Money cents={g.rows.filter((r) => r.type === "reserve_hold").reduce((a, r) => a + r.amountUsdCents, 0)} /> },
    { key: "n", header: "Net available", align: "right", render: (g) => <span className="font-medium"><Money cents={g.sale!.amountUsdCents - g.rows.filter((r) => r.type.endsWith("_fee") || r.type === "reserve_hold").reduce((a, r) => a + r.amountUsdCents, 0)} /></span> },
    { key: "x", header: "", align: "right", width: "60px", render: (g) => (g.sale!.groupId ? <button className="text-[11px] text-fg-faint hover:text-critical" onClick={() => { try { mutate((db) => deleteTransactionGroup(db, g.sale!.groupId!)); toast.success("Sale batch removed"); } catch (e) { toast.error("Could not delete", e instanceof Error ? e.message : String(e)); } }}>Delete</button> : null) },
  ];

  return (
    <>
      <PageHeader
        title={processor.name}
        description="Each sale is recorded with its own fee lines, so fees are never assumed uniform and never counted twice. Restricted (reserved) funds are excluded from allocations until released."
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}><Upload size={14} /> Import CSV</Button>
            <Button onClick={() => setReserveOpen(true)}><ShieldAlert size={14} /> Record hold</Button>
            <Button onClick={() => setPayoutOpen(true)} disabled={availableBal <= 0}><ArrowDownToLine size={14} /> Record payout</Button>
            <Button variant="primary" onClick={() => setSaleOpen(true)}><Plus size={14} /> Record sale</Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Stat label="Earned balance (all time)" value={<Money cents={earnedBalance} />} sub="Gross − fees − refunds − chargebacks, regardless of where the cash sits" hint="Cumulative net earnings processed through this processor." />
        <Stat label="Available balance" value={<Money cents={availableBal} />} sub="Withdrawable now; not in your bank yet" tone="positive" />
        <Stat label="Restricted / reserved balance" value={<Money cents={restrictedBal} />} sub={`${heldReserves.filter((r) => r.status === "held").length} active hold(s)`} tone={restrictedBal > 0 ? "caution" : "neutral"} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Gross sales ${monthLabel(month)}`} value={<Money cents={gross} />} />
        <Stat label="Fees this month" value={<Money cents={fees} />} sub={gross > 0 ? <><Pct value={(fees / gross) * 100} /> effective</> : undefined} />
        <Stat label="Refunds & chargebacks" value={<Money cents={reversals} />} tone={reversals > 0 ? "caution" : "neutral"} />
        <Stat label="Paid out to bank" value={<Money cents={payouts} />} sub={<>Net earned this month <Money cents={earned} /></>} />
      </div>

      <div className="mt-6 mb-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "sales", label: "Sales", count: groups.length }, { value: "reserves", label: "Reserves", count: heldReserves.length }, { value: "payouts", label: "Payouts" }, { value: "fees", label: "Fee defaults" }]} />
      </div>

      {tab === "sales" && <Table columns={saleCols} rows={groups} rowKey={(g) => g.groupId} empty="No Whop sales recorded yet. Record one manually or import the transactions CSV." />}

      {tab === "reserves" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Table
              columns={[
                { key: "d", header: "Withheld", render: (r: ProcessorReserve) => dateLabel(r.dateWithheld) },
                { key: "a", header: "Amount", align: "right", render: (r: ProcessorReserve) => <Money cents={r.amountUsdCents} /> },
                { key: "rel", header: "Expected release", render: (r: ProcessorReserve) => (r.status === "held" ? <input type="date" className="h-7 rounded border border-border bg-surface px-1.5 text-xs" value={r.expectedReleaseDate ?? ""} onChange={(e) => mutate((db) => updateReserve(db, r.id, { expectedReleaseDate: e.target.value || null }))} /> : <span className="text-fg-muted">{dateLabel(r.releasedDate)}</span>) },
                { key: "s", header: "Status", render: (r: ProcessorReserve) => <Badge tone={r.status === "held" ? "caution" : r.status === "released" ? "positive" : "critical"}>{r.status}</Badge> },
                { key: "why", header: "Reason", render: (r: ProcessorReserve) => <span className="text-xs text-fg-muted">{r.reason ?? "—"}</span> },
                { key: "x", header: "", align: "right", render: (r: ProcessorReserve) => (r.status === "held" ? <Button size="sm" onClick={() => setReleasing(r)}><Unlock size={13} /> Release</Button> : null) },
              ]}
              rows={heldReserves}
              rowKey={(r) => r.id}
              empty="No reserves recorded. Whop reserves depend on account risk and compliance decisions; record each hold individually with its own release date."
            />
          </div>
          <Card title="Release projection" subtitle="Restricted funds expected back, by month">
            <DefinitionList items={schedule.map((s) => ({ label: monthLabel(s.month), value: <><Money cents={s.amount} />{s.unknownDate > 0 && <span className="ml-1 text-[10px] text-fg-faint">+<Money cents={s.unknownDate} /> undated</span>}</> }))} />
          </Card>
        </div>
      )}

      {tab === "payouts" && (
        <Table
          columns={[
            { key: "d", header: "Date", render: (t: (typeof procTx)[number]) => dateLabel(t.date) },
            { key: "desc", header: "Description", render: (t: (typeof procTx)[number]) => t.description },
            { key: "to", header: "To", render: (t: (typeof procTx)[number]) => data.accounts.find((a) => a.id === t.toAccountId)?.name ?? "—" },
            { key: "a", header: "Amount", align: "right", render: (t: (typeof procTx)[number]) => <Money cents={t.amountUsdCents} /> },
            { key: "fee", header: "Fee", align: "right", render: (t: (typeof procTx)[number]) => <Money cents={procTx.filter((x) => x.groupId && x.groupId === t.groupId && x.type === "payout_fee").reduce((a, x) => a + x.amountUsdCents, 0)} /> },
          ]}
          rows={procTx.filter((t) => t.type === "payout")}
          rowKey={(t) => t.id}
          empty="No payouts recorded."
        />
      )}

      {tab === "fees" && <FeeDefaults processor={processor} />}

      <SaleModal open={saleOpen} onClose={() => setSaleOpen(false)} processor={processor} />
      <PayoutModal open={payoutOpen} onClose={() => setPayoutOpen(false)} processor={processor} max={availableBal} />
      <ManualReserveModal open={reserveOpen} onClose={() => setReserveOpen(false)} processor={processor} />
      <ImportWhopModal open={importOpen} onClose={() => setImportOpen(false)} processor={processor} />
      {releasing && (
        <ReleaseModal
          reserve={releasing}
          onClose={() => setReleasing(null)}
          onConfirm={(date, status) => {
            try {
              mutate((db, d) => releaseReserve(db, releasing.id, date, d.settings, d.fxRates, status));
              toast.success(status === "released" ? "Reserve released to available balance" : "Reserve marked forfeited");
            } catch (e) {
              toast.error("Could not release", e instanceof Error ? e.message : String(e));
            }
            setReleasing(null);
          }}
        />
      )}
      <p className="mt-6 text-xs text-fg-faint">{processor.pricingSource}</p>
    </>
  );
}

function SaleModal({ open, onClose, processor }: { open: boolean; onClose: () => void; processor: Processor }) {
  const { data, mutate } = useReady();
  const toast = useToast();
  const [f, setF] = useState<SaleRecordInput & { overrideFees: boolean; processingFee: number; conversionFee: number; platformFee: number; reserveHold: number }>({ date: todayKey(), description: "", grossUsdCents: 0, internationalCard: false, currencyConversion: false, applyPlatformFee: processor.platformFeeAppliesByDefault, reservePct: processor.defaultReservePct, clientId: data.clients[0]?.id ?? null, customerCurrency: "USD", reserveReason: "", reserveExpectedReleaseDate: null, overrideFees: false, processingFee: 0, conversionFee: 0, platformFee: 0, reserveHold: 0 });
  const [errors, setErrors] = useState<string[]>([]);
  const preview = computeSaleFees(processor, { ...f, overrides: f.overrideFees ? { processingFee: f.processingFee, conversionFee: f.conversionFee, platformFee: f.platformFee, reserveHold: f.reserveHold } : undefined });
  const submit = () => {
    const errs: string[] = [];
    if (f.grossUsdCents <= 0) errs.push("Gross amount is required");
    if (!f.description.trim()) errs.push("Description is required");
    if (errs.length) return setErrors(errs);
    try {
      mutate((db, d) => recordProcessorSale(db, processor.id, { ...f, overrides: f.overrideFees ? { processingFee: f.processingFee, conversionFee: f.conversionFee, platformFee: f.platformFee, reserveHold: f.reserveHold } : undefined }, d.settings, d.fxRates));
      toast.success("Sale recorded with fee lines");
      onClose();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Record a Whop sale" description="Fees are computed from your defaults; tick the boxes that apply to this payment or override with the exact figures from the Whop statement." size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Record sale</Button></>}>
      <div className="space-y-4">
        <FormError errors={errors} />
        <FormRow cols={3}>
          <Field label="Date" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Gross amount (USD)" required><MoneyInput value={f.grossUsdCents} onChange={(v) => setF({ ...f, grossUsdCents: v })} /></Field>
          <Field label="Customer currency"><Input value={f.customerCurrency ?? ""} onChange={(e) => setF({ ...f, customerCurrency: e.target.value.toUpperCase(), currencyConversion: e.target.value.toUpperCase() !== "USD" && e.target.value !== "" ? true : f.currencyConversion })} /></Field>
        </FormRow>
        <FormRow cols={2}>
          <Field label="Description" required><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="November revenue share" /></Field>
          <Field label="Client">
            <Select value={f.clientId ?? ""} onChange={(e) => setF({ ...f, clientId: e.target.value || null })}>
              <option value="">— none —</option>
              {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </FormRow>
        <div className="flex flex-wrap gap-5">
          <Checkbox label={`International card (+${processor.intlCardSurchargePct}%)`} checked={f.internationalCard} onChange={(v) => setF({ ...f, internationalCard: v })} />
          <Checkbox label={`Currency conversion (+${processor.conversionPct}%)`} checked={f.currencyConversion} onChange={(v) => setF({ ...f, currencyConversion: v })} />
          <Checkbox label={`Platform fee (${processor.platformFeePct}%)`} checked={f.applyPlatformFee} onChange={(v) => setF({ ...f, applyPlatformFee: v })} />
          <Checkbox label="Override with exact fees" checked={f.overrideFees} onChange={(v) => setF({ ...f, overrideFees: v, processingFee: preview.processingFee, conversionFee: preview.conversionFee, platformFee: preview.platformFee, reserveHold: preview.reserveHold })} />
        </div>
        {f.overrideFees && (
          <FormRow cols={4}>
            <Field label="Processing fee"><MoneyInput value={f.processingFee} onChange={(v) => setF({ ...f, processingFee: v })} /></Field>
            <Field label="Conversion fee"><MoneyInput value={f.conversionFee} onChange={(v) => setF({ ...f, conversionFee: v })} /></Field>
            <Field label="Platform fee"><MoneyInput value={f.platformFee} onChange={(v) => setF({ ...f, platformFee: v })} /></Field>
            <Field label="Reserve held"><MoneyInput value={f.reserveHold} onChange={(v) => setF({ ...f, reserveHold: v })} /></Field>
          </FormRow>
        )}
        <FormRow cols={3}>
          <Field label="Reserve % on this sale" hint="Leave 0 if nothing was withheld"><PercentInput value={f.reservePct ?? ""} onChange={(v) => setF({ ...f, reservePct: v })} disabled={f.overrideFees} /></Field>
          <Field label="Reserve release date (if known)"><Input type="date" value={f.reserveExpectedReleaseDate ?? ""} onChange={(e) => setF({ ...f, reserveExpectedReleaseDate: e.target.value || null })} /></Field>
          <Field label="Reserve reason"><Input value={f.reserveReason ?? ""} onChange={(e) => setF({ ...f, reserveReason: e.target.value })} placeholder="Rolling reserve, new account review…" /></Field>
        </FormRow>
        <div className="rounded-lg border border-border bg-surface-2/50 p-3">
          <DefinitionList
            items={[
              { label: "Gross", value: <Money cents={preview.gross} /> },
              { label: `Card processing${f.internationalCard ? " incl. international surcharge" : ""}`, value: <>−<Money cents={preview.processingFee} /></> },
              { label: "Currency conversion", value: <>−<Money cents={preview.conversionFee} /></> },
              { label: "Platform fee", value: <>−<Money cents={preview.platformFee} /></> },
              { label: `Net to available balance (${preview.effectiveFeePct ?? "0"}% fees)`, value: <span className="font-semibold"><Money cents={preview.net} /></span> },
              { label: "Moved to restricted balance", value: <Money cents={preview.reserveHold} /> },
              { label: "Available after reserve", value: <Money cents={preview.availableAfterReserve} className="font-semibold" /> },
            ]}
          />
        </div>
      </div>
    </Modal>
  );
}

function PayoutModal({ open, onClose, processor, max }: { open: boolean; onClose: () => void; processor: Processor; max: number }) {
  const { data, mutate } = useReady();
  const toast = useToast();
  const [f, setF] = useState({ date: todayKey(), amount: 0, toAccountId: data.accounts.find((a) => a.role === "operating")?.id ?? "", method: "ach" as PayoutMethod, overrideFee: false, fee: 0 });
  const fee = f.overrideFee ? f.fee : computePayoutFee(processor, f.amount, f.method);
  return (
    <Modal open={open} onClose={onClose} title="Record payout to bank" description="A payout is a transfer from the processor's available balance to your bank; the payout fee is its own ledger row." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={f.amount <= 0 || !f.toAccountId} onClick={() => { try { mutate((db, d) => recordPayout(db, processor.id, { date: f.date, amountUsdCents: f.amount, toAccountId: f.toAccountId, method: f.method, feeOverrideCents: f.overrideFee ? f.fee : null }, d.settings, d.fxRates)); toast.success("Payout recorded"); onClose(); } catch (e) { toast.error("Could not record", e instanceof Error ? e.message : String(e)); } }}>Record payout</Button></>}>
      <div className="space-y-3">
        <FormRow cols={2}>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Amount (USD)" hint={<>Available: <Money cents={max} /></>}><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        </FormRow>
        <FormRow cols={2}>
          <Field label="To account">
            <Select value={f.toAccountId} onChange={(e) => setF({ ...f, toAccountId: e.target.value })}>
              {data.accounts.filter((a) => a.kind === "bank" && a.isBusiness).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Method">
            <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PayoutMethod })}>
              <option value="ach">ACH ({formatMoney(processor.achPayoutFeeCents)})</option>
              <option value="wire">Wire ({formatMoney(processor.wirePayoutFeeCents)})</option>
              <option value="international">International bank transfer ({formatMoney(processor.intlTransferFeeCents)} + {processor.intlTransferPct}%)</option>
              <option value="instant">Instant ({processor.instantPayoutPct}% + {formatMoney(processor.instantPayoutFixedCents)})</option>
              <option value="none">No fee</option>
            </Select>
          </Field>
        </FormRow>
        <Checkbox label="Override fee with the exact amount charged" checked={f.overrideFee} onChange={(v) => setF({ ...f, overrideFee: v, fee })} />
        {f.overrideFee && <Field label="Payout fee"><MoneyInput value={f.fee} onChange={(v) => setF({ ...f, fee: v })} /></Field>}
        <div className="rounded-lg border border-border bg-surface-2/50 p-3 text-sm">
          <div className="flex justify-between"><span className="text-fg-muted">Payout fee</span><Money cents={fee} /></div>
          <div className="mt-1 flex justify-between"><span className="text-fg-muted">Leaves available balance</span><Money cents={f.amount + fee} className="font-medium" /></div>
        </div>
      </div>
    </Modal>
  );
}

function ManualReserveModal({ open, onClose, processor }: { open: boolean; onClose: () => void; processor: Processor }) {
  const { mutate } = useReady();
  const toast = useToast();
  const [f, setF] = useState({ amount: 0, date: todayKey(), release: "", reason: "", notes: "" });
  return (
    <Modal open={open} onClose={onClose} title="Record a reserve hold" description="Use when Whop withholds part of your available balance outside a specific sale (account review, rolling reserve)." size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={f.amount <= 0} onClick={() => { try { mutate((db, d) => recordManualReserve(db, processor.id, { amountUsdCents: f.amount, dateWithheld: f.date, expectedReleaseDate: f.release || null, reason: f.reason || undefined, notes: f.notes || null }, d.settings, d.fxRates)); toast.success("Hold recorded"); onClose(); } catch (e) { toast.error("Could not record", e instanceof Error ? e.message : String(e)); } }}>Record hold</Button></>}>
      <div className="space-y-3">
        <FormRow cols={2}>
          <Field label="Amount"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label="Date withheld"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </FormRow>
        <Field label="Expected release date (if known)"><Input type="date" value={f.release} onChange={(e) => setF({ ...f, release: e.target.value })} /></Field>
        <Field label="Reason"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ReleaseModal({ reserve, onClose, onConfirm }: { reserve: ProcessorReserve; onClose: () => void; onConfirm: (date: string, status: "released" | "forfeited") => void }) {
  const [date, setDate] = useState(todayKey());
  const [status, setStatus] = useState<"released" | "forfeited">("released");
  return (
    <Modal open onClose={onClose} title="Release reserve" size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onConfirm(date, status)}>Confirm</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-fg-muted"><Money cents={reserve.amountUsdCents} /> withheld on {dateLabel(reserve.dateWithheld)}.</p>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Outcome">
          <Select value={status} onChange={(e) => setStatus(e.target.value as "released" | "forfeited")}>
            <option value="released">Released to available balance</option>
            <option value="forfeited">Forfeited (processor kept it, e.g. lost dispute)</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function FeeDefaults({ processor }: { processor: Processor }) {
  const { mutate } = useReady();
  const toast = useToast();
  const [f, setF] = useState({ ...processor });
  const save = () => {
    mutate((db) => updateProcessor(db, processor.id, { domesticCardPct: f.domesticCardPct, domesticCardFixedCents: f.domesticCardFixedCents, intlCardSurchargePct: f.intlCardSurchargePct, conversionPct: f.conversionPct, platformFeePct: f.platformFeePct, platformFeeAppliesByDefault: f.platformFeeAppliesByDefault, achPayoutFeeCents: f.achPayoutFeeCents, wirePayoutFeeCents: f.wirePayoutFeeCents, intlTransferFeeCents: f.intlTransferFeeCents, intlTransferPct: f.intlTransferPct, instantPayoutPct: f.instantPayoutPct, instantPayoutFixedCents: f.instantPayoutFixedCents, defaultReservePct: f.defaultReservePct, pricingVerifiedAt: todayKey(), notes: f.notes }));
    toast.success("Fee defaults saved");
  };
  return (
    <Card title="Fee defaults" subtitle="Used to pre-fill each sale and payout. Verify against the processor's published pricing and mark the date you checked." actions={<Button variant="primary" size="sm" onClick={save}><Settings2 size={13} /> Save defaults</Button>}>
      <Callout tone="caution" className="mb-4" title="Estimates until verified">
        {processor.pricingVerifiedAt ? `Last verified ${dateLabel(processor.pricingVerifiedAt)}.` : "These defaults have not been verified against your actual Whop statements yet."} Wire and international transfer fees are placeholders.
      </Callout>
      <FormRow cols={4}>
        <Field label="Domestic card %"><PercentInput value={f.domesticCardPct} onChange={(v) => setF({ ...f, domesticCardPct: v })} /></Field>
        <Field label="Domestic fixed fee"><MoneyInput value={f.domesticCardFixedCents} onChange={(v) => setF({ ...f, domesticCardFixedCents: v })} /></Field>
        <Field label="International card surcharge %"><PercentInput value={f.intlCardSurchargePct} onChange={(v) => setF({ ...f, intlCardSurchargePct: v })} /></Field>
        <Field label="Currency conversion %"><PercentInput value={f.conversionPct} onChange={(v) => setF({ ...f, conversionPct: v })} /></Field>
        <Field label="Platform fee %"><PercentInput value={f.platformFeePct} onChange={(v) => setF({ ...f, platformFeePct: v })} /></Field>
        <Field label="Default reserve %"><PercentInput value={f.defaultReservePct} onChange={(v) => setF({ ...f, defaultReservePct: v })} /></Field>
        <Field label="ACH payout fee"><MoneyInput value={f.achPayoutFeeCents} onChange={(v) => setF({ ...f, achPayoutFeeCents: v })} /></Field>
        <Field label="Wire payout fee"><MoneyInput value={f.wirePayoutFeeCents} onChange={(v) => setF({ ...f, wirePayoutFeeCents: v })} /></Field>
        <Field label="International transfer fixed"><MoneyInput value={f.intlTransferFeeCents} onChange={(v) => setF({ ...f, intlTransferFeeCents: v })} /></Field>
        <Field label="International transfer %"><PercentInput value={f.intlTransferPct} onChange={(v) => setF({ ...f, intlTransferPct: v })} /></Field>
        <Field label="Instant payout %"><PercentInput value={f.instantPayoutPct} onChange={(v) => setF({ ...f, instantPayoutPct: v })} /></Field>
        <Field label="Instant payout fixed"><MoneyInput value={f.instantPayoutFixedCents} onChange={(v) => setF({ ...f, instantPayoutFixedCents: v })} /></Field>
      </FormRow>
      <div className="mt-3"><Checkbox label="Apply platform fee by default on new sales" checked={f.platformFeeAppliesByDefault} onChange={(v) => setF({ ...f, platformFeeAppliesByDefault: v })} /></div>
      <Field label="Notes" className="mt-3"><Textarea value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </Card>
  );
}

function ImportWhopModal({ open, onClose, processor }: { open: boolean; onClose: () => void; processor: Processor }) {
  const { data, mutate } = useReady();
  const toast = useToast();
  const [rows, setRows] = useState<{ input: SaleRecordInput; errors: string[] }[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const handle = async (file: File) => {
    const text = await readFileText(file);
    const parsed = parseCsv(text);
    setFileErrors(parsed.errors);
    setRows(
      parsed.rows.map((raw) => {
        const errs: string[] = [];
        const dateCol = pickColumn(raw, ["date", "created", "paid at", "time"]);
        const grossCol = pickColumn(raw, ["gross", "amount", "total", "price"]);
        const feeCol = pickColumn(raw, ["processing fee", "stripe fee", "card fee", "fee"]);
        const platCol = pickColumn(raw, ["platform fee", "whop fee"]);
        const convCol = pickColumn(raw, ["conversion", "fx fee"]);
        const curCol = pickColumn(raw, ["currency"]);
        const descCol = pickColumn(raw, ["product", "description", "plan", "name", "customer"]);
        const statusCol = pickColumn(raw, ["status"]);
        const date = dateCol ? normaliseDate(raw[dateCol]) : null;
        if (!date) errs.push("No readable date");
        let gross = 0;
        try {
          gross = Math.abs(parseMajorToMinor(grossCol ? raw[grossCol] : "0"));
        } catch {
          errs.push("Unreadable amount");
        }
        if (gross <= 0) errs.push("Zero amount");
        if (statusCol && /refund|fail|cancel/i.test(raw[statusCol] ?? "")) errs.push(`Skipped: status ${raw[statusCol]}`);
        const parseOpt = (col?: string) => {
          if (!col || !raw[col]) return undefined;
          try {
            return Math.abs(parseMajorToMinor(raw[col]));
          } catch {
            return undefined;
          }
        };
        const pf = parseOpt(feeCol);
        const plat = parseOpt(platCol);
        const conv = parseOpt(convCol);
        const currency = (curCol && raw[curCol]?.toUpperCase()) || "USD";
        const hasOverrides = pf !== undefined || plat !== undefined || conv !== undefined;
        return {
          input: {
            date: date ?? "",
            description: (descCol && raw[descCol]) || "Whop sale",
            grossUsdCents: gross,
            internationalCard: false,
            currencyConversion: currency !== "USD",
            applyPlatformFee: processor.platformFeeAppliesByDefault,
            customerCurrency: currency,
            clientId: data.clients[0]?.id ?? null,
            overrides: hasOverrides ? { processingFee: pf ?? 0, platformFee: plat ?? 0, conversionFee: conv ?? 0 } : undefined,
          },
          errors: errs,
        };
      }),
    );
  };
  const valid = rows.filter((r) => r.errors.length === 0);
  return (
    <Modal open={open} onClose={onClose} title="Import Whop transactions CSV" description="Reads date, gross amount, currency and any fee columns present. Fee columns in the file override defaults; otherwise defaults apply with platform fee per your setting." size="xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={valid.length === 0} onClick={() => { try { mutate((db, d) => { for (const r of valid) recordProcessorSale(db, processor.id, r.input, d.settings, d.fxRates); }); toast.success(`Imported ${valid.length} sale(s)`); setRows([]); onClose(); } catch (e) { toast.error("Import failed", e instanceof Error ? e.message : String(e)); } }}>Import {valid.length}</Button></>}>
      <input type="file" accept=".csv,text/csv" className="block w-full text-xs text-fg-muted file:mr-2 file:rounded-md file:border-0 file:bg-accent-soft file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-accent" onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
      {fileErrors.length > 0 && <Callout tone="caution" className="mt-3">{fileErrors.slice(0, 3).join("; ")}</Callout>}
      {rows.length > 0 && (
        <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-left text-fg-muted"><tr><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Description</th><th className="px-2 py-1.5 text-right">Gross</th><th className="px-2 py-1.5 text-right">Fees</th><th className="px-2 py-1.5">Status</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const fees = computeSaleFees(processor, r.input);
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-1.5">{r.input.date || "—"}</td>
                    <td className="max-w-[260px] truncate px-2 py-1.5">{r.input.description}</td>
                    <td className="tabular px-2 py-1.5 text-right">{formatMoney(r.input.grossUsdCents)}</td>
                    <td className="tabular px-2 py-1.5 text-right">{formatMoney(fees.totalFees)}</td>
                    <td className="px-2 py-1.5">{r.errors.length ? <Badge tone="critical">{r.errors[0]}</Badge> : <Badge tone="positive">ready</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] text-fg-faint">Next month: {monthLabel(addMonths(todayKey().slice(0, 7), 1))}. Refunded or failed rows are skipped; record refunds and chargebacks separately so they reduce net revenue exactly once.</p>
    </Modal>
  );
}
