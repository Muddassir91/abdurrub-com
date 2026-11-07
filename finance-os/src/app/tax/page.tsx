"use client";

import React, { useState } from "react";
import { Plus, Pencil, Trash2, CheckCircle2, Circle, MinusCircle } from "lucide-react";
import type { TaxProfile, ComplianceItem } from "@/db/schema";
import { useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { Money } from "@/components/Money";
import { PageHeader, Card, Stat, Badge, Button, Callout, DefinitionList } from "@/components/ui/primitives";
import { Field, Input, Select, Textarea, PercentInput, FormRow, Checkbox } from "@/components/ui/forms";
import { Modal } from "@/components/ui/Modal";
import { upsertTaxProfile, deleteTaxProfile, upsertComplianceItem, deleteComplianceItem } from "@/db/repo";
import { dateLabel, daysBetween } from "@/lib/dates";
import { clsx } from "clsx";

export default function TaxPage() {
  const { data, snapshot, mutate, today } = useReady();
  const toast = useToast();
  const [profileEdit, setProfileEdit] = useState<TaxProfile | null | "new">(null);
  const [itemEdit, setItemEdit] = useState<ComplianceItem | null | "new">(null);
  const entityName = new Map(data.entities.map((e) => [e.id, e.name]));
  const upcoming = data.complianceItems.filter((c) => c.applicable && c.status === "pending" && c.dueDate).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));

  const cycle = (c: ComplianceItem) => {
    const next = c.status === "pending" ? "done" : c.status === "done" ? "not_applicable" : "pending";
    mutate((db) => upsertComplianceItem(db, { ...c, status: next, lastCompletedAt: next === "done" ? today : c.lastCompletedAt }));
  };

  return (
    <>
      <PageHeader
        title="Tax & compliance"
        description="A planning tool, not tax preparation. Nothing here computes a liability; every rate is an editable assumption marked as an estimate until a professional confirms it. The Wyoming LLC does not remove Pakistani obligations."
        actions={<Button variant="primary" onClick={() => setItemEdit("new")}><Plus size={14} /> Checklist item</Button>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tax reserve envelope" value={<Money cents={snapshot.tax.envelopeBalance} />} sub={`${snapshot.policy.taxPct}% provisional allocation`} />
        <Stat label="Funded in tax account" value={<Money cents={snapshot.tax.fundedBalance} />} tone={snapshot.tax.fundedBalance < snapshot.tax.envelopeBalance * 0.95 && snapshot.tax.envelopeBalance > 0 ? "caution" : "neutral"} />
        <Stat label="Tax paid to date" value={<Money cents={snapshot.tax.paidTotal} />} />
        <Stat label="Next deadline" value={upcoming[0] ? dateLabel(upcoming[0].dueDate) : "—"} sub={upcoming[0]?.title} tone={upcoming[0] && daysBetween(today, upcoming[0].dueDate!) < 0 ? "critical" : upcoming[0] && daysBetween(today, upcoming[0].dueDate!) <= 30 ? "caution" : "neutral"} />
      </div>

      <Callout tone="caution" className="mt-4" title="Estimates requiring professional confirmation">
        Tax profiles below carry assumed rates only if you enter them. Allocating {snapshot.policy.taxPct}% is a cash-flow provision so money exists when a liability is determined. Confirm filing obligations for the Pakistani registration, the foreign-owned single-member LLC (Form 5472 + pro forma 1120), and your personal return with a qualified adviser.
      </Callout>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Tax profiles" subtitle="One per jurisdiction or obligation" className="lg:col-span-1" actions={<Button size="sm" onClick={() => setProfileEdit("new")}><Plus size={13} /> Profile</Button>} padded={false}>
          <ul className="divide-y divide-border">
            {data.taxProfiles.map((p) => (
              <li key={p.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {p.name}
                      <Badge tone={p.scope === "business" ? "accent" : "info"}>{p.scope}</Badge>
                      {p.isEstimate && <Badge tone="caution">estimate</Badge>}
                    </div>
                    <div className="text-[11px] text-fg-faint">{p.jurisdiction}{p.entityId ? ` · ${entityName.get(p.entityId)}` : ""}{p.filingFrequency ? ` · ${p.filingFrequency}` : ""}</div>
                  </div>
                  <div className="flex gap-1">
                    <button className="rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg" onClick={() => setProfileEdit(p)}><Pencil size={14} /></button>
                    <button className="rounded p-1 text-fg-faint hover:bg-critical-soft hover:text-critical" onClick={() => { mutate((db) => deleteTaxProfile(db, p.id)); toast.success("Profile removed"); }}><Trash2 size={14} /></button>
                  </div>
                </div>
                <DefinitionList className="mt-1" items={[{ label: "Assumed rate", value: p.assumedRatePct ? `${p.assumedRatePct}% (unverified)` : "not set" }]} />
                {p.notes && <p className="mt-1 text-xs text-fg-muted">{p.notes}</p>}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Compliance checklist" subtitle="Click the status icon to cycle pending → done → not applicable" className="lg:col-span-2" padded={false}>
          <ul className="divide-y divide-border">
            {data.complianceItems.map((c) => {
              const days = c.dueDate ? daysBetween(today, c.dueDate) : null;
              return (
                <li key={c.id} className={clsx("flex items-start gap-3 px-5 py-3", (!c.applicable || c.status !== "pending") && "opacity-70")}>
                  <button onClick={() => cycle(c)} className="mt-0.5 shrink-0 text-fg-faint hover:text-accent" title="Change status">
                    {c.status === "done" ? <CheckCircle2 size={18} className="text-positive" /> : c.status === "not_applicable" ? <MinusCircle size={18} /> : <Circle size={18} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {c.title}
                      <Badge>{c.jurisdiction}</Badge>
                      {!c.applicable && <Badge tone="neutral">marked not applicable</Badge>}
                      {c.dueDate && c.status === "pending" && c.applicable && <Badge tone={days! < 0 ? "critical" : days! <= 30 ? "caution" : "neutral"}>{days! < 0 ? `${-days!} days overdue` : `due ${dateLabel(c.dueDate)}`}</Badge>}
                    </div>
                    {c.description && <p className="mt-0.5 text-xs text-fg-muted">{c.description}</p>}
                    <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-fg-faint">
                      {c.valueLabel && <span>{c.valueLabel}: <span className="text-fg">{c.value || "not set"}</span></span>}
                      {c.frequency && <span>{c.frequency}</span>}
                      {c.lastCompletedAt && <span>last done {dateLabel(c.lastCompletedAt)}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button className="rounded p-1 text-fg-faint hover:bg-surface-2 hover:text-fg" onClick={() => setItemEdit(c)}><Pencil size={14} /></button>
                    <button className="rounded p-1 text-fg-faint hover:bg-critical-soft hover:text-critical" onClick={() => { mutate((db) => deleteComplianceItem(db, c.id)); toast.success("Item removed"); }}><Trash2 size={14} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card className="mt-4" title="Entities" subtitle="Legal structures the finances run through">
        <div className="grid gap-3 md:grid-cols-2">
          {data.entities.map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium">{e.name}</div>
              <div className="text-[11px] text-fg-faint">{e.jurisdiction} · {e.type.replace("_", " ")}{e.registrationNumber ? ` · ${e.registrationNumber}` : ""}</div>
              {e.notes && <p className="mt-1 text-xs text-fg-muted">{e.notes}</p>}
            </div>
          ))}
        </div>
      </Card>

      <TaxProfileModal open={profileEdit !== null} existing={profileEdit === "new" ? null : profileEdit} onClose={() => setProfileEdit(null)} />
      <ComplianceModal open={itemEdit !== null} existing={itemEdit === "new" ? null : itemEdit} onClose={() => setItemEdit(null)} />
    </>
  );
}

function TaxProfileModal({ open, existing, onClose }: { open: boolean; existing: TaxProfile | null; onClose: () => void }) {
  const { data, mutate } = useReady();
  const toast = useToast();
  const blank = { name: "", jurisdiction: "", entityId: "", scope: "business", assumedRatePct: "", isEstimate: true, filingFrequency: "annual", notes: "" };
  const [f, setF] = useState(blank);
  React.useEffect(() => {
    if (open) setF(existing ? { name: existing.name, jurisdiction: existing.jurisdiction, entityId: existing.entityId ?? "", scope: existing.scope, assumedRatePct: existing.assumedRatePct ?? "", isEstimate: existing.isEstimate, filingFrequency: existing.filingFrequency ?? "annual", notes: existing.notes ?? "" } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);
  return (
    <Modal open={open} onClose={onClose} title={existing ? "Edit tax profile" : "New tax profile"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim() || !f.jurisdiction.trim()} onClick={() => { mutate((db) => upsertTaxProfile(db, { id: existing?.id, name: f.name.trim(), jurisdiction: f.jurisdiction.trim(), entityId: f.entityId || null, scope: f.scope, assumedRatePct: f.assumedRatePct || null, isEstimate: f.isEstimate, filingFrequency: f.filingFrequency || null, notes: f.notes || null })); toast.success("Profile saved"); onClose(); }}>Save</Button></>}>
      <div className="space-y-3">
        <FormRow cols={2}>
          <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Jurisdiction" required><Input value={f.jurisdiction} onChange={(e) => setF({ ...f, jurisdiction: e.target.value })} /></Field>
        </FormRow>
        <FormRow cols={3}>
          <Field label="Scope"><Select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}><option value="business">Business</option><option value="personal">Personal</option></Select></Field>
          <Field label="Entity"><Select value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value })}><option value="">—</option>{data.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
          <Field label="Filing frequency"><Select value={f.filingFrequency} onChange={(e) => setF({ ...f, filingFrequency: e.target.value })}><option value="annual">Annual</option><option value="quarterly">Quarterly</option><option value="monthly">Monthly</option></Select></Field>
        </FormRow>
        <Field label="Assumed effective rate % (optional)" hint="Only enter a rate your adviser has given you."><PercentInput value={f.assumedRatePct} onChange={(v) => setF({ ...f, assumedRatePct: v })} /></Field>
        <Checkbox label="Mark as estimate requiring professional confirmation" checked={f.isEstimate} onChange={(v) => setF({ ...f, isEstimate: v })} />
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ComplianceModal({ open, existing, onClose }: { open: boolean; existing: ComplianceItem | null; onClose: () => void }) {
  const { data, mutate } = useReady();
  const toast = useToast();
  const blank = { title: "", jurisdiction: "United States", description: "", dueDate: "", frequency: "annual", status: "pending", applicable: true, valueLabel: "", value: "", notes: "" };
  const [f, setF] = useState(blank);
  React.useEffect(() => {
    if (open) setF(existing ? { title: existing.title, jurisdiction: existing.jurisdiction, description: existing.description ?? "", dueDate: existing.dueDate ?? "", frequency: existing.frequency ?? "annual", status: existing.status, applicable: existing.applicable, valueLabel: existing.valueLabel ?? "", value: existing.value ?? "", notes: existing.notes ?? "" } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);
  return (
    <Modal open={open} onClose={onClose} title={existing ? "Edit checklist item" : "New checklist item"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.title.trim()} onClick={() => { mutate((db) => upsertComplianceItem(db, { id: existing?.id, title: f.title.trim(), jurisdiction: f.jurisdiction, description: f.description || null, dueDate: f.dueDate || null, frequency: f.frequency || null, status: f.status, applicable: f.applicable, valueLabel: f.valueLabel || null, value: f.value || null, lastCompletedAt: existing?.lastCompletedAt ?? null, notes: f.notes || null, sortOrder: existing?.sortOrder ?? data.complianceItems.length + 1 })); toast.success("Checklist saved"); onClose(); }}>Save</Button></>}>
      <div className="space-y-3">
        <FormRow cols={2}>
          <Field label="Title" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Jurisdiction"><Input value={f.jurisdiction} onChange={(e) => setF({ ...f, jurisdiction: e.target.value })} /></Field>
        </FormRow>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <FormRow cols={3}>
          <Field label="Due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Frequency"><Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}><option value="once">Once</option><option value="annual">Annual</option><option value="quarterly">Quarterly</option><option value="monthly">Monthly</option></Select></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="pending">Pending</option><option value="done">Done</option><option value="not_applicable">Not applicable</option></Select></Field>
        </FormRow>
        <FormRow cols={2}>
          <Field label="Field label (e.g. EIN)"><Input value={f.valueLabel} onChange={(e) => setF({ ...f, valueLabel: e.target.value })} /></Field>
          <Field label="Value"><Input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
        </FormRow>
        <Checkbox label="Applicable to my situation" checked={f.applicable} onChange={(v) => setF({ ...f, applicable: v })} />
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
