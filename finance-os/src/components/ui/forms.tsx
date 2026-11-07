"use client";

import React, { useEffect, useState } from "react";
import { clsx } from "clsx";
import { CURRENCIES, minorToMajor, parseMajorToMinor, type CurrencyCode, type Minor } from "@/lib/money";

const inputCls = "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60 tabular";

export function Field({ label, hint, error, children, className, required }: { label?: React.ReactNode; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={clsx("block", className)}>
      {label && (
        <span className="mb-1 block text-xs font-medium text-fg-muted">
          {label}
          {required && <span className="text-critical"> *</span>}
        </span>
      )}
      {children}
      {error ? <span className="mt-1 block text-xs text-critical">{error}</span> : hint ? <span className="mt-1 block text-xs text-fg-faint">{hint}</span> : null}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={clsx(inputCls, className)} {...props} />;
});

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(inputCls, "h-auto min-h-[72px] py-2", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(inputCls, "appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238b94a5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")" }} {...props}>
      {children}
    </select>
  );
}

/** Money input: edits in major units, emits integer minor units. */
export function MoneyInput({ value, onChange, currency = "USD", className, allowNegative, ...props }: { value: Minor; onChange: (minor: Minor) => void; currency?: CurrencyCode; className?: string; allowNegative?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const digits = CURRENCIES[currency].digits;
  const toText = (v: Minor) => (v === 0 ? "" : minorToMajor(v, currency).toFixed(digits));
  const [text, setText] = useState(toText(value));
  useEffect(() => {
    // Sync when the external value changes (e.g. form reset) and differs from what's typed.
    const parsed = safeParse(text, currency, allowNegative);
    if (parsed !== value) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency]);
  return (
    <div className={clsx("relative", className)}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-fg-faint">{CURRENCIES[currency].symbol}</span>
      <input
        inputMode="decimal"
        className={clsx(inputCls, "pl-9")}
        value={text}
        onChange={(e) => {
          const t = e.target.value;
          if (!/^-?[0-9,]*\.?[0-9]*$/.test(t)) return;
          setText(t);
          onChange(safeParse(t, currency, allowNegative));
        }}
        onBlur={() => setText(toText(safeParse(text, currency, allowNegative)))}
        {...props}
      />
    </div>
  );
}

function safeParse(t: string, currency: CurrencyCode, allowNegative?: boolean): Minor {
  try {
    const v = parseMajorToMinor(t, currency);
    return allowNegative ? v : Math.abs(v);
  } catch {
    return 0;
  }
}

/** Percent input stored as a decimal string. */
export function PercentInput({ value, onChange, className, ...props }: { value: string; onChange: (v: string) => void; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div className={clsx("relative", className)}>
      <input inputMode="decimal" className={clsx(inputCls, "pr-7")} value={value} onChange={(e) => /^-?[0-9]*\.?[0-9]*$/.test(e.target.value) && onChange(e.target.value)} {...props} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-fg-faint">%</span>
    </div>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border-strong accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-fg">{label}</span>
        {hint && <span className="block text-xs text-fg-faint">{hint}</span>}
      </span>
    </label>
  );
}

export function FormRow({ children, cols = 2, className }: { children: React.ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const c = { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[cols];
  return <div className={clsx("grid gap-3", c, className)}>{children}</div>;
}

export function FormError({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-xs text-critical">
      {errors.map((e, i) => (
        <li key={i}>{e}</li>
      ))}
    </ul>
  );
}
