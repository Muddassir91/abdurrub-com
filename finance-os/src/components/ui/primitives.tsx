"use client";

import React from "react";
import { clsx } from "clsx";
import type { AlertLevel } from "@/lib/constants";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

export function Button({ variant = "secondary", size = "md", className, loading, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
  const sizes = { sm: "h-8 px-2.5 text-xs", md: "h-9 px-3.5 text-sm", lg: "h-11 px-5 text-sm" };
  const variants = {
    primary: "bg-accent text-accent-fg hover:brightness-110 shadow-sm",
    secondary: "bg-surface-2 text-fg hover:bg-border border border-border",
    outline: "bg-transparent text-fg border border-border-strong hover:bg-surface-2",
    ghost: "bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg",
    danger: "bg-critical-soft text-critical hover:brightness-95 border border-transparent",
  };
  return (
    <button className={clsx(base, sizes[size], variants[variant], className)} disabled={loading || props.disabled} {...props}>
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Card({ className, children, title, subtitle, actions, padded = true }: { className?: string; children?: React.ReactNode; title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; padded?: boolean }) {
  return (
    <section className={clsx("min-w-0 rounded-xl border border-border bg-surface shadow-card", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(padded && "p-5")}>{children}</div>
    </section>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "accent" | "positive" | "caution" | "critical" | "info"; children: React.ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-fg-muted border-border",
    accent: "bg-accent-soft text-accent border-transparent",
    positive: "bg-positive-soft text-positive border-transparent",
    caution: "bg-caution-soft text-caution border-transparent",
    critical: "bg-critical-soft text-critical border-transparent",
    info: "bg-info-soft text-info border-transparent",
  };
  return <span className={clsx("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4", tones[tone], className)}>{children}</span>;
}

export const levelTone: Record<AlertLevel, "info" | "caution" | "critical"> = { info: "info", caution: "caution", critical: "critical" };

export function Progress({ value, max, tone = "accent", className, thin }: { value: number; max: number; tone?: "accent" | "positive" | "caution" | "critical" | "neutral"; className?: string; thin?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const colors = { accent: "bg-accent", positive: "bg-positive", caution: "bg-caution", critical: "bg-critical", neutral: "bg-fg-faint" };
  return (
    <div className={clsx("w-full overflow-hidden rounded-full bg-surface-2", thin ? "h-1.5" : "h-2", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx("h-full rounded-full transition-all", colors[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Progress tone for spend vs budget: green under 90%, amber to 100%, red over. */
export function spendTone(actual: number, budget: number): "positive" | "caution" | "critical" | "neutral" {
  if (budget <= 0) return actual > 0 ? "critical" : "neutral";
  const r = actual / budget;
  if (r > 1) return "critical";
  if (r > 0.9) return "caution";
  return "positive";
}

export function Stat({ label, value, sub, tone, hint, className }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: "positive" | "caution" | "critical" | "neutral"; hint?: string; className?: string }) {
  const toneCls = tone === "positive" ? "text-positive" : tone === "caution" ? "text-caution" : tone === "critical" ? "text-critical" : "text-fg";
  return (
    <div className={clsx("rounded-xl border border-border bg-surface p-4 shadow-card", className)} title={hint}>
      <div className="text-xs font-medium text-fg-muted">{label}</div>
      <div className={clsx("tabular mt-1.5 text-xl font-semibold tracking-tight", toneCls)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-fg-faint">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong px-6 py-10 text-center">
      <div className="text-sm font-medium text-fg">{title}</div>
      {body && <div className="mt-1 max-w-md text-xs text-fg-muted">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx("inline-flex cursor-pointer select-none items-center gap-2 text-sm", disabled && "opacity-50")}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={clsx("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-accent" : "bg-border-strong")}>
        <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
      </button>
      {label && <span className="text-fg">{label}</span>}
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: React.ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={clsx("inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface-2 p-1", className)} role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)} className={clsx("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", t.value === value ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}>
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded bg-border px-1 text-[10px] text-fg-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Callout({ tone = "info", title, children, className }: { tone?: "info" | "caution" | "critical" | "positive" | "neutral"; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const tones = {
    info: "border-info/30 bg-info-soft text-fg",
    caution: "border-caution/30 bg-caution-soft text-fg",
    critical: "border-critical/30 bg-critical-soft text-fg",
    positive: "border-positive/30 bg-positive-soft text-fg",
    neutral: "border-border bg-surface-2 text-fg",
  };
  return (
    <div className={clsx("rounded-lg border px-4 py-3 text-sm", tones[tone], className)}>
      {title && <div className="font-medium">{title}</div>}
      {children && <div className={clsx("text-fg-muted", title && "mt-1")}>{children}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[10px] text-fg-muted">{children}</kbd>;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={clsx("border-border", className)} />;
}

export function DefinitionList({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode; hint?: string }[]; className?: string }) {
  return (
    <dl className={clsx("divide-y divide-border", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2 text-sm" title={it.hint}>
          <dt className="text-fg-muted">{it.label}</dt>
          <dd className="tabular font-medium text-fg">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
