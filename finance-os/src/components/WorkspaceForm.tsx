"use client";

import React, { useState } from "react";
import { clsx } from "clsx";
import { Building2, UserRound, ShieldCheck } from "lucide-react";
import type { SeedTemplate } from "@/db/persistence";
import type { CreateWorkspaceInput } from "@/store/FinanceProvider";
import { Button } from "./ui/primitives";
import { Field, Input, Select, FormRow, FormError } from "./ui/forms";
import { CURRENCY_CODES } from "@/lib/money";

/**
 * "Sign up" form: creates a workspace. A workspace is one business (or one
 * person) with its own database, optional passphrase and its own settings.
 */
export function WorkspaceForm({ onSubmit, onCancel, allowRetentionRulesTemplate = true, submitLabel = "Create workspace" }: { onSubmit: (input: CreateWorkspaceInput) => Promise<void>; onCancel?: () => void; allowRetentionRulesTemplate?: boolean; submitLabel?: string }) {
  const [template, setTemplate] = useState<SeedTemplate>(allowRetentionRulesTemplate ? "retention_rules" : "blank");
  const [name, setName] = useState(allowRetentionRulesTemplate ? "Retention Rules" : "");
  const [businessName, setBusinessName] = useState(allowRetentionRulesTemplate ? "Retention Rules" : "");
  const [ownerName, setOwnerName] = useState(allowRetentionRulesTemplate ? "Muddassir Abdur Rub" : "");
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [householdCurrency, setHouseholdCurrency] = useState("PKR");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const pick = (t: SeedTemplate) => {
    setTemplate(t);
    if (t === "retention_rules") {
      setName("Retention Rules");
      setBusinessName("Retention Rules");
      setOwnerName("Muddassir Abdur Rub");
    } else if (name === "Retention Rules") {
      setName("");
      setBusinessName("");
      setOwnerName("");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: string[] = [];
    if (!name.trim()) errs.push("Workspace name is required");
    if (!businessName.trim()) errs.push("Business name is required");
    if (!ownerName.trim()) errs.push("Owner name is required");
    if (p1 && p1.length < 8) errs.push("Passphrase must be at least 8 characters");
    if (p1 !== p2) errs.push("Passphrases do not match");
    if (errs.length) return setErrors(errs);
    setErrors([]);
    setBusy(true);
    try {
      await onSubmit({ name, businessName, ownerName, template, passphrase: p1 || undefined, baseCurrency, householdCurrency });
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <FormError errors={errors} />
      <div className={clsx("grid gap-2", allowRetentionRulesTemplate ? "sm:grid-cols-2" : "")}>
        {allowRetentionRulesTemplate && (
          <button type="button" onClick={() => pick("retention_rules")} className={clsx("rounded-xl border p-3 text-left transition-colors", template === "retention_rules" ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}>
            <div className="flex items-center gap-2 text-sm font-semibold"><Building2 size={15} /> Retention Rules</div>
            <div className="mt-1 text-xs text-fg-muted">Pre-filled with the agency profile: 25/35/15/10/10/5 policy, Whop, subscriptions, PKR household budget, revenue-share client, US and Pakistan compliance.</div>
          </button>
        )}
        <button type="button" onClick={() => pick("blank")} className={clsx("rounded-xl border p-3 text-left transition-colors", template === "blank" ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}>
          <div className="flex items-center gap-2 text-sm font-semibold"><UserRound size={15} /> Another business or person</div>
          <div className="mt-1 text-xs text-fg-muted">Clean start with the Profit First policy, standard accounts and categories. Add clients, tools and budgets yourself.</div>
        </button>
      </div>
      <FormRow cols={2}>
        <Field label="Workspace name" required hint="Shown in the switcher"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Second agency, Ahmed" /></Field>
        <Field label="Business name" required><Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} /></Field>
      </FormRow>
      <FormRow cols={3}>
        <Field label="Owner name" required><Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} /></Field>
        <Field label="Base currency"><Select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} disabled={template === "retention_rules"}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Household currency"><Select value={householdCurrency} onChange={(e) => setHouseholdCurrency(e.target.value)} disabled={template === "retention_rules"}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      </FormRow>
      <div className="rounded-xl border border-border p-3">
        <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck size={15} className="text-accent" /> Passphrase (optional, recommended)</div>
        <p className="mt-1 text-xs text-fg-muted">Encrypts this workspace in the browser. Each workspace has its own passphrase, so other people using this device cannot open yours. No recovery if lost: keep backups.</p>
        <FormRow cols={2} className="mt-3">
          <Input type="password" placeholder="Passphrase" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" />
          <Input type="password" placeholder="Repeat passphrase" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" />
        </FormRow>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
