"use client";

import React, { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, ArrowRightLeft } from "lucide-react";
import type { HouseholdBudgetLine } from "@/db/schema";
import { useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { Money, Pct } from "@/components/Money";
import { PageHeader, Card, Stat, Progress, spendTone, Button, Callout, DefinitionList, Badge } from "@/components/ui/primitives";
import { Field, Input, Select, Textarea, MoneyInput, FormRow } from "@/components/ui/forms";
import { Table } from "@/components/ui/Table";
import { Modal } from "@/components/ui/Modal";
import { TransactionForm } from "@/components/TransactionForm";
import { TrendLine, SimpleBars } from "@/components/charts";
import { upsertHouseholdLine, deleteHouseholdLine, updateSettings } from "@/db/repo";
import { personalSpendTrend, householdLinesMinor } from "@/engine/owner";
import { lastNMonths, monthLabel } from "@/lib/dates";
import { convertToUsdCents, formatMoney, CURRENCY_CODES, type CurrencyCode } from "@/lib/money";

export default function PersonalPage() {
  const { data, snapshot, mutate, month } = useReady();
  const toast = useToast();
  const own = snapshot.owner;
  const [lineEdit, setLineEdit] = useState<HouseholdBudgetLine | null | "new">(null);
  const [spend, setSpend] = useState<"household_expense" | "personal_expense" | null>(null);
  const [draw, setDraw] = useState(false);
  const [budget, setBudget] = useState(data.settings.householdBudgetUsdCents);
  const [goal, setGoal] = useState(data.settings.discretionaryGoalUsdCents);
  const trend = useMemo(() => personalSpendTrend(data.transactions, lastNMonths(month, 6)).map((t) => ({ ...t, label: monthLabel(t.month) })), [data.transactions, month]);
  const catName = new Map(data.categories.map((c) => [c.id, c.name]));
  const linesPkr = householdLinesMinor(data.householdLines.filter((l) => l.currency === "PKR"));
  const rate = data.settings.defaultFxRatePkrPerUsd;

  return (
    <>
      <PageHeader
        title="Owner & personal finance"
        description="Owner compensation is the total budget. Household costs come out first; what remains is discretionary. Draws are transfers from the business, household and personal spending are paid from the personal account, so nothing is counted twice."
        actions={
          <>
            <Button onClick={() => setDraw(true)}><ArrowRightLeft size={14} /> Record owner draw</Button>
            <Button onClick={() => setSpend("household_expense")}><Plus size={14} /> Household expense</Button>
            <Button variant="primary" onClick={() => setSpend("personal_expense")}><Plus size={14} /> Personal expense</Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Owner compensation target" value={<Money cents={own.target} />} sub={`${snapshot.policy.ownerPct}% of allocatable revenue`} />
        <Stat label="Actually drawn" value={<Money cents={own.drawn} />} sub={<>{own.undrawn >= 0 ? <>Undrawn <Money cents={own.undrawn} /> stays in business cash</> : <span className="text-caution">Drawn <Money cents={-own.undrawn} /> over target</span>}</>} />
        <Stat label="Household spending" value={<Money cents={own.householdActual} />} sub={<>of <Money cents={own.householdBudget} /> budget · {formatMoney(own.householdActualPkr, "PKR")}</>} tone={spendTone(own.householdActual, own.householdBudget) === "critical" ? "critical" : "neutral"} />
        <Stat label="Discretionary balance" value={<Money cents={own.discretionaryAvailable} />} sub={<>Spent <Money cents={own.discretionaryActual} /> · remaining <Money cents={own.remainingPersonalBudget} /></>} tone={own.remainingPersonalBudget < 0 ? "critical" : "neutral"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="This month" subtitle="How the compensation budget is being used">
          <DefinitionList
            items={[
              { label: "Owner compensation", value: <Money cents={own.target} /> },
              { label: "− Household actual", value: <Money cents={own.householdActual} /> },
              { label: "= Available discretionary income", value: <span className="font-semibold"><Money cents={own.discretionaryAvailable} /></span> },
              { label: "− Discretionary spent", value: <Money cents={own.discretionaryActual} /> },
              { label: "= Remaining personal budget", value: <Money cents={own.remainingPersonalBudget} tone="auto" className="font-semibold" /> },
              { label: "Monthly personal savings (drawn − spent)", value: <Money cents={own.personalSavings} tone="auto" />, hint: "Cash kept from what was actually drawn." },
            ]}
          />
          <div className="mt-4 space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-fg-muted"><span>Household vs budget</span><Pct value={own.householdBudget > 0 ? (own.householdActual / own.householdBudget) * 100 : null} digits={0} /></div>
              <Progress value={own.householdActual} max={own.householdBudget} tone={spendTone(own.householdActual, own.householdBudget)} />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-fg-muted"><span>Total personal spend vs compensation</span><Pct value={own.target > 0 ? ((own.householdActual + own.discretionaryActual) / own.target) * 100 : null} digits={0} /></div>
              <Progress value={own.householdActual + own.discretionaryActual} max={own.target} tone={spendTone(own.householdActual + own.discretionaryActual, own.target)} />
            </div>
          </div>
        </Card>

        <Card title="Long-term goal" subtitle="$5,000/month discretionary is a destination, not a commitment">
          <div className="tabular text-2xl font-semibold"><Money cents={own.discretionaryGoal} /></div>
          <p className="mt-1 text-xs text-fg-muted">Current discretionary available: <Money cents={Math.max(0, own.discretionaryAvailable)} />. Gap: <Money cents={own.discretionaryGoalGap} />.</p>
          <Progress className="mt-3" value={Math.max(0, own.discretionaryAvailable)} max={own.discretionaryGoal} tone="accent" />
          <p className="mt-3 text-xs text-fg-faint">
            At {snapshot.policy.ownerPct}% owner compensation and a <Money cents={own.householdBudget} /> household budget, reaching the goal needs about <Money cents={Math.round(((own.discretionaryGoal + own.householdBudget) * 100) / Number(snapshot.policy.ownerPct || 1))} /> of monthly net revenue. Use Scenarios to model it.
          </p>
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <Field label="Household budget ceiling (USD/month)" hint="A planning ceiling, not an amount to spend.">
              <MoneyInput value={budget} onChange={setBudget} />
            </Field>
            <Field label="Discretionary goal (USD/month)">
              <MoneyInput value={goal} onChange={setGoal} />
            </Field>
            <Button size="sm" variant="primary" onClick={() => { mutate((db) => updateSettings(db, { householdBudgetUsdCents: budget, discretionaryGoalUsdCents: goal })); toast.success("Personal budgets saved"); }}>Save budgets</Button>
          </div>
        </Card>

        <Card title="Spending by category" subtitle={`${monthLabel(month)}, USD`}>
          {own.byCategory.length === 0 ? <p className="text-xs text-fg-faint">No personal spending recorded this month.</p> : <SimpleBars data={own.byCategory.map((c) => ({ label: c.name, value: c.amount }))} color="var(--chart-2)" height={220} />}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card
          title="Household budget lines"
          subtitle={<>Planned monthly household costs. Total {formatMoney(linesPkr, "PKR")} ≈ <Money cents={own.householdLinesBudget} currency="USD" /> at {rate} PKR/USD.</>}
          className="lg:col-span-2"
          actions={<Button size="sm" onClick={() => setLineEdit("new")}><Plus size={13} /> Line</Button>}
          padded={false}
        >
          <Table
            dense
            className="rounded-t-none border-0"
            columns={[
              { key: "n", header: "Line", render: (l: HouseholdBudgetLine) => <div><span className="font-medium">{l.name}</span>{!l.isActive && <Badge className="ml-2">inactive</Badge>}<div className="text-[11px] text-fg-faint">{l.categoryId ? catName.get(l.categoryId) : "—"}{l.notes ? ` · ${l.notes}` : ""}</div></div> },
              { key: "a", header: "Budget", align: "right", render: (l: HouseholdBudgetLine) => formatMoney(l.amountMinor, l.currency as CurrencyCode) },
              { key: "u", header: "USD", align: "right", render: (l: HouseholdBudgetLine) => <Money cents={convertToUsdCents(l.amountMinor, l.currency as CurrencyCode, l.currency === "USD" ? "1" : rate)} currency="USD" /> },
              { key: "s", header: `Spent ${monthLabel(month)}`, align: "right", render: (l: HouseholdBudgetLine) => <Money cents={data.transactions.filter((t) => t.month === month && t.type === "household_expense" && t.categoryId === l.categoryId).reduce((a, t) => a + t.amountUsdCents, 0)} currency="USD" /> },
              { key: "x", header: "", align: "right", width: "80px", render: (l: HouseholdBudgetLine) => <div className="flex justify-end gap-1"><button className="rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg" onClick={() => setLineEdit(l)}><Pencil size={14} /></button><button className="rounded p-1 text-fg-faint hover:bg-critical-soft hover:text-critical" onClick={() => { mutate((db) => deleteHouseholdLine(db, l.id)); toast.success("Line removed"); }}><Trash2 size={14} /></button></div> },
            ]}
            rows={data.householdLines}
            rowKey={(l) => l.id}
          />
          {own.householdLinesBudget > own.householdBudget && (
            <div className="p-4"><Callout tone="caution" title="Budget lines exceed the household ceiling">Lines total <Money cents={own.householdLinesBudget} /> against a <Money cents={own.householdBudget} /> ceiling. Either trim lines or raise the ceiling deliberately.</Callout></div>
          )}
        </Card>
        <Card title="Personal spending trend" subtitle="Last 6 months, USD">
          <TrendLine data={trend} series={[{ key: "household", name: "Household", color: "var(--chart-2)" }, { key: "discretionary", name: "Discretionary", color: "var(--chart-4)" }, { key: "drawn", name: "Drawn", color: "var(--chart-1)" }]} height={240} />
        </Card>
      </div>

      <HouseholdLineModal open={lineEdit !== null} existing={lineEdit === "new" ? null : lineEdit} onClose={() => setLineEdit(null)} />
      <TransactionForm open={!!spend} onClose={() => setSpend(null)} preset={spend ? { type: spend, currency: "PKR" } : undefined} />
      <TransactionForm open={draw} onClose={() => setDraw(false)} preset={{ type: "owner_draw", amountMinor: Math.max(0, own.undrawn), description: `Owner draw ${monthLabel(month)}` }} />
    </>
  );
}

function HouseholdLineModal({ open, existing, onClose }: { open: boolean; existing: HouseholdBudgetLine | null; onClose: () => void }) {
  const { data, mutate } = useReady();
  const toast = useToast();
  const personalCats = data.categories.filter((c) => c.scope === "personal");
  const [f, setF] = useState({ name: "", categoryId: personalCats[0]?.id ?? "", amountMinor: 0, currency: "PKR" as CurrencyCode, isActive: true, notes: "" });
  React.useEffect(() => {
    if (open) setF({ name: existing?.name ?? "", categoryId: existing?.categoryId ?? personalCats[0]?.id ?? "", amountMinor: existing?.amountMinor ?? 0, currency: (existing?.currency as CurrencyCode) ?? "PKR", isActive: existing?.isActive ?? true, notes: existing?.notes ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);
  return (
    <Modal open={open} onClose={onClose} title={existing ? "Edit budget line" : "New household budget line"} size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim()} onClick={() => { mutate((db) => upsertHouseholdLine(db, { id: existing?.id, name: f.name.trim(), categoryId: f.categoryId || null, amountMinor: f.amountMinor, currency: f.currency, isActive: f.isActive, notes: f.notes || null, sortOrder: existing?.sortOrder ?? data.householdLines.length + 1 })); toast.success("Saved"); onClose(); }}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <FormRow cols={2}>
          <Field label="Monthly amount"><MoneyInput value={f.amountMinor} onChange={(v) => setF({ ...f, amountMinor: v })} currency={f.currency} /></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as CurrencyCode })}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        </FormRow>
        <Field label="Category"><Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>{personalCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Active"><Select value={f.isActive ? "1" : "0"} onChange={(e) => setF({ ...f, isActive: e.target.value === "1" })}><option value="1">Active</option><option value="0">Inactive</option></Select></Field>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
