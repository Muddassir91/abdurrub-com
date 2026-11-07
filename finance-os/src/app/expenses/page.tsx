"use client";

import React, { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Receipt, CalendarClock } from "lucide-react";
import type { RecurringExpense, Vendor } from "@/db/schema";
import { useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { Money, Pct } from "@/components/Money";
import { PageHeader, Card, Stat, Progress, spendTone, Badge, Button, Tabs, Callout, DefinitionList } from "@/components/ui/primitives";
import { Field, Input, Select, Textarea, MoneyInput, Checkbox, FormRow, FormError } from "@/components/ui/forms";
import { Table, type Column } from "@/components/ui/Table";
import { Modal, ConfirmModal } from "@/components/ui/Modal";
import { TransactionForm } from "@/components/TransactionForm";
import { SimpleBars } from "@/components/charts";
import { upsertRecurring, deleteRecurring, logRenewal, upsertVendor, deleteVendor } from "@/db/repo";
import { monthlyCostUsd, upcomingRenewals } from "@/engine/expenses";
import { evaluateInvestment } from "@/engine/investment";
import { FREQUENCIES, FREQUENCY_LABELS, type Frequency } from "@/lib/constants";
import { CURRENCY_CODES, formatMoney, type CurrencyCode } from "@/lib/money";
import { dateLabel, todayKey } from "@/lib/dates";

type Tab = "subscriptions" | "vendors";

export default function ExpensesPage() {
  const { data, snapshot, mutate, today } = useReady();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("subscriptions");
  const [editing, setEditing] = useState<RecurringExpense | null | "new">(null);
  const [deleting, setDeleting] = useState<RecurringExpense | null>(null);
  const [logging, setLogging] = useState<RecurringExpense | null>(null);
  const [oneOff, setOneOff] = useState(false);
  const [vendorEdit, setVendorEdit] = useState<Vendor | null | "new">(null);
  const ex = snapshot.expenses;
  const vendorName = useMemo(() => new Map(data.vendors.map((v) => [v.id, v.name])), [data.vendors]);
  const catName = useMemo(() => new Map(data.categories.map((c) => [c.id, c.name])), [data.categories]);
  const renewals = upcomingRenewals(data.recurringExpenses, today, 30);

  const subs = data.recurringExpenses.slice().sort((a, b) => monthlyCostUsd(b, data.settings) - monthlyCostUsd(a, data.settings));
  const activeMonthly = subs.filter((r) => r.status === "active").reduce((a, r) => a + monthlyCostUsd(r, data.settings), 0);

  const statusTone = (s: string) => (s === "active" ? "positive" : s === "needs_config" ? "caution" : s === "proposed" ? "info" : "neutral");

  const columns: Column<RecurringExpense>[] = [
    {
      key: "name",
      header: "Subscription",
      render: (r) => (
        <div>
          <div className="flex items-center gap-2 font-medium">
            {r.name} <Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge>
            {r.isEssential && <Badge>essential</Badge>}
          </div>
          <div className="text-[11px] text-fg-faint">
            {r.vendorId ? vendorName.get(r.vendorId) : "—"} · {r.categoryId ? catName.get(r.categoryId) : "uncategorised"} · {r.costType === "direct_delivery" ? "delivery cost" : r.bucket === "growth" ? "growth envelope" : "overhead"}
          </div>
        </div>
      ),
    },
    { key: "amount", header: "Billing", align: "right", render: (r) => <div><div>{formatMoney(r.amountMinor, r.currency as CurrencyCode)}</div><div className="text-[11px] text-fg-faint">{FREQUENCY_LABELS[r.frequency as Frequency]}</div></div> },
    { key: "monthly", header: "Monthly (USD)", align: "right", render: (r) => <Money cents={monthlyCostUsd(r, data.settings)} /> },
    { key: "renewal", header: "Next renewal", render: (r) => <span className={r.nextRenewalDate && r.nextRenewalDate <= today ? "text-caution" : "text-fg-muted"}>{dateLabel(r.nextRenewalDate)}</span> },
    { key: "just", header: "Justification", render: (r) => <span className="line-clamp-2 max-w-xs text-xs text-fg-muted">{r.justification ?? <span className="text-caution">none documented</span>}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "150px",
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setLogging(r)} disabled={r.status !== "active"} title="Record this month's charge">
            <Receipt size={13} /> Log charge
          </Button>
          <button className="rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg" onClick={() => setEditing(r)} aria-label="Edit">
            <Pencil size={14} />
          </button>
          <button className="rounded p-1 text-fg-faint hover:bg-critical-soft hover:text-critical" onClick={() => setDeleting(r)} aria-label="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Business expenses"
        description="The operating allowance is a maximum, not a spending target. Every recurring cost needs a business justification; delivery costs are tracked separately from overhead."
        actions={
          <>
            <Button onClick={() => setOneOff(true)}>
              <Plus size={14} /> One-time purchase
            </Button>
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus size={14} /> New subscription
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Monthly expense ceiling" value={<Money cents={ex.ceiling} />} sub={ex.ceilingSource === "override" ? "Approved override" : `${snapshot.policy.opexPct}% of allocatable revenue`} />
        <Stat label="Actual overhead this month" value={<Money cents={ex.overheadActual} />} sub={<>Delivery costs <Money cents={ex.directDeliveryActual} /> (separate)</>} />
        <Stat label="Remaining allowance" value={<Money cents={ex.remainingAllowance} />} tone={ex.remainingAllowance < 0 ? "critical" : "positive"} sub="Unspent allowance stays in business cash" />
        <Stat label="Spend vs ceiling" value={<Pct value={ex.spendPct} digits={0} />} sub={<>Opex ratio <Pct value={ex.opexRatioPct} /> of net revenue</>} tone={spendTone(ex.overheadActual, ex.ceiling) === "critical" ? "critical" : "neutral"} />
      </div>
      <Progress className="mt-3" value={ex.overheadActual} max={ex.ceiling} tone={spendTone(ex.overheadActual, ex.ceiling)} />

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Committed subscriptions" subtitle="Active recurring overhead, normalised to monthly" className="lg:col-span-1">
          <div className="tabular text-2xl font-semibold">
            <Money cents={activeMonthly} />
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            {activeMonthly > ex.ceiling && ex.ceiling > 0 ? <span className="text-critical">Already above this month&apos;s ceiling before any one-off spend.</span> : ex.ceiling > 0 ? <>Leaves <Money cents={Math.max(0, ex.ceiling - activeMonthly)} /> for one-off purchases inside the ceiling.</> : "No revenue collected yet this month, so the ceiling is zero."}
          </p>
          <DefinitionList
            className="mt-3"
            items={[
              { label: "Essential monthly cost", value: <Money cents={ex.essentialMonthly} />, hint: "Drives the reserve target." },
              { label: "Gross margin", value: <Pct value={ex.grossMarginPct} /> },
              { label: "Operating margin", value: <Pct value={ex.operatingMarginPct} /> },
            ]}
          />
        </Card>
        <Card title="Spend by category this month" className="lg:col-span-1">
          {ex.byCategory.length === 0 ? <p className="text-xs text-fg-faint">No business spend recorded yet this month.</p> : <SimpleBars data={ex.byCategory.map((c) => ({ label: c.name, value: c.amount }))} height={200} />}
        </Card>
        <Card title="Upcoming renewals (30 days)" className="lg:col-span-1">
          {renewals.length === 0 ? (
            <p className="text-xs text-fg-faint">No renewals in the next 30 days.</p>
          ) : (
            <ul className="space-y-2">
              {renewals.map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="flex items-center gap-1 text-[11px] text-fg-faint">
                      <CalendarClock size={11} /> {dateLabel(r.nextRenewalDate)}
                    </div>
                  </div>
                  <div className="tabular text-right text-sm">{formatMoney(r.amountMinor, r.currency as CurrencyCode)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 mb-3 flex items-center justify-between">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "subscriptions", label: "Subscriptions", count: subs.length },
            { value: "vendors", label: "Vendors", count: data.vendors.length },
          ]}
        />
        {tab === "vendors" && (
          <Button size="sm" onClick={() => setVendorEdit("new")}>
            <Plus size={13} /> Vendor
          </Button>
        )}
      </div>
      {tab === "subscriptions" ? (
        <Table columns={columns} rows={subs} rowKey={(r) => r.id} empty="No subscriptions yet." />
      ) : (
        <Table
          columns={[
            { key: "name", header: "Vendor", render: (v: Vendor) => <span className="font-medium">{v.name}</span> },
            { key: "web", header: "Website", render: (v: Vendor) => (v.website ? <a className="text-accent hover:underline" href={v.website} target="_blank" rel="noreferrer">{v.website}</a> : "—") },
            { key: "subs", header: "Subscriptions", render: (v: Vendor) => data.recurringExpenses.filter((r) => r.vendorId === v.id).map((r) => r.name).join(", ") || "—" },
            { key: "spend", header: "Spent this month", align: "right", render: (v: Vendor) => <Money cents={data.transactions.filter((t) => t.vendorId === v.id && t.month === snapshot.month).reduce((a, t) => a + t.amountUsdCents, 0)} /> },
            {
              key: "a",
              header: "",
              align: "right",
              render: (v: Vendor) => (
                <div className="flex justify-end gap-1">
                  <button className="rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg" onClick={() => setVendorEdit(v)}><Pencil size={14} /></button>
                  <button className="rounded p-1 text-fg-faint hover:bg-critical-soft hover:text-critical" onClick={() => { mutate((db) => deleteVendor(db, v.id)); toast.success("Vendor removed"); }}><Trash2 size={14} /></button>
                </div>
              ),
            },
          ]}
          rows={data.vendors}
          rowKey={(v) => v.id}
        />
      )}

      <SubscriptionModal open={editing !== null} existing={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      <VendorModal open={vendorEdit !== null} existing={vendorEdit === "new" ? null : vendorEdit} onClose={() => setVendorEdit(null)} />
      <TransactionForm open={oneOff} onClose={() => setOneOff(false)} preset={{ type: "expense", costType: "overhead", isRecurring: false }} />
      <LogChargeModal sub={logging} onClose={() => setLogging(null)} />
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        confirmLabel="Delete"
        title="Delete subscription?"
        body={deleting && <>Removes <strong>{deleting.name}</strong> from recurring tracking. Past ledger rows stay in place. If you simply stopped paying, mark it cancelled instead so history stays meaningful.</>}
        onConfirm={() => {
          if (!deleting) return;
          mutate((db) => deleteRecurring(db, deleting.id));
          toast.success("Subscription deleted");
        }}
      />
    </>
  );
}

/* ---------------------------------------------------------- subscription modal */

function SubscriptionModal({ open, existing, onClose }: { open: boolean; existing: RecurringExpense | null; onClose: () => void }) {
  const { data, snapshot, mutate } = useReady();
  const toast = useToast();
  const blank = () => ({
    name: "",
    vendorId: "" as string,
    amountMinor: 0,
    currency: "USD" as CurrencyCode,
    frequency: "monthly" as Frequency,
    categoryId: data.categories.find((c) => c.scope === "business")?.id ?? "",
    costType: "overhead" as "overhead" | "direct_delivery",
    bucket: "opex" as "opex" | "growth",
    accountId: data.accounts.find((a) => a.role === "operating")?.id ?? "",
    nextRenewalDate: todayKey(),
    status: "active",
    isEssential: false,
    justification: "",
    roiEstimateUsdCents: 0,
    notes: "",
    expectedAdditionalRevenue: 0,
  });
  const [f, setF] = useState(blank());
  const [errors, setErrors] = useState<string[]>([]);
  React.useEffect(() => {
    if (!open) return;
    setErrors([]);
    setF(
      existing
        ? {
            name: existing.name,
            vendorId: existing.vendorId ?? "",
            amountMinor: existing.amountMinor,
            currency: existing.currency as CurrencyCode,
            frequency: existing.frequency as Frequency,
            categoryId: existing.categoryId ?? "",
            costType: existing.costType as "overhead" | "direct_delivery",
            bucket: existing.bucket as "opex" | "growth",
            accountId: existing.accountId ?? "",
            nextRenewalDate: existing.nextRenewalDate ?? todayKey(),
            status: existing.status,
            isEssential: existing.isEssential,
            justification: existing.justification ?? "",
            roiEstimateUsdCents: existing.roiEstimateUsdCents ?? 0,
            notes: existing.notes ?? "",
            expectedAdditionalRevenue: existing.roiEstimateUsdCents ?? 0,
          }
        : blank(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);

  const monthly = useMemo(() => monthlyCostUsd({ amountMinor: f.amountMinor, currency: f.currency, frequency: f.frequency } as RecurringExpense, data.settings), [f.amountMinor, f.currency, f.frequency, data.settings]);
  const isNewRecurring = !existing || existing.status !== "active";
  const evaluation = useMemo(() => (isNewRecurring && f.status === "active" && monthly > 0 ? evaluateInvestment(snapshot, data.settings, { type: "subscription", monthlyCost: monthly, oneTimeCost: 0, expectedAdditionalRevenue: f.expectedAdditionalRevenue, deliveryCapacity: 0, costType: f.costType, bucket: f.bucket }) : null), [isNewRecurring, f.status, monthly, f.expectedAdditionalRevenue, f.costType, f.bucket, snapshot, data.settings]);

  const save = () => {
    const errs: string[] = [];
    if (!f.name.trim()) errs.push("Name is required");
    if (f.amountMinor <= 0 && f.status === "active") errs.push("Amount is required for an active subscription (use 'needs configuration' if unknown)");
    if (f.status === "active" && !f.justification.trim()) errs.push("Document a business justification before activating a recurring expense");
    if (errs.length) return setErrors(errs);
    mutate((db) =>
      upsertRecurring(db, {
        id: existing?.id,
        name: f.name.trim(),
        vendorId: f.vendorId || null,
        amountMinor: f.amountMinor,
        currency: f.currency,
        frequency: f.frequency,
        categoryId: f.categoryId || null,
        costType: f.costType,
        bucket: f.bucket,
        accountId: f.accountId || null,
        startDate: existing?.startDate ?? todayKey(),
        nextRenewalDate: f.nextRenewalDate || null,
        cancelledAt: f.status === "cancelled" ? (existing?.cancelledAt ?? todayKey()) : null,
        status: f.status,
        isEssential: f.isEssential,
        justification: f.justification.trim() || null,
        roiEstimateUsdCents: f.expectedAdditionalRevenue || null,
        notes: f.notes.trim() || null,
      }),
    );
    toast.success(existing ? "Subscription updated" : "Subscription added");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : "New recurring expense"}
      description="Approving a recurring cost is a financial decision. The evaluation below shows what it does to your operating ratio before you commit."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {existing ? "Save" : f.status === "active" ? "Approve and add" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError errors={errors} />
        <FormRow cols={2}>
          <Field label="Name" required>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Google Workspace" />
          </Field>
          <Field label="Vendor">
            <Select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })}>
              <option value="">— none —</option>
              {data.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
        </FormRow>
        <FormRow cols={4}>
          <Field label="Amount" required>
            <MoneyInput value={f.amountMinor} onChange={(v) => setF({ ...f, amountMinor: v })} currency={f.currency} />
          </Field>
          <Field label="Currency">
            <Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as CurrencyCode })}>
              {CURRENCY_CODES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Frequency">
            <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Frequency })}>
              {FREQUENCIES.map((fr) => (
                <option key={fr} value={fr}>
                  {FREQUENCY_LABELS[fr]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next renewal">
            <Input type="date" value={f.nextRenewalDate} onChange={(e) => setF({ ...f, nextRenewalDate: e.target.value })} />
          </Field>
        </FormRow>
        <FormRow cols={4}>
          <Field label="Category">
            <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
              {data.categories.filter((c) => c.scope === "business").map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cost type">
            <Select value={f.costType} onChange={(e) => setF({ ...f, costType: e.target.value as "overhead" | "direct_delivery" })}>
              <option value="overhead">General overhead</option>
              <option value="direct_delivery">Direct delivery</option>
            </Select>
          </Field>
          <Field label="Envelope">
            <Select value={f.bucket} onChange={(e) => setF({ ...f, bucket: e.target.value as "opex" | "growth" })}>
              <option value="opex">Operating</option>
              <option value="growth">Growth investment</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="proposed">Proposed</option>
              <option value="needs_config">Needs configuration</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>
        </FormRow>
        <FormRow cols={2}>
          <Field label="Paid from account">
            <Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
              {data.accounts.filter((a) => a.isBusiness && !a.isArchived).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Expected additional monthly revenue (optional ROI estimate)">
            <MoneyInput value={f.expectedAdditionalRevenue} onChange={(v) => setF({ ...f, expectedAdditionalRevenue: v })} />
          </Field>
        </FormRow>
        <Field label="Business justification" required={f.status === "active"}>
          <Textarea value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} placeholder="What does this tool do for revenue, delivery or time?" />
        </Field>
        <Checkbox label="Essential to keep the business running" hint="Counts toward the reserve target (3–6 months of essential costs)." checked={f.isEssential} onChange={(v) => setF({ ...f, isEssential: v })} />

        {evaluation && (
          <Callout tone={evaluation.verdict === "affordable" ? "positive" : evaluation.verdict === "conditional" ? "caution" : "critical"} title={`Evaluation: ${evaluation.verdict.replace("_", " ")}`}>
            <DefinitionList
              className="mt-1"
              items={[
                { label: "Current monthly net revenue", value: <Money cents={evaluation.currentMonthlyRevenue} /> },
                { label: "Current operating expense ratio", value: <Pct value={evaluation.currentOpexRatioPct} /> },
                { label: "New expense (monthly)", value: <Money cents={evaluation.newMonthlyCost} /> },
                { label: "Projected ratio", value: <Pct value={evaluation.newOpexRatioPct} /> },
                { label: "Remaining allowance after", value: <Money cents={evaluation.remainingAllowance - evaluation.newMonthlyCost} /> },
                { label: "Revenue needed to carry it inside the ceiling", value: <Money cents={evaluation.revenueNeededToFundInsideCeiling} /> },
                { label: "Monthly break-even requirement", value: <Money cents={evaluation.monthlyBreakEvenRevenue} /> },
                { label: "Expected net monthly benefit", value: <Money cents={evaluation.expectedNetMonthlyBenefit} tone="auto" /> },
              ]}
            />
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs">
              {evaluation.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Callout>
        )}
      </div>
    </Modal>
  );
}

function LogChargeModal({ sub, onClose }: { sub: RecurringExpense | null; onClose: () => void }) {
  const { mutate } = useReady();
  const toast = useToast();
  const [date, setDate] = useState(todayKey());
  const [amount, setAmount] = useState(0);
  React.useEffect(() => {
    if (sub) {
      setDate(sub.nextRenewalDate && sub.nextRenewalDate <= todayKey() ? sub.nextRenewalDate : todayKey());
      setAmount(sub.amountMinor);
    }
  }, [sub]);
  if (!sub) return null;
  return (
    <Modal
      open={!!sub}
      onClose={onClose}
      title={`Log charge: ${sub.name}`}
      description="Creates the ledger row and rolls the renewal date forward."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              try {
                mutate((db, d) => logRenewal(db, sub.id, date, d.settings, d.fxRates, amount));
                toast.success("Charge recorded");
                onClose();
              } catch (e) {
                toast.error("Could not record", e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Record charge
          </Button>
        </>
      }
    >
      <FormRow cols={2}>
        <Field label="Charge date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={`Amount (${sub.currency})`}>
          <MoneyInput value={amount} onChange={setAmount} currency={sub.currency as CurrencyCode} />
        </Field>
      </FormRow>
    </Modal>
  );
}

function VendorModal({ open, existing, onClose }: { open: boolean; existing: Vendor | null; onClose: () => void }) {
  const { mutate } = useReady();
  const toast = useToast();
  const [f, setF] = useState({ name: "", website: "", notes: "" });
  React.useEffect(() => {
    if (open) setF({ name: existing?.name ?? "", website: existing?.website ?? "", notes: existing?.notes ?? "" });
  }, [open, existing]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? "Edit vendor" : "New vendor"}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!f.name.trim()}
            onClick={() => {
              mutate((db) => upsertVendor(db, { id: existing?.id, name: f.name.trim(), website: f.website.trim() || null, notes: f.notes.trim() || null }));
              toast.success("Vendor saved");
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Website">
          <Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://" />
        </Field>
        <Field label="Notes">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
