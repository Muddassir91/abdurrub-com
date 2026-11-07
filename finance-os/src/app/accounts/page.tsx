"use client";

import React, { useState } from "react";
import { Plus, Pencil, ArrowRightLeft, Scale, Archive } from "lucide-react";
import type { Account } from "@/db/schema";
import { useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { Money } from "@/components/Money";
import { PageHeader, Card, Stat, Badge, Button, Callout, DefinitionList } from "@/components/ui/primitives";
import { Field, Input, Select, Textarea, MoneyInput, FormRow, FormError } from "@/components/ui/forms";
import { Modal } from "@/components/ui/Modal";
import { TransactionForm } from "@/components/TransactionForm";
import { upsertAccount, archiveAccount, recordBalanceAdjustment } from "@/db/repo";
import { accountBalance, accountBalanceUsd } from "@/engine/ledger";
import { ACCOUNT_ROLES, ACCOUNT_ROLE_LABELS, BUCKET_LABELS, type AccountRole } from "@/lib/constants";
import { formatMoney, CURRENCY_CODES, type CurrencyCode } from "@/lib/money";
import { todayKey } from "@/lib/dates";
import { clsx } from "clsx";

export default function AccountsPage() {
  const { data, snapshot, mutate } = useReady();
  const toast = useToast();
  const [edit, setEdit] = useState<Account | null | "new">(null);
  const [setBal, setSetBal] = useState<Account | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const accounts = data.accounts.filter((a) => showArchived || !a.isArchived);
  const groups: { title: string; hint: string; items: Account[] }[] = [
    { title: "Business bank accounts", hint: "Real cash. Balances derive from opening balance ± ledger rows.", items: accounts.filter((a) => a.isBusiness && a.kind !== "processor") },
    { title: "Payment processor balances", hint: "Available is withdrawable; restricted is never spendable.", items: accounts.filter((a) => a.kind === "processor") },
    { title: "Personal accounts", hint: "Funded by owner draws; pays household and personal expenses.", items: accounts.filter((a) => !a.isBusiness) },
  ];
  const envelopeTotal = snapshot.envelopes.reduce((a, e) => a + Math.max(0, e.balance), 0);
  const unallocatedCash = snapshot.cash.bankBusinessCash - envelopeTotal;

  return (
    <>
      <PageHeader
        title="Accounts & cash"
        description="Allocations are virtual envelopes, not bank transfers. This page shows the difference between real cash, budget envelopes, processor-held funds and receivables so you can move real money to match."
        actions={
          <>
            <Button onClick={() => setTransfer(true)}><ArrowRightLeft size={14} /> Internal transfer</Button>
            <Button variant="primary" onClick={() => setEdit("new")}><Plus size={14} /> Account</Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Actual business bank cash" value={<Money cents={snapshot.cash.bankBusinessCash} />} sub="Sum of business bank accounts" />
        <Stat label="Virtual envelopes (booked)" value={<Money cents={envelopeTotal} />} sub={<>{unallocatedCash >= 0 ? <>Unallocated cash <Money cents={unallocatedCash} /></> : <span className="text-critical">Envelopes exceed cash by <Money cents={-unallocatedCash} /></span>}</>} tone={unallocatedCash < 0 ? "critical" : "neutral"} hint="Allocations booked at month closes minus spending charged to each envelope." />
        <Stat label="Processor held" value={<Money cents={snapshot.cash.processorAvailable + snapshot.cash.processorRestricted} />} sub={<>Available <Money cents={snapshot.cash.processorAvailable} /> · Restricted <Money cents={snapshot.cash.processorRestricted} /></>} />
        <Stat label="Outstanding receivables" value={<Money cents={snapshot.cash.receivables} />} sub="Invoiced, not yet collected" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {groups.map((g) => (
            <Card key={g.title} title={g.title} subtitle={g.hint} padded={false}>
              <ul className="divide-y divide-border">
                {g.items.length === 0 && <li className="px-5 py-4 text-xs text-fg-faint">None.</li>}
                {g.items.map((a) => {
                  const bal = accountBalance(a, data.transactions, data.settings);
                  const usd = accountBalanceUsd(a, data.transactions, data.settings);
                  return (
                    <li key={a.id} className={clsx("flex flex-wrap items-center justify-between gap-3 px-5 py-3", a.isArchived && "opacity-50")}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {a.name}
                          <Badge>{ACCOUNT_ROLE_LABELS[a.role as AccountRole]}</Badge>
                          {a.isArchived && <Badge tone="neutral">archived</Badge>}
                        </div>
                        <div className="text-[11px] text-fg-faint">
                          {a.institution ?? a.kind} · {a.currency} · opening {formatMoney(a.openingBalanceMinor, a.currency as CurrencyCode)} on {a.openingBalanceDate}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className={clsx("tabular text-base font-semibold", bal < 0 && "text-critical")}>{formatMoney(bal, a.currency as CurrencyCode)}</div>
                          {a.currency !== "USD" && <div className="text-[11px] text-fg-faint"><Money cents={usd} currency="USD" /></div>}
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setSetBal(a)} title="Set the real balance from your statement"><Scale size={13} /> Set balance</Button>
                        <button className="rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg" onClick={() => setEdit(a)}><Pencil size={14} /></button>
                        <button className="rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg" title={a.isArchived ? "Unarchive" : "Archive"} onClick={() => { mutate((db) => archiveAccount(db, a.id, !a.isArchived)); toast.success(a.isArchived ? "Account restored" : "Account archived"); }}><Archive size={14} /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
          <button className="text-xs text-fg-faint hover:text-fg" onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Hide" : "Show"} archived accounts</button>
        </div>

        <Card title="Envelopes vs funded accounts" subtitle="Where the virtual allocation says money should be, and whether the matching real account holds it">
          <DefinitionList
            items={snapshot.envelopes.map((e) => ({
              label: (
                <span>
                  {BUCKET_LABELS[e.bucket]}
                  {e.fundedBalance !== null && e.balance > 0 && e.fundedBalance < e.balance * 0.95 && <Badge tone="caution" className="ml-2">underfunded</Badge>}
                </span>
              ),
              value: (
                <div className="text-right">
                  <div><Money cents={e.balance} /></div>
                  {e.fundedBalance !== null && <div className="text-[11px] text-fg-faint">account <Money cents={e.fundedBalance} /></div>}
                </div>
              ),
            }))}
          />
          <Callout tone="neutral" className="mt-4">
            Envelopes fill when you close a month. To make them real, transfer cash from the operating account into the tax, profit, savings and growth accounts and record the transfer here. Owner compensation has no account: it is paid out as draws.
          </Callout>
        </Card>
      </div>

      <AccountModal open={edit !== null} existing={edit === "new" ? null : edit} onClose={() => setEdit(null)} />
      {setBal && <SetBalanceModal account={setBal} onClose={() => setSetBal(null)} />}
      <TransactionForm open={transfer} onClose={() => setTransfer(false)} preset={{ type: "transfer" }} />
    </>
  );
}

function AccountModal({ open, existing, onClose }: { open: boolean; existing: Account | null; onClose: () => void }) {
  const { data, mutate } = useReady();
  const toast = useToast();
  const blank = { name: "", role: "operating" as AccountRole, kind: "bank", currency: "USD" as CurrencyCode, openingBalanceMinor: 0, openingBalanceDate: todayKey(), institution: "", entityId: "", isBusiness: true, notes: "" };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<string[]>([]);
  React.useEffect(() => {
    if (open) {
      setErrors([]);
      setF(existing ? { name: existing.name, role: existing.role as AccountRole, kind: existing.kind, currency: existing.currency as CurrencyCode, openingBalanceMinor: existing.openingBalanceMinor, openingBalanceDate: existing.openingBalanceDate, institution: existing.institution ?? "", entityId: existing.entityId ?? "", isBusiness: existing.isBusiness, notes: existing.notes ?? "" } : blank);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);
  return (
    <Modal open={open} onClose={onClose} title={existing ? "Edit account" : "New account"} description="Opening balance is the real balance on the opening date; the ledger does the rest." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { if (!f.name.trim()) return setErrors(["Name is required"]); mutate((db) => upsertAccount(db, { id: existing?.id, name: f.name.trim(), role: f.role, kind: f.kind, currency: f.currency, openingBalanceMinor: f.openingBalanceMinor, openingBalanceDate: f.openingBalanceDate, institution: f.institution || null, entityId: f.entityId || null, processorId: existing?.processorId ?? null, isBusiness: f.role === "personal" ? false : f.isBusiness, isArchived: existing?.isArchived ?? false, sortOrder: existing?.sortOrder ?? data.accounts.length + 1, notes: f.notes || null })); toast.success("Account saved"); onClose(); }}>Save</Button></>}>
      <div className="space-y-3">
        <FormError errors={errors} />
        <FormRow cols={2}>
          <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Institution"><Input value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} placeholder="Mercury, Wise, Meezan…" /></Field>
        </FormRow>
        <FormRow cols={3}>
          <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as AccountRole, isBusiness: e.target.value !== "personal" })}>{ACCOUNT_ROLES.map((r) => <option key={r} value={r}>{ACCOUNT_ROLE_LABELS[r]}</option>)}</Select></Field>
          <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="bank">Bank</option><option value="processor">Processor</option><option value="cash">Cash</option><option value="virtual">Virtual</option></Select></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as CurrencyCode })}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        </FormRow>
        <FormRow cols={3}>
          <Field label="Opening balance"><MoneyInput value={f.openingBalanceMinor} onChange={(v) => setF({ ...f, openingBalanceMinor: v })} currency={f.currency} allowNegative /></Field>
          <Field label="Opening date"><Input type="date" value={f.openingBalanceDate} onChange={(e) => setF({ ...f, openingBalanceDate: e.target.value })} /></Field>
          <Field label="Entity"><Select value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value })}><option value="">—</option>{data.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
        </FormRow>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function SetBalanceModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const { data, mutate } = useReady();
  const toast = useToast();
  const current = accountBalance(account, data.transactions, data.settings);
  const [target, setTarget] = useState(current);
  const [date, setDate] = useState(todayKey());
  const [note, setNote] = useState("Reconciled to statement");
  const delta = target - current;
  return (
    <Modal open onClose={onClose} title={`Set balance: ${account.name}`} description="Records a balance adjustment so the ledger matches your real statement. Use it for interest, bank fees or anything you did not record individually." size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={delta === 0} onClick={() => { try { mutate((db, d) => recordBalanceAdjustment(db, account.id, delta, date, note, d.settings, d.fxRates)); toast.success("Balance adjusted"); onClose(); } catch (e) { toast.error("Could not adjust", e instanceof Error ? e.message : String(e)); } }}>Record adjustment</Button></>}>
      <div className="space-y-3">
        <div className="text-sm text-fg-muted">Ledger balance now: <span className="font-medium text-fg">{formatMoney(current, account.currency as CurrencyCode)}</span></div>
        <Field label={`Actual balance (${account.currency})`}><MoneyInput value={target} onChange={setTarget} currency={account.currency as CurrencyCode} allowNegative /></Field>
        <FormRow cols={2}>
          <Field label="As of"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </FormRow>
        <div className="rounded-lg border border-border bg-surface-2/50 p-3 text-sm">Adjustment: <span className={clsx("font-medium", delta < 0 ? "text-critical" : "text-positive")}>{formatMoney(delta, account.currency as CurrencyCode, { signed: true })}</span></div>
      </div>
    </Modal>
  );
}
