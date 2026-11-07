"use client";

import React, { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, FileText, Banknote } from "lucide-react";
import type { Client, Invoice, ClientRevenuePeriod } from "@/db/schema";
import { useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { Money, Pct } from "@/components/Money";
import { PageHeader, Card, Stat, Badge, Button, Callout, DefinitionList, Progress } from "@/components/ui/primitives";
import { Field, Input, Select, Textarea, MoneyInput, PercentInput, FormRow, FormError } from "@/components/ui/forms";
import { Table, type Column } from "@/components/ui/Table";
import { Modal, ConfirmModal } from "@/components/ui/Modal";
import { TransactionForm } from "@/components/TransactionForm";
import { upsertClient, deleteClient, upsertRevenuePeriod, deleteRevenuePeriod, upsertInvoice, deleteInvoice } from "@/db/repo";
import { commissionFor } from "@/engine/clients";
import { invoiceOutstanding, invoiceStatus, invoicePaid } from "@/engine/revenue";
import { AGREEMENT_TYPES, AGREEMENT_LABELS, type AgreementType } from "@/lib/constants";
import { dateLabel, monthLabel, addDays, lastNMonths, monthRange } from "@/lib/dates";
import { clsx } from "clsx";

export default function ClientsPage() {
  const { data, snapshot, mutate, month, today } = useReady();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(data.clients[0]?.id ?? null);
  const [clientEdit, setClientEdit] = useState<Client | null | "new">(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [periodEdit, setPeriodEdit] = useState<{ client: Client; period: ClientRevenuePeriod | null } | null>(null);
  const [invoiceEdit, setInvoiceEdit] = useState<{ client: Client; invoice: Invoice | null } | null>(null);
  const [payment, setPayment] = useState<{ clientId: string; invoiceId?: string; amount?: number } | null>(null);

  const client = data.clients.find((c) => c.id === selected) ?? null;
  const metrics = snapshot.clients.find((m) => m.clientId === selected);
  const conc = snapshot.concentration;
  const concTone = conc.largestSharePct ? (Number(conc.largestSharePct) >= Number(data.settings.concentrationCriticalPct) ? "critical" : Number(conc.largestSharePct) >= Number(data.settings.concentrationWarnPct) ? "caution" : "positive") : "neutral";

  const periods = useMemo(() => (client ? data.revenuePeriods.filter((p) => p.clientId === client.id).sort((a, b) => (a.month < b.month ? 1 : -1)) : []), [client, data.revenuePeriods]);
  const invoices = useMemo(() => (client ? data.invoices.filter((i) => i.clientId === client.id).sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1)) : []), [client, data.invoices]);
  const trailing = lastNMonths(month, 6);

  const invoiceCols: Column<Invoice>[] = [
    { key: "n", header: "Invoice", render: (i) => <div><div className="font-medium">{i.number ?? i.id.slice(0, 6)}</div><div className="text-[11px] text-fg-faint">for {monthLabel(i.periodMonth)}</div></div> },
    { key: "d", header: "Issued / due", render: (i) => <span className="text-xs text-fg-muted">{dateLabel(i.issueDate)} → {dateLabel(i.dueDate)}</span> },
    { key: "a", header: "Amount", align: "right", render: (i) => <Money cents={i.amountUsdCents} /> },
    { key: "p", header: "Paid", align: "right", render: (i) => <Money cents={invoicePaid(i, data.transactions)} /> },
    {
      key: "s",
      header: "Status",
      render: (i) => {
        const s = invoiceStatus(i, data.transactions, today, data.settings.invoiceOverdueGraceDays);
        return <Badge tone={s === "paid" ? "positive" : s === "overdue" ? "critical" : s === "partially_paid" ? "caution" : s === "void" ? "neutral" : "info"}>{s.replace("_", " ")}</Badge>;
      },
    },
    {
      key: "x",
      header: "",
      align: "right",
      width: "160px",
      render: (i) => (
        <div className="flex justify-end gap-1">
          {invoiceOutstanding(i, data.transactions) > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setPayment({ clientId: i.clientId, invoiceId: i.id, amount: invoiceOutstanding(i, data.transactions) })}>
              <Banknote size={13} /> Record payment
            </Button>
          )}
          <button className="rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg" onClick={() => client && setInvoiceEdit({ client, invoice: i })}><Pencil size={14} /></button>
          <button className="rounded p-1 text-fg-faint hover:bg-critical-soft hover:text-critical" onClick={() => { mutate((db) => deleteInvoice(db, i.id)); toast.success("Invoice deleted"); }}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Clients & revenue"
        description="Only your commission, retainer or fee is agency revenue. A client's store revenue is theirs. Earned revenue becomes allocatable only once it is collected."
        actions={
          <Button variant="primary" onClick={() => setClientEdit("new")}>
            <Plus size={14} /> New client
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Earned this month" value={<Money cents={snapshot.revenue.grossEarned} />} sub="Commissions, retainers, fees" />
        <Stat label="Collected this month" value={<Money cents={snapshot.revenue.collected} />} sub={<>Invoiced <Money cents={snapshot.revenue.invoiced} /></>} />
        <Stat label="Outstanding receivables" value={<Money cents={snapshot.revenue.outstandingReceivables} />} tone={snapshot.revenue.overdueReceivables > 0 ? "caution" : "neutral"} sub={<>Overdue <Money cents={snapshot.revenue.overdueReceivables} /></>} />
        <Stat label="Largest client share" value={conc.largestSharePct ? <Pct value={conc.largestSharePct} digits={0} /> : "—"} tone={concTone} sub={conc.largestClientName ? `${conc.largestClientName} · basis: ${conc.basis}` : "No revenue recorded"} />
      </div>
      {conc.largestSharePct && Number(conc.largestSharePct) >= Number(data.settings.concentrationWarnPct) && (
        <Callout tone={concTone === "critical" ? "critical" : "caution"} className="mt-3" title={`${conc.largestClientName} is ${conc.largestSharePct}% of revenue`}>
          {concTone === "critical" ? "Above 75%: losing this client would remove most of your income at once. Prioritise a second and third client before scaling fixed costs." : "Above 50%: one dispute or churn event threatens solvency. Keep outbound running and diversify agreement types."}
        </Callout>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Clients" padded={false} className="lg:col-span-1">
          <ul className="divide-y divide-border">
            {data.clients.map((c) => {
              const m = snapshot.clients.find((x) => x.clientId === c.id);
              return (
                <li key={c.id}>
                  <button onClick={() => setSelected(c.id)} className={clsx("flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2/60", selected === c.id && "bg-accent-soft/60")}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate text-sm font-medium">
                        {c.name} <Badge tone={c.status === "active" ? "positive" : "neutral"}>{c.status}</Badge>
                      </div>
                      <div className="text-[11px] text-fg-faint">
                        {AGREEMENT_LABELS[c.agreementType as AgreementType]}
                        {c.revenueSharePct && ` · ${c.revenueSharePct}% share`}
                        {c.monthlyRetainerUsdCents > 0 && <> · <Money cents={c.monthlyRetainerUsdCents} /> retainer</>}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="tabular font-medium"><Money cents={m?.earned ?? 0} /></div>
                      <div className="text-fg-faint">{m?.sharePct ? `${m.sharePct}%` : "—"}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {!client ? (
            <Callout tone="neutral">Select or create a client.</Callout>
          ) : (
            <>
              <Card
                title={client.name}
                subtitle={`${AGREEMENT_LABELS[client.agreementType as AgreementType]} · ${client.startDate ? `since ${dateLabel(client.startDate)}` : "no start date"}${client.endDate ? ` · ends ${dateLabel(client.endDate)}` : ""}`}
                actions={
                  <>
                    <Button size="sm" onClick={() => setPayment({ clientId: client.id })}>
                      <Banknote size={13} /> Record payment
                    </Button>
                    <Button size="sm" onClick={() => setClientEdit(client)}>
                      <Pencil size={13} /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(client)}>
                      <Trash2 size={13} />
                    </Button>
                  </>
                }
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <DefinitionList
                    items={[
                      { label: "Revenue share", value: client.revenueSharePct ? `${client.revenueSharePct}%` : "—" },
                      { label: "Monthly retainer", value: <Money cents={client.monthlyRetainerUsdCents} /> },
                      { label: "Fixed fees", value: <Money cents={client.fixedFeeUsdCents} /> },
                      { label: "Payment terms", value: `${client.paymentTermsDays} days` },
                    ]}
                  />
                  <DefinitionList
                    items={[
                      { label: `Earned in ${monthLabel(month)}`, value: <Money cents={metrics?.earned ?? 0} /> },
                      { label: "Collected", value: <Money cents={metrics?.collected ?? 0} /> },
                      { label: "Amount owed (all invoices)", value: <Money cents={metrics?.outstanding ?? 0} className={(metrics?.outstanding ?? 0) > 0 ? "text-caution" : ""} /> },
                      { label: "Direct delivery costs", value: <Money cents={metrics?.directCosts ?? 0} /> },
                      { label: "Associated expenses (all)", value: <Money cents={metrics?.associatedExpenses ?? 0} /> },
                      { label: "Client profit / margin", value: <><Money cents={metrics?.profit ?? 0} tone="auto" /> <span className="text-xs text-fg-faint">(<Pct value={metrics?.marginPct} digits={0} />)</span></> },
                    ]}
                  />
                </div>
                {client.notes && <p className="mt-3 text-xs text-fg-muted">{client.notes}</p>}
              </Card>

              <Card
                title="Monthly revenue earned"
                subtitle={client.revenueSharePct ? `Enter the client's attributable revenue; your commission is ${client.revenueSharePct}% of it.` : "Retainers and fixed fees earned per month."}
                actions={
                  <Button size="sm" onClick={() => setPeriodEdit({ client, period: null })}>
                    <Plus size={13} /> Add month
                  </Button>
                }
              >
                <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {trailing.map((m) => {
                    const p = periods.find((x) => x.month === m);
                    const earned = p ? p.commissionUsdCents + p.retainerUsdCents + p.fixedFeesUsdCents : 0;
                    const max = Math.max(1, ...trailing.map((mm) => { const pp = periods.find((x) => x.month === mm); return pp ? pp.commissionUsdCents + pp.retainerUsdCents + pp.fixedFeesUsdCents : 0; }));
                    return (
                      <div key={m} className="rounded-lg border border-border p-2">
                        <div className="text-[10px] text-fg-faint">{monthLabel(m)}</div>
                        <div className="tabular text-xs font-medium"><Money cents={earned} compact /></div>
                        <Progress className="mt-1" value={earned} max={max} thin tone="accent" />
                      </div>
                    );
                  })}
                </div>
                <Table
                  dense
                  columns={[
                    { key: "m", header: "Month", render: (p: ClientRevenuePeriod) => <span className="font-medium">{monthLabel(p.month)}</span> },
                    { key: "r", header: "Client revenue", align: "right", render: (p: ClientRevenuePeriod) => <span className="text-fg-muted"><Money cents={p.clientAttributableRevenueUsdCents} /></span> },
                    { key: "c", header: `Commission${client.revenueSharePct ? ` (${client.revenueSharePct}%)` : ""}`, align: "right", render: (p: ClientRevenuePeriod) => <Money cents={p.commissionUsdCents} /> },
                    { key: "t", header: "Retainer + fees", align: "right", render: (p: ClientRevenuePeriod) => <Money cents={p.retainerUsdCents + p.fixedFeesUsdCents} /> },
                    { key: "e", header: "Earned", align: "right", render: (p: ClientRevenuePeriod) => <span className="font-medium"><Money cents={p.commissionUsdCents + p.retainerUsdCents + p.fixedFeesUsdCents} /></span> },
                    {
                      key: "x",
                      header: "",
                      align: "right",
                      width: "120px",
                      render: (p: ClientRevenuePeriod) => (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" title="Create an invoice for this month" onClick={() => setInvoiceEdit({ client, invoice: { id: "", clientId: client.id, number: null, periodMonth: p.month, issueDate: monthRange(p.month).end, dueDate: addDays(monthRange(p.month).end, client.paymentTermsDays), expectedPaymentDate: null, amountUsdCents: p.commissionUsdCents + p.retainerUsdCents + p.fixedFeesUsdCents, status: "sent", notes: null, createdAt: "" } })}>
                            <FileText size={13} />
                          </Button>
                          <button className="rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg" onClick={() => setPeriodEdit({ client, period: p })}><Pencil size={14} /></button>
                          <button className="rounded p-1 text-fg-faint hover:bg-critical-soft hover:text-critical" onClick={() => { mutate((db) => deleteRevenuePeriod(db, p.id)); toast.success("Removed"); }}><Trash2 size={14} /></button>
                        </div>
                      ),
                    },
                  ]}
                  rows={periods}
                  rowKey={(p) => p.id}
                  empty="No monthly revenue recorded for this client yet."
                />
              </Card>

              <Card
                title="Invoices & collection"
                subtitle="Invoices feed receivables, overdue alerts and the cash-flow forecast."
                actions={
                  <Button size="sm" onClick={() => setInvoiceEdit({ client, invoice: null })}>
                    <Plus size={13} /> New invoice
                  </Button>
                }
              >
                <Table dense columns={invoiceCols} rows={invoices} rowKey={(i) => i.id} empty="No invoices yet." />
              </Card>
            </>
          )}
        </div>
      </div>

      <ClientModal open={clientEdit !== null} existing={clientEdit === "new" ? null : clientEdit} onClose={() => setClientEdit(null)} onSaved={(id) => setSelected(id)} />
      {periodEdit && <PeriodModal client={periodEdit.client} period={periodEdit.period} defaultMonth={month} onClose={() => setPeriodEdit(null)} />}
      {invoiceEdit && <InvoiceModal client={invoiceEdit.client} invoice={invoiceEdit.invoice} onClose={() => setInvoiceEdit(null)} />}
      <TransactionForm open={!!payment} onClose={() => setPayment(null)} preset={payment ? { type: "client_payment", clientId: payment.clientId, invoiceId: payment.invoiceId ?? null, amountMinor: payment.amount ?? 0, description: `Payment from ${data.clients.find((c) => c.id === payment.clientId)?.name ?? "client"}` } : undefined} />
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        confirmLabel="Delete"
        title="Delete client?"
        body="Clients with transactions cannot be deleted; mark them churned instead. Revenue periods and invoices for this client will be removed."
        onConfirm={() => {
          if (!deleting) return;
          try {
            mutate((db) => deleteClient(db, deleting.id));
            toast.success("Client deleted");
            setSelected(null);
          } catch (e) {
            toast.error("Could not delete", e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </>
  );
}

function ClientModal({ open, existing, onClose, onSaved }: { open: boolean; existing: Client | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { data, mutate } = useReady();
  const toast = useToast();
  const blank = { name: "", agreementType: "revenue_share" as AgreementType, startDate: "", endDate: "", revenueSharePct: "20", monthlyRetainerUsdCents: 0, fixedFeeUsdCents: 0, status: "active", entityId: data.entities[0]?.id ?? "", paymentTermsDays: 7, notes: "" };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<string[]>([]);
  React.useEffect(() => {
    if (!open) return;
    setErrors([]);
    setF(existing ? { name: existing.name, agreementType: existing.agreementType as AgreementType, startDate: existing.startDate ?? "", endDate: existing.endDate ?? "", revenueSharePct: existing.revenueSharePct ?? "", monthlyRetainerUsdCents: existing.monthlyRetainerUsdCents, fixedFeeUsdCents: existing.fixedFeeUsdCents, status: existing.status, entityId: existing.entityId ?? "", paymentTermsDays: existing.paymentTermsDays, notes: existing.notes ?? "" } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);
  const usesShare = f.agreementType === "revenue_share" || f.agreementType === "hybrid";
  const usesRetainer = f.agreementType === "retainer" || f.agreementType === "hybrid";
  const save = () => {
    const errs: string[] = [];
    if (!f.name.trim()) errs.push("Name is required");
    if (usesShare && !(Number(f.revenueSharePct) > 0 && Number(f.revenueSharePct) <= 100)) errs.push("Revenue share must be between 0 and 100%");
    if (errs.length) return setErrors(errs);
    const id = mutate((db) => upsertClient(db, { id: existing?.id, name: f.name.trim(), agreementType: f.agreementType, startDate: f.startDate || null, endDate: f.endDate || null, revenueSharePct: usesShare ? f.revenueSharePct : null, monthlyRetainerUsdCents: usesRetainer ? f.monthlyRetainerUsdCents : 0, fixedFeeUsdCents: f.agreementType === "fixed_fee" || f.agreementType === "hybrid" ? f.fixedFeeUsdCents : 0, status: f.status, entityId: f.entityId || null, paymentTermsDays: f.paymentTermsDays, notes: f.notes.trim() || null }));
    toast.success(existing ? "Client updated" : "Client added");
    onSaved(id);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={existing ? "Edit client" : "New client"} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <FormError errors={errors} />
        <FormRow cols={2}>
          <Field label="Client name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Agreement type">
            <Select value={f.agreementType} onChange={(e) => setF({ ...f, agreementType: e.target.value as AgreementType })}>
              {AGREEMENT_TYPES.map((a) => <option key={a} value={a}>{AGREEMENT_LABELS[a]}</option>)}
            </Select>
          </Field>
        </FormRow>
        <FormRow cols={3}>
          {usesShare && <Field label="Revenue share %" hint="Of the client's attributable revenue"><PercentInput value={f.revenueSharePct} onChange={(v) => setF({ ...f, revenueSharePct: v })} /></Field>}
          {usesRetainer && <Field label="Monthly retainer (USD)"><MoneyInput value={f.monthlyRetainerUsdCents} onChange={(v) => setF({ ...f, monthlyRetainerUsdCents: v })} /></Field>}
          {(f.agreementType === "fixed_fee" || f.agreementType === "hybrid") && <Field label="Fixed fee (USD)"><MoneyInput value={f.fixedFeeUsdCents} onChange={(v) => setF({ ...f, fixedFeeUsdCents: v })} /></Field>}
          <Field label="Payment terms (days)"><Input type="number" value={f.paymentTermsDays} onChange={(e) => setF({ ...f, paymentTermsDays: Number(e.target.value) || 0 })} /></Field>
        </FormRow>
        <FormRow cols={4}>
          <Field label="Contract start"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Contract end"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="active">Active</option><option value="paused">Paused</option><option value="prospect">Prospect</option><option value="churned">Churned</option>
            </Select>
          </Field>
          <Field label="Contracting entity">
            <Select value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value })}>
              <option value="">—</option>
              {data.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
        </FormRow>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function PeriodModal({ client, period, defaultMonth, onClose }: { client: Client; period: ClientRevenuePeriod | null; defaultMonth: string; onClose: () => void }) {
  const { mutate } = useReady();
  const toast = useToast();
  const [f, setF] = useState({ month: period?.month ?? defaultMonth, clientRevenue: period?.clientAttributableRevenueUsdCents ?? 0, pct: period?.revenueSharePct ?? client.revenueSharePct ?? "", retainer: period?.retainerUsdCents ?? client.monthlyRetainerUsdCents, fixed: period?.fixedFeesUsdCents ?? 0, notes: period?.notes ?? "" });
  const commission = commissionFor(f.clientRevenue, f.pct || null);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${client.name}: revenue for a month`}
      description="The client's revenue is entered for reference only. Your commission is the only part that becomes agency revenue."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { try { mutate((db) => upsertRevenuePeriod(db, { id: period?.id, clientId: client.id, month: f.month, clientAttributableRevenueUsdCents: f.clientRevenue, revenueSharePct: f.pct || null, retainerUsdCents: f.retainer, fixedFeesUsdCents: f.fixed, notes: f.notes || null })); toast.success("Revenue recorded"); onClose(); } catch (e) { toast.error("Could not save", e instanceof Error ? e.message : String(e)); } }}>Save</Button></>}
    >
      <div className="space-y-3">
        <FormRow cols={2}>
          <Field label="Month"><Input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></Field>
          <Field label="Revenue share %"><PercentInput value={f.pct} onChange={(v) => setF({ ...f, pct: v })} /></Field>
        </FormRow>
        <FormRow cols={3}>
          <Field label="Client's attributable revenue (USD)" hint="e.g. Shopify store revenue"><MoneyInput value={f.clientRevenue} onChange={(v) => setF({ ...f, clientRevenue: v })} /></Field>
          <Field label="Retainer earned"><MoneyInput value={f.retainer} onChange={(v) => setF({ ...f, retainer: v })} /></Field>
          <Field label="Fixed fees earned"><MoneyInput value={f.fixed} onChange={(v) => setF({ ...f, fixed: v })} /></Field>
        </FormRow>
        <div className="rounded-lg border border-border bg-surface-2/50 p-3 text-sm">
          <div className="flex justify-between"><span className="text-fg-muted">My commission ({f.pct || 0}%)</span><Money cents={commission} className="font-medium" /></div>
          <div className="mt-1 flex justify-between"><span className="text-fg-muted">Total earned this month</span><Money cents={commission + f.retainer + f.fixed} className="font-semibold" /></div>
        </div>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function InvoiceModal({ client, invoice, onClose }: { client: Client; invoice: Invoice | null; onClose: () => void }) {
  const { mutate, month } = useReady();
  const toast = useToast();
  const isNew = !invoice || invoice.id === "";
  const [f, setF] = useState({ number: invoice?.number ?? "", periodMonth: invoice?.periodMonth ?? month, issueDate: invoice?.issueDate ?? monthRange(month).end, dueDate: invoice?.dueDate ?? addDays(monthRange(month).end, client.paymentTermsDays), expectedPaymentDate: invoice?.expectedPaymentDate ?? "", amount: invoice?.amountUsdCents ?? 0, status: invoice?.status ?? "sent", notes: invoice?.notes ?? "" });
  return (
    <Modal open onClose={onClose} title={isNew ? "New invoice" : "Edit invoice"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={f.amount <= 0} onClick={() => { mutate((db) => upsertInvoice(db, { id: isNew ? undefined : invoice!.id, clientId: client.id, number: f.number || null, periodMonth: f.periodMonth, issueDate: f.issueDate, dueDate: f.dueDate, expectedPaymentDate: f.expectedPaymentDate || null, amountUsdCents: f.amount, status: f.status, notes: f.notes || null })); toast.success("Invoice saved"); onClose(); }}>Save</Button></>}>
      <div className="space-y-3">
        <FormRow cols={3}>
          <Field label="Invoice number"><Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} placeholder="INV-001" /></Field>
          <Field label="For month"><Input type="month" value={f.periodMonth} onChange={(e) => setF({ ...f, periodMonth: e.target.value })} /></Field>
          <Field label="Amount (USD)"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        </FormRow>
        <FormRow cols={3}>
          <Field label="Issue date"><Input type="date" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} /></Field>
          <Field label="Due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Expected payment date" hint="Used by the forecast if set"><Input type="date" value={f.expectedPaymentDate} onChange={(e) => setF({ ...f, expectedPaymentDate: e.target.value })} /></Field>
        </FormRow>
        <FormRow cols={2}>
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="draft">Draft</option><option value="sent">Sent</option><option value="void">Void</option>
            </Select>
          </Field>
        </FormRow>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
