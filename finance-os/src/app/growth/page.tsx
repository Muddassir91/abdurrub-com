"use client";

import React, { useMemo, useState } from "react";
import { Plus, Trash2, CheckCircle2, XCircle, Calculator } from "lucide-react";
import type { GrowthProposal } from "@/db/schema";
import { useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { Money, Pct } from "@/components/Money";
import { PageHeader, Card, Stat, Badge, Button, Callout, DefinitionList, Progress, Tabs } from "@/components/ui/primitives";
import { Field, Input, Select, Textarea, MoneyInput, FormRow, FormError } from "@/components/ui/forms";
import { Modal } from "@/components/ui/Modal";
import { TransactionForm } from "@/components/TransactionForm";
import { upsertGrowthProposal, deleteGrowthProposal, upsertRecurring } from "@/db/repo";
import { evaluateInvestment, type InvestmentInput, type InvestmentEvaluation } from "@/engine/investment";
import { dateLabel, todayKey } from "@/lib/dates";

const TYPE_LABEL: Record<string, string> = { subscription: "New subscription", hire: "Hire", one_time: "One-time investment", channel: "New acquisition channel" };

export default function GrowthPage() {
  const { data, snapshot, mutate } = useReady();
  const toast = useToast();
  const [open, setOpen] = useState<GrowthProposal | null | "new">(null);
  const [tab, setTab] = useState<"proposed" | "approved" | "rejected">("proposed");
  const [spend, setSpend] = useState(false);
  const growthEnv = snapshot.envelopes.find((e) => e.bucket === "growth")!;
  const list = data.growthProposals.filter((g) => g.status === tab).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const decide = (g: GrowthProposal, status: "approved" | "rejected", note?: string) => {
    mutate((db) => {
      upsertGrowthProposal(db, { ...g, status, decidedAt: todayKey(), decisionNote: note ?? g.decisionNote });
      if (status === "approved" && (g.type === "subscription" || g.type === "channel") && g.monthlyCostUsdCents > 0) {
        upsertRecurring(db, { name: g.name, amountMinor: g.monthlyCostUsdCents, currency: "USD", frequency: "monthly", categoryId: data.categories.find((c) => c.scope === "business" && c.name === (g.type === "channel" ? "Lead generation" : "Software and AI"))?.id ?? null, costType: g.costType, bucket: g.bucket, accountId: data.accounts.find((a) => a.role === (g.bucket === "growth" ? "growth" : "operating"))?.id ?? null, startDate: todayKey(), nextRenewalDate: todayKey(), status: "active", isEssential: false, justification: g.expectedBenefit ?? g.description ?? "Approved growth investment", roiEstimateUsdCents: g.expectedAdditionalRevenueUsdCents || null });
      }
    });
    toast.success(status === "approved" ? "Approved" + ((g.type === "subscription" || g.type === "channel") && g.monthlyCostUsdCents > 0 ? " and added to subscriptions" : "") : "Rejected");
  };

  return (
    <>
      <PageHeader
        title="Growth & hiring"
        description="The growth envelope exists to grow the agency. Having money in it is never, on its own, a reason to spend it. Every proposal is evaluated against revenue, ratio, margin and reserves before approval."
        actions={
          <>
            <Button onClick={() => setSpend(true)}><Plus size={14} /> Record growth spend</Button>
            <Button variant="primary" onClick={() => setOpen("new")}><Calculator size={14} /> Evaluate a proposal</Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Growth allocation this month" value={<Money cents={snapshot.allocations.growth} />} sub={`${snapshot.policy.growthPct}% of allocatable revenue`} />
        <Stat label="Growth envelope balance" value={<Money cents={growthEnv.balance} />} sub={<>Funded in growth account <Money cents={growthEnv.fundedBalance ?? 0} /></>} />
        <Stat label="Growth spend this month" value={<Money cents={snapshot.expenses.growthActual} />} />
        <Stat label="Reserve coverage" value={snapshot.reserve.coverageMonths ? `${snapshot.reserve.coverageMonths} mo` : "—"} sub="Build 1+ month before hiring" tone={Number(snapshot.reserve.coverageMonths ?? 0) < 1 ? "caution" : "positive"} />
      </div>

      <div className="mt-6 mb-3 flex items-center justify-between">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "proposed", label: "Proposed", count: data.growthProposals.filter((g) => g.status === "proposed").length }, { value: "approved", label: "Approved", count: data.growthProposals.filter((g) => g.status === "approved").length }, { value: "rejected", label: "Rejected", count: data.growthProposals.filter((g) => g.status === "rejected").length }]} />
      </div>
      {list.length === 0 ? (
        <Callout tone="neutral">No {tab} proposals. Evaluate a new subscription, hire or acquisition channel to see what it does to your numbers before committing.</Callout>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((g) => {
            const ev = g.evaluationJson ? (JSON.parse(g.evaluationJson) as InvestmentEvaluation) : null;
            return (
              <Card key={g.id} title={<span className="flex items-center gap-2">{g.name}<Badge>{TYPE_LABEL[g.type]}</Badge>{ev && <Badge tone={ev.verdict === "affordable" ? "positive" : ev.verdict === "conditional" ? "caution" : "critical"}>{ev.verdict.replace("_", " ")}</Badge>}</span>} subtitle={`${g.description ?? ""}${g.decidedAt ? ` · decided ${dateLabel(g.decidedAt)}` : ` · proposed ${dateLabel(g.createdAt.slice(0, 10))}`}`} actions={<button className="rounded p-1 text-fg-faint hover:bg-critical-soft hover:text-critical" onClick={() => { mutate((db) => deleteGrowthProposal(db, g.id)); toast.success("Removed"); }}><Trash2 size={14} /></button>}>
                <DefinitionList
                  items={[
                    { label: "Monthly cost", value: <Money cents={g.monthlyCostUsdCents} /> },
                    { label: "One-time cost", value: <Money cents={g.oneTimeCostUsdCents} /> },
                    { label: "Expected additional revenue / month", value: <Money cents={g.expectedAdditionalRevenueUsdCents} /> },
                    ...(g.type === "hire" ? [{ label: "Additional delivery capacity / month", value: <Money cents={g.deliveryCapacityUsdCents} /> }] : []),
                    ...(ev ? [{ label: "Projected opex ratio", value: <Pct value={ev.newOpexRatioPct} /> }, { label: g.type === "hire" ? "Projected gross margin" : "Break-even", value: g.type === "hire" ? <Pct value={ev.projectedGrossMarginPct} /> : ev.breakEvenMonths === null ? "never at these numbers" : `${ev.breakEvenMonths} month(s)` }] : []),
                  ]}
                />
                {ev && (
                  <ul className="mt-3 list-disc space-y-0.5 pl-4 text-xs text-fg-muted">
                    {ev.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
                {g.expectedBenefit && <p className="mt-2 text-xs text-fg-muted"><span className="font-medium text-fg">Expected benefit:</span> {g.expectedBenefit}</p>}
                {g.decisionNote && <p className="mt-2 text-xs text-fg-muted"><span className="font-medium text-fg">Decision:</span> {g.decisionNote}</p>}
                {g.status === "proposed" && (
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => decide(g, "approved")}><CheckCircle2 size={13} /> Approve</Button>
                    <Button size="sm" onClick={() => decide(g, "rejected")}><XCircle size={13} /> Reject</Button>
                    <Button size="sm" variant="ghost" onClick={() => setOpen(g)}>Re-evaluate</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Card className="mt-6" title="What the growth budget is for" subtitle="Examples of spend that belongs here">
        <div className="grid gap-2 text-xs text-fg-muted sm:grid-cols-2 lg:grid-cols-4">
          {["AI infrastructure and new AI subscriptions", "Lead generation and outbound data", "Hiring and contractor trials", "Training and education", "Sales infrastructure", "New business development channels", "Upwork membership and bids", "Testing new acquisition channels"].map((x) => (
            <div key={x} className="rounded-lg border border-border px-3 py-2">{x}</div>
          ))}
        </div>
        <div className="mt-3"><Progress value={snapshot.expenses.growthActual} max={Math.max(snapshot.allocations.growth, growthEnv.balance)} tone="accent" thin /><div className="mt-1 text-[11px] text-fg-faint">Growth spend this month vs the larger of this month&apos;s allocation and the envelope balance.</div></div>
      </Card>

      <ProposalModal open={open !== null} existing={open === "new" ? null : open} onClose={() => setOpen(null)} />
      <TransactionForm open={spend} onClose={() => setSpend(false)} preset={{ type: "growth_investment", bucket: "growth" }} />
    </>
  );
}

function ProposalModal({ open, existing, onClose }: { open: boolean; existing: GrowthProposal | null; onClose: () => void }) {
  const { data, snapshot, mutate } = useReady();
  const toast = useToast();
  const blank = { type: "subscription" as InvestmentInput["type"], name: "", description: "", monthlyCost: 0, oneTimeCost: 0, expectedAdditionalRevenue: 0, deliveryCapacity: 0, expectedBenefit: "", costType: "overhead" as "overhead" | "direct_delivery", bucket: "growth" as "opex" | "growth" };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<string[]>([]);
  React.useEffect(() => {
    if (open) {
      setErrors([]);
      setF(existing ? { type: existing.type as InvestmentInput["type"], name: existing.name, description: existing.description ?? "", monthlyCost: existing.monthlyCostUsdCents, oneTimeCost: existing.oneTimeCostUsdCents, expectedAdditionalRevenue: existing.expectedAdditionalRevenueUsdCents, deliveryCapacity: existing.deliveryCapacityUsdCents, expectedBenefit: existing.expectedBenefit ?? "", costType: existing.costType as "overhead" | "direct_delivery", bucket: existing.bucket as "opex" | "growth" } : blank);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);
  const ev = useMemo(() => (f.monthlyCost > 0 || f.oneTimeCost > 0 ? evaluateInvestment(snapshot, data.settings, { type: f.type, monthlyCost: f.monthlyCost, oneTimeCost: f.oneTimeCost, expectedAdditionalRevenue: f.expectedAdditionalRevenue, deliveryCapacity: f.deliveryCapacity, costType: f.costType, bucket: f.bucket }) : null), [f, snapshot, data.settings]);
  const save = () => {
    if (!f.name.trim()) return setErrors(["Name is required"]);
    if (f.monthlyCost <= 0 && f.oneTimeCost <= 0) return setErrors(["Enter a monthly or one-time cost"]);
    mutate((db) => upsertGrowthProposal(db, { id: existing?.id, type: f.type, name: f.name.trim(), description: f.description || null, monthlyCostUsdCents: f.monthlyCost, oneTimeCostUsdCents: f.oneTimeCost, expectedAdditionalRevenueUsdCents: f.expectedAdditionalRevenue, expectedBenefit: f.expectedBenefit || null, deliveryCapacityUsdCents: f.deliveryCapacity, costType: f.costType, bucket: f.bucket, status: "proposed", evaluationJson: ev ? JSON.stringify(ev) : null, decisionNote: existing?.decisionNote ?? null, decidedAt: null }));
    toast.success("Proposal saved with its evaluation");
    onClose();
  };
  const isHire = f.type === "hire";
  return (
    <Modal open={open} onClose={onClose} title={existing ? `Re-evaluate ${existing.name}` : "Evaluate a growth proposal"} description="Numbers update live. The verdict is advice; the decision stays yours." size="xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save proposal</Button></>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <FormError errors={errors} />
          <FormRow cols={2}>
            <Field label="Type"><Select value={f.type} onChange={(e) => { const t = e.target.value as InvestmentInput["type"]; setF({ ...f, type: t, costType: t === "hire" ? "direct_delivery" : "overhead", bucket: t === "hire" ? "opex" : "growth" }); }}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={isHire ? "Media buyer (part-time)" : "Upwork Plus membership"} /></Field>
          </FormRow>
          <Field label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <FormRow cols={2}>
            <Field label={isHire ? "Monthly cost of hire" : "Monthly cost"}><MoneyInput value={f.monthlyCost} onChange={(v) => setF({ ...f, monthlyCost: v })} /></Field>
            <Field label="One-time cost (setup, recruiting)"><MoneyInput value={f.oneTimeCost} onChange={(v) => setF({ ...f, oneTimeCost: v })} /></Field>
          </FormRow>
          <FormRow cols={2}>
            <Field label="Expected additional revenue / month" hint="Be conservative."><MoneyInput value={f.expectedAdditionalRevenue} onChange={(v) => setF({ ...f, expectedAdditionalRevenue: v })} /></Field>
            {isHire && <Field label="Additional delivery capacity / month" hint="Revenue you could serve that you cannot today."><MoneyInput value={f.deliveryCapacity} onChange={(v) => setF({ ...f, deliveryCapacity: v })} /></Field>}
          </FormRow>
          <FormRow cols={2}>
            <Field label="Cost type"><Select value={f.costType} onChange={(e) => setF({ ...f, costType: e.target.value as "overhead" | "direct_delivery" })}><option value="overhead">General overhead</option><option value="direct_delivery">Direct delivery (client work)</option></Select></Field>
            <Field label="Funded from"><Select value={f.bucket} onChange={(e) => setF({ ...f, bucket: e.target.value as "opex" | "growth" })}><option value="growth">Growth envelope</option><option value="opex">Operating allowance</option></Select></Field>
          </FormRow>
          <Field label="Expected financial benefit (in words)"><Textarea value={f.expectedBenefit} onChange={(e) => setF({ ...f, expectedBenefit: e.target.value })} placeholder="Frees 10 hours/week for sales; lets us take a second retainer client." /></Field>
        </div>
        <div>
          {!ev ? (
            <Callout tone="neutral">Enter a cost to see the evaluation.</Callout>
          ) : (
            <Callout tone={ev.verdict === "affordable" ? "positive" : ev.verdict === "conditional" ? "caution" : "critical"} title={`Verdict: ${ev.verdict.replace("_", " ")}`}>
              <DefinitionList
                className="mt-1"
                items={[
                  { label: "Current monthly net revenue", value: <Money cents={ev.currentMonthlyRevenue} /> },
                  { label: "Current operating expense ratio", value: <Pct value={ev.currentOpexRatioPct} /> },
                  { label: "New monthly cost", value: <Money cents={ev.newMonthlyCost} /> },
                  { label: "Projected ratio (same revenue)", value: <Pct value={ev.newOpexRatioPct} /> },
                  { label: "Projected ratio (with expected revenue)", value: <Pct value={ev.newOpexRatioWithRevenuePct} /> },
                  { label: "Remaining operating allowance", value: <Money cents={ev.remainingAllowance} /> },
                  { label: "Growth envelope / monthly growth budget", value: <><Money cents={ev.growthEnvelopeBalance} /> / <Money cents={ev.growthMonthlyBudget} /></> },
                  { label: "Revenue needed to carry cost inside ceiling", value: <Money cents={ev.revenueNeededToFundInsideCeiling} /> },
                  { label: "Monthly break-even requirement", value: <Money cents={ev.monthlyBreakEvenRevenue} /> },
                  { label: "Expected net monthly benefit", value: <Money cents={ev.expectedNetMonthlyBenefit} tone="auto" /> },
                  { label: "Break-even period", value: ev.breakEvenMonths === null ? "never at these numbers" : `${ev.breakEvenMonths} month(s)` },
                  ...(isHire ? [{ label: "Gross margin: current → projected", value: <><Pct value={ev.currentGrossMarginPct} /> → <Pct value={ev.projectedGrossMarginPct} /></> }, { label: "Reserve coverage", value: `${ev.reserveCoverageMonths ?? "0"} months ${ev.reserveOk ? "✓" : "(below 1 month)"}` }] : []),
                ]}
              />
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs">{ev.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </Callout>
          )}
        </div>
      </div>
    </Modal>
  );
}
