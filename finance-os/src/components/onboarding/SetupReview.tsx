"use client";

import React, { useMemo, useState } from "react";
import { clsx } from "clsx";
import { ArrowLeft, Check, ChevronRight, Lock, RefreshCw, X } from "lucide-react";
import { useFinance } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { LogoMark, Wordmark } from "@/components/Logo";
import { formatMoney, type CurrencyCode } from "@/lib/money";
import { applyOnboarding } from "@/onboarding/apply";
import { currentAnswers } from "@/onboarding/derive";
import { GOALS, PERSONAS, rebalanceSplit, splitTotal, suggestSplit, type OnboardingAnswers } from "@/onboarding/model";
import { CHAPTERS, STEPS } from "./Onboarding";

/**
 * "Edit my setup": every answer from the setup questions on one screen. Tap an
 * answer to change just that one, or walk through all of them again. Saving
 * updates the settings, the split and the budgets; entries and balances stay.
 */

const money = (v: number, c: CurrencyCode) => (v > 0 ? formatMoney(v, c, { decimals: 0 }) : "Not set");
const list = (xs: { name: string; amountMinor: number }[], c: CurrencyCode) => {
  const rows = xs.filter((x) => x.amountMinor > 0);
  return rows.length ? `${rows.length} · ${formatMoney(rows.reduce((s, x) => s + x.amountMinor, 0), c, { decimals: 0 })} a month` : "None";
};

const ROWS: Record<string, { label: string; value: (a: OnboardingAnswers) => string }> = {
  name: { label: "Your name", value: (a) => a.name || "Not set" },
  persona: { label: "You are", value: (a) => PERSONAS.find((p) => p.value === a.persona)?.label ?? a.persona },
  business: { label: "Business name", value: (a) => a.businessName || "Not set" },
  currency: { label: "You earn in", value: (a) => a.baseCurrency },
  homeCurrency: { label: "You spend at home in", value: (a) => a.householdCurrency },
  fx: { label: "Exchange rate", value: (a) => `1 ${a.baseCurrency} = ${a.fxRate || "?"} ${a.householdCurrency}` },
  country: { label: "You live and pay tax in", value: (a) => a.country || "Not set" },
  registration: { label: "Business registered", value: (a) => (a.registration === "abroad" ? "In another country" : "Where you live") },
  registrationCountry: { label: "Registered in", value: (a) => a.registrationCountry || "Not set" },
  income: { label: "A usual month brings in", value: (a) => money(a.monthlyIncomeMinor, a.baseCurrency) },
  steadiness: { label: "Income is", value: (a) => ({ steady: "About the same every month", varies: "Moves around a bit", swings: "Feast or famine" })[a.steadiness] },
  payments: { label: "Money reaches you by", value: (a) => a.paymentMethods.join(", ") || "Not set" },
  clients: { label: "Clients in a month", value: (a) => ({ "1": "Just one", "2-5": "2 to 5", "6-20": "6 to 20", "20+": "More than 20" })[a.clientCount] },
  businessCash: { label: "Business account holds", value: (a) => money(a.businessCashMinor, a.baseCurrency) },
  taxSaved: { label: "Set aside for tax", value: (a) => money(a.taxSavedMinor, a.baseCurrency) },
  reserveSaved: { label: "Cushion saved", value: (a) => money(a.reserveSavedMinor, a.baseCurrency) },
  subscriptions: { label: "Tools and subscriptions", value: (a) => list(a.subscriptions, a.baseCurrency) },
  otherCosts: { label: "Other regular costs", value: (a) => list(a.otherCosts, a.baseCurrency) },
  household: { label: "Needed at home each month", value: (a) => list(a.household, a.householdCurrency) },
  personalCash: { label: "Personal account holds", value: (a) => money(a.personalCashMinor, a.householdCurrency) },
  cadence: { label: "You pay yourself", value: (a) => ({ weekly: "Every week", biweekly: "Twice a month", monthly: "Once a month", whenever: "Whenever there is money" })[a.payCadence] },
  goals: { label: "What you want most", value: (a) => a.goals.map((g) => GOALS.find((x) => x.value === g)?.label ?? g).join(", ") || "Not picked" },
  tax: { label: "Share of income for tax", value: (a) => `${a.taxPct}%` },
  reserve: { label: "Cushion target", value: (a) => `${a.reserveMonths} month${a.reserveMonths === 1 ? "" : "s"} of costs` },
  split: { label: "Your split", value: (a) => `Costs ${a.split.opex}% · pay ${a.split.owner}% · tax ${a.split.tax}% · profit ${a.split.profit}% · cushion ${a.split.reserve}% · growth ${a.split.growth}%` },
};

const LOCKED_WITH_ENTRIES = new Set(["currency", "homeCurrency"]);

export function SetupReview({ startStep }: { startStep?: string | null }) {
  const { data, mutate, closeSetup } = useFinance();
  const toast = useToast();
  const initial = useMemo(() => (data ? currentAnswers(data) : null), [data]);
  const [a, setA] = useState<OnboardingAnswers | null>(initial);
  const [editing, setEditing] = useState<string | null>(startStep && ROWS[startStep] ? startStep : null);
  const [walk, setWalk] = useState(false);
  const [touchedSplit, setTouchedSplit] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!data || !a || !initial) return null;

  const hasEntries = data.transactions.length > 0;
  const steps = STEPS.filter((s) => !s.when || s.when(a));
  const dirty = JSON.stringify(a) !== JSON.stringify(initial);
  const valid = splitTotal(a.split) === 100 && a.name.trim().length > 0;
  const set = (patch: Partial<OnboardingAnswers>) => {
    if ("split" in patch) setTouchedSplit(true);
    setA((cur) => (cur ? { ...cur, ...patch } : cur));
  };
  const step = editing ? steps.find((s) => s.id === editing) : null;
  const leaveStep = () => {
    if (!walk || !step) return setEditing(null);
    const idx = steps.findIndex((s) => s.id === step.id);
    const nextStep = steps.slice(idx + 1).find((s) => !(hasEntries && LOCKED_WITH_ENTRIES.has(s.id)));
    if (nextStep) setEditing(nextStep.id);
    else {
      setWalk(false);
      setEditing(null);
    }
    window.scrollTo({ top: 0 });
  };

  const save = () => {
    setSaving(true);
    try {
      let final = { ...a };
      // A new tax share moves into the split unless the split was adjusted by hand.
      if (final.taxPct !== initial.taxPct && !touchedSplit) {
        try {
          final = { ...final, split: rebalanceSplit(final.split, { tax: Math.round(final.taxPct) }) };
        } catch {
          /* keep the split as it is */
        }
      }
      mutate((db) => applyOnboarding(db, final));
      toast.success("Setup updated", "Your dashboard now uses the new answers.");
      closeSetup();
    } catch (e) {
      toast.error("Could not save", e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  if (step) {
    const stepValid = step.valid ? step.valid(a) : true;
    const idx = steps.findIndex((s) => s.id === step.id);
    return (
      <div className="flex min-h-screen flex-col overflow-x-hidden bg-bg text-fg" data-setup-review="step">
        <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4">
            <button type="button" onClick={() => { setWalk(false); setEditing(null); }} className="flex h-9 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-fg-muted hover:bg-surface-2" aria-label="Back to my answers">
              <ArrowLeft size={18} /> My answers
            </button>
            <div className="flex-1" />
            {walk && (
              <span className="text-xs text-fg-faint">
                {idx + 1} of {steps.length}
              </span>
            )}
          </div>
        </header>
        <form
          className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-32 pt-8 sm:pt-12"
          onSubmit={(e) => {
            e.preventDefault();
            if (stepValid) leaveStep();
          }}
        >
          <div key={step.id} className="step-in" data-step={step.id}>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight text-fg sm:text-3xl">{step.title(a)}</h1>
            {step.subtitle && <p className="mt-2 text-sm text-fg-muted sm:text-base">{step.subtitle(a)}</p>}
            <div className="mt-6 sm:mt-8">{step.render({ a, set, next: leaveStep })}</div>
            {step.id === "split" && (
              <button type="button" onClick={() => { setA({ ...a, split: suggestSplit(a) }); setTouchedSplit(true); }} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                <RefreshCw size={14} /> Suggest a split from my answers
              </button>
            )}
          </div>
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 backdrop-blur">
            <div className="mx-auto flex w-full max-w-2xl items-center justify-end gap-3 px-4 py-3">
              <button type="submit" disabled={!stepValid} className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-base font-semibold text-accent-fg disabled:opacity-40">
                <Check size={16} /> {walk ? "Next" : "Done"}
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg" data-setup-review="list">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4">
          <LogoMark size={24} />
          <span className="hidden sm:inline">
            <Wordmark size="sm" />
          </span>
          <div className="flex-1" />
          <button type="button" onClick={closeSetup} className="flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2" aria-label="Close setup">
            <X size={18} />
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-32 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Your setup</h1>
        <p className="mt-1 text-sm text-fg-muted">Tap any answer to change it. Your entries and balances stay as they are; the split, budgets and targets follow your answers.</p>
        <button type="button" onClick={() => { setWalk(true); setEditing(steps.find((s) => !(hasEntries && LOCKED_WITH_ENTRIES.has(s.id)))?.id ?? null); }} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
          <RefreshCw size={14} /> Go through every question again
        </button>
        {CHAPTERS.map((ch) => {
          const rows = steps.filter((s) => s.chapter === ch.id);
          if (rows.length === 0) return null;
          return (
            <section key={ch.id} className="mt-6">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent">{ch.label}</h2>
              <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {rows.map((s) => {
                  const row = ROWS[s.id];
                  if (!row) return null;
                  const locked = hasEntries && LOCKED_WITH_ENTRIES.has(s.id);
                  const changed = row.value(a) !== row.value(initial);
                  return (
                    <button key={s.id} type="button" disabled={locked} onClick={() => setEditing(s.id)} className={clsx("flex w-full items-center gap-3 px-4 py-3 text-left", locked ? "cursor-not-allowed opacity-70" : "hover:bg-surface-2")} data-row={s.id}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-fg-muted">{row.label}</span>
                        <span className={clsx("block truncate text-sm font-medium", changed ? "text-accent" : "text-fg")}>{row.value(a)}</span>
                        {locked && <span className="block text-[11px] text-fg-faint">Fixed once you have entries, so past amounts keep their meaning.</span>}
                      </span>
                      {locked ? <Lock size={14} className="shrink-0 text-fg-faint" /> : <ChevronRight size={16} className="shrink-0 text-fg-faint" />}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
          <button type="button" onClick={closeSetup} className="h-12 rounded-xl px-4 text-sm font-medium text-fg-muted hover:bg-surface-2">
            {dirty ? "Discard changes" : "Close"}
          </button>
          <div className="flex-1 text-right text-xs text-fg-faint">{!valid ? "The split must add up to 100%." : dirty ? "You have unsaved changes." : ""}</div>
          <button type="button" onClick={save} disabled={!dirty || !valid || saving} className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-base font-semibold text-accent-fg shadow-[0_10px_30px_-10px_var(--accent)] disabled:opacity-40 disabled:shadow-none">
            <Check size={16} /> Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
