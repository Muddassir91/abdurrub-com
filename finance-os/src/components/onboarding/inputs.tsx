"use client";

import React, { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Check, Minus, Plus, X } from "lucide-react";
import { currencyMeta, formatMoney, minorToMajor, parseMajorToMinor, CURRENCY_CODES, POPULAR_CURRENCIES, type CurrencyCode, type Minor } from "@/lib/money";
import type { NamedAmount, SplitPct } from "@/onboarding/model";
import { BUCKET_COLORS } from "@/components/charts";
import { BUCKETS, type Bucket } from "@/lib/constants";

/* Large, friendly inputs for the one-question-per-screen setup flow. */

const big = "w-full rounded-2xl border-2 border-border bg-surface px-4 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 tabular";

export function BigText({ value, onChange, placeholder, autoFocus = true, type = "text", inputMode }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"] }) {
  return <input type={type} inputMode={inputMode} autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={clsx(big, "h-14 text-lg sm:h-16 sm:text-xl")} />;
}

export function BigMoney({ value, onChange, currency, autoFocus = true, placeholder = "0" }: { value: Minor; onChange: (v: Minor) => void; currency: CurrencyCode; autoFocus?: boolean; placeholder?: string }) {
  const toText = (v: Minor) => (v === 0 ? "" : minorToMajor(v, currency).toNumber() % 1 === 0 ? String(minorToMajor(v, currency).toNumber()) : minorToMajor(v, currency).toFixed(2));
  const [text, setText] = useState(toText(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(toText(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const parse = (t: string) => {
    try {
      return Math.abs(parseMajorToMinor(t, currency));
    } catch {
      return 0;
    }
  };
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-xl font-semibold text-fg-faint sm:text-2xl">{currencyMeta(currency).symbol}</span>
      <input
        inputMode="decimal"
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const t = e.target.value;
          if (!/^[0-9,]*\.?[0-9]{0,2}$/.test(t)) return;
          setText(t);
          const v = parse(t);
          last.current = v;
          onChange(v);
        }}
        className={clsx(big, "h-16 text-2xl font-semibold sm:h-20 sm:text-3xl", currencyMeta(currency).symbol.length > 1 ? "pl-16 sm:pl-20" : "pl-11 sm:pl-14")}
        aria-label="Amount"
      />
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-medium text-fg-faint">{currency}</span>
    </div>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  body?: string;
  emoji?: string;
}

export function ChoiceGrid<T extends string>({ options, value, onChange, columns = 2 }: { options: ChoiceOption<T>[]; value: T | null | undefined; onChange: (v: T) => void; columns?: 1 | 2 | 3 }) {
  const cols = { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3" }[columns];
  return (
    <div className={clsx("grid gap-2.5", cols)} role="radiogroup">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.value)} className={clsx("group flex min-h-[64px] items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-all active:scale-[0.99]", active ? "border-accent bg-accent-soft shadow-[0_8px_24px_-12px_var(--accent)]" : "border-border bg-surface hover:border-border-strong hover:bg-surface-2")}>
            {o.emoji && <span className="text-2xl leading-none">{o.emoji}</span>}
            <span className="min-w-0 flex-1">
              <span className={clsx("block text-base font-semibold", active ? "text-accent" : "text-fg")}>{o.label}</span>
              {o.body && <span className="mt-0.5 block text-xs text-fg-muted">{o.body}</span>}
            </span>
            <span className={clsx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors", active ? "border-accent bg-accent text-accent-fg" : "border-border-strong text-transparent")}>
              <Check size={14} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ChipMulti<T extends string>({ options, value, onChange, max }: { options: ChoiceOption<T>[]; value: T[]; onChange: (v: T[]) => void; max?: number }) {
  const toggle = (v: T) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else if (!max || value.length < max) onChange([...value, v]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value.includes(o.value);
        const disabled = !active && !!max && value.length >= max;
        return (
          <button key={o.value} type="button" aria-pressed={active} disabled={disabled} onClick={() => toggle(o.value)} className={clsx("inline-flex items-center gap-2 rounded-full border-2 px-4 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:opacity-40", active ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-fg hover:border-border-strong")}>
            {o.emoji && <span>{o.emoji}</span>}
            {o.label}
            {active && <Check size={14} />}
          </button>
        );
      })}
    </div>
  );
}

/** A list of named amounts with preset chips to add quickly. */
export function AmountList({ items, onChange, currency, presets, addLabel = "Add another", namePlaceholder = "Name", frequencies }: { items: NamedAmount[]; onChange: (v: NamedAmount[]) => void; currency: CurrencyCode; presets?: { name: string; category?: string }[]; addLabel?: string; namePlaceholder?: string; frequencies?: boolean }) {
  const set = (i: number, patch: Partial<NamedAmount>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const add = (name = "", category?: string) => onChange([...items, { name, amountMinor: 0, category, frequency: frequencies ? "monthly" : undefined }]);
  const unused = (presets ?? []).filter((p) => !items.some((x) => x.name.toLowerCase() === p.name.toLowerCase()));
  const total = items.reduce((s, x) => s + x.amountMinor, 0);
  return (
    <div className="space-y-3">
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {unused.map((p) => (
            <button key={p.name} type="button" onClick={() => add(p.name, p.category)} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-accent hover:text-accent">
              <Plus size={12} /> {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {items.map((x, i) => (
          <div key={i} className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-2 pop-in">
            <input value={x.name} onChange={(e) => set(i, { name: e.target.value })} placeholder={namePlaceholder} className="h-11 min-w-0 flex-1 rounded-xl bg-transparent px-2 text-sm font-medium text-fg placeholder:text-fg-faint focus:outline-none" autoFocus={!x.name} />
            {frequencies && (
              <select value={x.frequency ?? "monthly"} onChange={(e) => set(i, { frequency: e.target.value as NamedAmount["frequency"] })} className="h-11 rounded-xl border border-border bg-surface-2 px-2 text-xs text-fg-muted focus:outline-none">
                <option value="monthly">monthly</option>
                <option value="quarterly">quarterly</option>
                <option value="annual">yearly</option>
                <option value="weekly">weekly</option>
              </select>
            )}
            <SmallMoney value={x.amountMinor} onChange={(v) => set(i, { amountMinor: v })} currency={currency} autoFocus={!!x.name && x.amountMinor === 0} />
            <button type="button" onClick={() => remove(i)} className="rounded-lg p-2 text-fg-faint hover:bg-surface-2 hover:text-critical" aria-label={`Remove ${x.name || "row"}`}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => add()} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
          <Plus size={14} /> {addLabel}
        </button>
        {total > 0 && (
          <div className="text-sm text-fg-muted">
            Total <span className="tabular font-semibold text-fg">{formatMoney(total, currency)}</span>
            {frequencies ? " a month-ish" : " a month"}
          </div>
        )}
      </div>
    </div>
  );
}

export function SmallMoney({ value, onChange, currency, autoFocus, className }: { value: Minor; onChange: (v: Minor) => void; currency: CurrencyCode; autoFocus?: boolean; className?: string }) {
  const toText = (v: Minor) => (v === 0 ? "" : minorToMajor(v, currency).toNumber() % 1 === 0 ? String(minorToMajor(v, currency).toNumber()) : minorToMajor(v, currency).toFixed(2));
  const [text, setText] = useState(toText(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(toText(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={clsx("relative w-32 shrink-0", className)}>
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-fg-faint">{currencyMeta(currency).symbol}</span>
      <input
        inputMode="decimal"
        autoFocus={autoFocus}
        value={text}
        placeholder="0"
        aria-label="Amount"
        onChange={(e) => {
          const t = e.target.value;
          if (!/^[0-9,]*\.?[0-9]{0,2}$/.test(t)) return;
          setText(t);
          let v = 0;
          try {
            v = Math.abs(parseMajorToMinor(t, currency));
          } catch {
            v = 0;
          }
          last.current = v;
          onChange(v);
        }}
        className={clsx("h-11 w-full rounded-xl border border-border bg-surface-2 pr-2 text-right text-sm font-semibold tabular text-fg focus:border-accent focus:outline-none", currencyMeta(currency).symbol.length > 1 ? "pl-10" : "pl-7")}
      />
    </div>
  );
}

/** Fixed household lines, each with an amount. */
export function HouseholdList({ items, onChange, currency }: { items: NamedAmount[]; onChange: (v: NamedAmount[]) => void; currency: CurrencyCode }) {
  const set = (i: number, v: Minor) => onChange(items.map((x, j) => (j === i ? { ...x, amountMinor: v } : x)));
  const total = items.reduce((s, x) => s + x.amountMinor, 0);
  return (
    <div className="space-y-2">
      {items.map((x, i) => (
        <div key={x.name} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-2">
          <span className="text-sm font-medium text-fg">{x.name}</span>
          <SmallMoney value={x.amountMinor} onChange={(v) => set(i, v)} currency={currency} autoFocus={i === 0} className="w-36" />
        </div>
      ))}
      <div className="flex items-center justify-between px-1 pt-1 text-sm text-fg-muted">
        <span>Every month at home</span>
        <span className="tabular text-base font-semibold text-fg">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}

const SPLIT_LABELS: Record<Bucket, { label: string; body: string }> = {
  opex: { label: "Running costs", body: "Tools, subscriptions, overhead. A ceiling, not a target." },
  owner: { label: "Your pay", body: "What you take home. Household first, then the rest." },
  tax: { label: "Tax", body: "Set aside as it comes in, so the bill is never a surprise." },
  profit: { label: "Profit", body: "Kept by the business, on purpose." },
  reserve: { label: "Cushion", body: "Savings for slow months." },
  growth: { label: "Growth", body: "New tools, ads, a first hire." },
};

export function SplitEditor({ value, onChange, incomeMinor, currency, personal }: { value: SplitPct; onChange: (v: SplitPct) => void; incomeMinor: Minor; currency: CurrencyCode; personal?: boolean }) {
  const total = Object.values(value).reduce((a, b) => a + b, 0);
  const bump = (k: Bucket, d: number) => onChange({ ...value, [k]: Math.max(0, Math.min(100, value[k] + d)) });
  const buckets = personal ? BUCKETS.filter((b) => b !== "growth" || value.growth > 0) : BUCKETS;
  return (
    <div className="space-y-3">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface-2">
        {BUCKETS.map((b) => (
          <div key={b} className="h-full bar-fill transition-all" style={{ width: `${(value[b] / Math.max(total, 100)) * 100}%`, background: BUCKET_COLORS[b] }} title={`${SPLIT_LABELS[b].label} ${value[b]}%`} />
        ))}
      </div>
      <div className="space-y-2">
        {buckets.map((b) => (
          <div key={b} className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5">
            <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: BUCKET_COLORS[b] }} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-fg">{SPLIT_LABELS[b].label}</div>
              <div className="truncate text-[11px] text-fg-muted">{incomeMinor > 0 ? <span className="tabular">{formatMoney(Math.round((incomeMinor * value[b]) / 100), currency)} of a typical month</span> : SPLIT_LABELS[b].body}</div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => bump(b, -1)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-fg-muted hover:bg-surface-2" aria-label={`Less ${SPLIT_LABELS[b].label}`}>
                <Minus size={14} />
              </button>
              <span className="tabular w-12 text-center text-base font-semibold text-fg">{value[b]}%</span>
              <button type="button" onClick={() => bump(b, 1)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-fg-muted hover:bg-surface-2" aria-label={`More ${SPLIT_LABELS[b].label}`}>
                <Plus size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className={clsx("flex items-center justify-between rounded-xl px-3 py-2 text-sm", total === 100 ? "bg-positive-soft text-positive" : "bg-caution-soft text-caution")}>
        <span>{total === 100 ? "Adds up to 100%. Every unit that comes in has a job." : total > 100 ? `${total - 100}% too much. Take a little off somewhere.` : `${100 - total}% not yet assigned.`}</span>
        <span className="tabular font-semibold">{total}%</span>
      </div>
    </div>
  );
}

/** Searchable picker over every ISO currency; popular ones first. Selecting a tile calls onChange. */
export function CurrencyPicker({ value, onChange }: { value: CurrencyCode | null | undefined; onChange: (v: CurrencyCode) => void }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const list = (query
    ? CURRENCY_CODES.filter((c) => {
        const m = currencyMeta(c);
        return c.toLowerCase().includes(query) || m.name.toLowerCase().includes(query) || m.symbol.toLowerCase() === query;
      })
    : POPULAR_CURRENCIES
  ).slice(0, 36);
  return (
    <div className="space-y-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by code or name, e.g. PKR, euro, rupee" autoFocus className={clsx(big, "h-12 text-base")} aria-label="Search currencies" />
      {!query && <div className="text-xs text-fg-faint">Common choices. Type to find any of the {CURRENCY_CODES.length} world currencies.</div>}
      {list.length === 0 && <div className="text-sm text-fg-muted">No currency matches “{q}”.</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup">
        {list.map((c) => {
          const m = currencyMeta(c);
          const active = c === value;
          return (
            <button key={c} type="button" role="radio" aria-checked={active} aria-label={`${c} ${m.name}`} onClick={() => onChange(c)} className={clsx("flex items-center gap-2.5 rounded-2xl border-2 px-3 py-2.5 text-left transition-all active:scale-[0.99]", active ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-border-strong hover:bg-surface-2")}>
              <span className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold", active ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted")}>{m.symbol.length > 3 ? c.slice(0, 2) : m.symbol}</span>
              <span className="min-w-0">
                <span className={clsx("block text-sm font-semibold", active ? "text-accent" : "text-fg")}>{c}</span>
                <span className="block truncate text-[11px] text-fg-muted">{m.name}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A percentage typed freely, with quick picks. */
export function PercentPicker({ value, onChange, presets }: { value: number; onChange: (v: number) => void; presets: number[] }) {
  const [text, setText] = useState(String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(String(value));
    }
  }, [value]);
  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          inputMode="decimal"
          autoFocus
          value={text}
          placeholder="e.g. 15"
          aria-label="Percentage"
          onChange={(e) => {
            const t = e.target.value;
            if (!/^[0-9]{0,3}\.?[0-9]{0,2}$/.test(t)) return;
            setText(t);
            const v = t === "" || t === "." ? 0 : Number(t);
            last.current = v;
            onChange(v);
          }}
          className={clsx(big, "h-16 pr-14 text-2xl font-semibold sm:h-20 sm:text-3xl")}
        />
        <span className="pointer-events-none absolute inset-y-0 right-5 flex items-center text-2xl font-semibold text-fg-faint">%</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button key={p} type="button" onClick={() => { last.current = p; setText(String(p)); onChange(p); }} className={clsx("rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-colors", value === p ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg")}>
            {p === 0 ? "None" : `${p}%`}
          </button>
        ))}
      </div>
    </div>
  );
}
