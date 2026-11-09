"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { ArrowDownLeft, ArrowUpRight, Check, Plus } from "lucide-react";
import { useFinance, useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/Modal";
import { BigMoney } from "@/components/onboarding/inputs";
import { addTransaction, validateTransactionInput, type TransactionInput } from "@/db/repo";
import { parseAnswers, isPersonal } from "@/onboarding/model";
import { todayKey, addDays } from "@/lib/dates";
import type { CurrencyCode } from "@/lib/money";

/**
 * The one thing people do every day: add money in or money out, in a few taps.
 * A global "+" button (AppShell) and the dashboard open this sheet.
 */

export type QuickAddTab = "out" | "in";
interface QuickAddApi {
  open: (tab?: QuickAddTab) => void;
}
const Ctx = createContext<QuickAddApi>({ open: () => {} });
export const useQuickAdd = () => useContext(Ctx);

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ open: boolean; tab: QuickAddTab }>({ open: false, tab: "out" });
  const api = useMemo<QuickAddApi>(() => ({ open: (tab = "out") => setState({ open: true, tab }) }), []);
  return (
    <Ctx.Provider value={api}>
      {children}
      <QuickAddSheet open={state.open} tab={state.tab} onTab={(tab) => setState((s) => ({ ...s, tab }))} onClose={() => setState((s) => ({ ...s, open: false }))} />
    </Ctx.Provider>
  );
}

export function QuickAddButton({ className, label = "Add" }: { className?: string; label?: string }) {
  const { open } = useQuickAdd();
  return (
    <button type="button" onClick={() => open()} aria-label="Add money in or out" className={clsx("flex items-center justify-center gap-2 rounded-full bg-accent text-accent-fg shadow-[0_14px_30px_-10px_var(--accent)] transition-transform hover:brightness-110 active:scale-95", className)}>
      <Plus size={22} />
      {label && <span className="pr-1 text-sm font-semibold">{label}</span>}
    </button>
  );
}

type Side = "business" | "personal";

function QuickAddSheet({ open, tab, onTab, onClose }: { open: boolean; tab: QuickAddTab; onTab: (t: QuickAddTab) => void; onClose: () => void }) {
  const { status } = useFinance();
  if (!open || status !== "ready") return null;
  return <QuickAddForm tab={tab} onTab={onTab} onClose={onClose} />;
}

function QuickAddForm({ tab, onTab, onClose }: { tab: QuickAddTab; onTab: (t: QuickAddTab) => void; onClose: () => void }) {
  const { data, mutate } = useReady();
  const toast = useToast();
  const answers = useMemo(() => parseAnswers(data.settings.onboardingJson), [data.settings.onboardingJson]);
  const personalOnly = answers ? isPersonal(answers) : false;
  const base = data.settings.baseCurrency as CurrencyCode;
  const household = data.settings.householdCurrency as CurrencyCode;
  const today = todayKey();

  const [side, setSide] = useState<Side>("business");
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState<CurrencyCode>(base);
  const [what, setWhat] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [essential, setEssential] = useState<boolean | null>(null);
  const [repeats, setRepeats] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [pickDate, setPickDate] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    setCurrency(tab === "out" && side === "personal" ? household : base);
    setCategoryId(null);
    setEssential(null);
  }, [tab, side, base, household]);

  const accounts = data.accounts.filter((a) => !a.isArchived);
  const byRole = (r: string) => accounts.find((a) => a.role === r)?.id ?? null;
  const categories = data.categories.filter((c) => c.scope === (tab === "out" && side === "personal" ? "personal" : "business"));
  const chosenCat = categories.find((c) => c.id === categoryId) ?? null;
  const isHousehold = essential ?? chosenCat?.isEssentialDefault ?? false;
  const clients = data.clients.filter((c) => c.status === "active");

  const reset = () => {
    setAmount(0);
    setWhat("");
    setCategoryId(null);
    setEssential(null);
    setRepeats(false);
    setClientId(null);
    setDate(today);
    setPickDate(false);
    setErrors([]);
  };

  const build = (): TransactionInput => {
    if (tab === "in") {
      return { date, type: clientId ? "client_payment" : "income", amountMinor: amount, currency, description: what.trim() || (clientId ? `Payment from ${clients.find((c) => c.id === clientId)?.name ?? "client"}` : "Money in"), accountId: byRole(personalOnly ? "operating" : "operating"), clientId };
    }
    if (side === "personal") {
      return { date, type: isHousehold ? "household_expense" : "personal_expense", amountMinor: amount, currency, description: what.trim() || chosenCat?.name || "Personal spending", categoryId, accountId: byRole("personal") };
    }
    return { date, type: "expense", amountMinor: amount, currency, description: what.trim() || chosenCat?.name || "Business expense", categoryId, accountId: byRole("operating"), costType: "overhead", bucket: "opex", isRecurring: repeats, isEssential: repeats };
  };

  const save = (another: boolean) => {
    const input = build();
    const errs = validateTransactionInput(input, data.accounts);
    if (amount <= 0) errs.unshift("Enter an amount first.");
    if (errs.length) return setErrors([...new Set(errs)]);
    try {
      mutate((db, d) => addTransaction(db, input, d.settings, d.fxRates));
      toast.success(tab === "in" ? "Money in added" : "Spending added");
      if (another) reset();
      else onClose();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
  };

  const seg = (active: boolean) => clsx("flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors", active ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg");

  return (
    <Modal
      open
      onClose={onClose}
      title={tab === "in" ? "Money in" : "Money out"}
      description={tab === "in" ? "Something you got paid." : "Something you paid for."}
      size="md"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <button type="button" onClick={() => save(true)} className="h-11 rounded-xl px-3 text-sm font-medium text-fg-muted hover:bg-surface-2 hover:text-fg">
            Save and add another
          </button>
          <button type="button" onClick={() => save(false)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-fg shadow-sm hover:brightness-110" data-testid="quickadd-save">
            <Check size={16} /> Save
          </button>
        </div>
      }
    >
      <div className="space-y-5" data-quickadd>
        <div className="flex gap-1 rounded-2xl border border-border bg-surface-2 p-1" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "out"} onClick={() => onTab("out")} className={seg(tab === "out")}>
            <ArrowUpRight size={16} className="text-critical" /> Money out
          </button>
          <button type="button" role="tab" aria-selected={tab === "in"} onClick={() => onTab("in")} className={seg(tab === "in")}>
            <ArrowDownLeft size={16} className="text-positive" /> Money in
          </button>
        </div>

        {errors.length > 0 && (
          <ul className="rounded-xl border border-critical/30 bg-critical-soft px-3 py-2 text-xs text-critical">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        <div>
          <BigMoney value={amount} onChange={setAmount} currency={currency} />
          {base !== household && (
            <div className="mt-2 flex gap-1.5">
              {[base, household].map((c) => (
                <button key={c} type="button" onClick={() => setCurrency(c)} className={clsx("rounded-full border px-3 py-1 text-xs font-medium", currency === c ? "border-accent bg-accent-soft text-accent" : "border-border text-fg-muted")}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        {tab === "out" && (
          <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
            <button type="button" onClick={() => setSide("business")} className={seg(side === "business")}>
              {personalOnly ? "Bills & subscriptions" : "Business"}
            </button>
            <button type="button" onClick={() => setSide("personal")} className={seg(side === "personal")}>
              {personalOnly ? "Day to day" : "Personal"}
            </button>
          </div>
        )}

        <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder={tab === "in" ? "What was it for? (e.g. November retainer)" : "What was it? (e.g. Figma, groceries, Uber)"} className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />

        {tab === "out" && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-fg-muted">Category</div>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <button key={c.id} type="button" onClick={() => setCategoryId(categoryId === c.id ? null : c.id)} className={clsx("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", categoryId === c.id ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg")}>
                  {c.name}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              {side === "personal" ? (
                <label className="flex cursor-pointer items-center gap-2 text-fg">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={isHousehold} onChange={(e) => setEssential(e.target.checked)} /> Household essential <span className="text-xs text-fg-faint">(rent, food, bills)</span>
                </label>
              ) : (
                <label className="flex cursor-pointer items-center gap-2 text-fg">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={repeats} onChange={(e) => setRepeats(e.target.checked)} /> Repeats every month
                </label>
              )}
            </div>
          </div>
        )}

        {tab === "in" && clients.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-fg-muted">From</div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setClientId(null)} className={clsx("rounded-full border px-3 py-1.5 text-xs font-medium", clientId === null ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-muted")}>
                Other income
              </button>
              {clients.map((c) => (
                <button key={c.id} type="button" onClick={() => setClientId(c.id)} className={clsx("rounded-full border px-3 py-1.5 text-xs font-medium", clientId === c.id ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-muted")}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-xs font-medium text-fg-muted">When</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { label: "Today", value: today },
              { label: "Yesterday", value: addDays(today, -1) },
            ].map((o) => (
              <button key={o.label} type="button" onClick={() => { setDate(o.value); setPickDate(false); }} className={clsx("rounded-full border px-3 py-1.5 text-xs font-medium", date === o.value && !pickDate ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-muted")}>
                {o.label}
              </button>
            ))}
            <button type="button" onClick={() => setPickDate(true)} className={clsx("rounded-full border px-3 py-1.5 text-xs font-medium", pickDate ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-muted")}>
              Another day
            </button>
            {pickDate && <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-fg" />}
          </div>
        </div>
      </div>
    </Modal>
  );
}
