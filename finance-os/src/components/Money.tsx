"use client";

import React from "react";
import { clsx } from "clsx";
import { useFinance } from "@/store/FinanceProvider";
import { convertFromUsdCents, formatMoney, type CurrencyCode, type Minor } from "@/lib/money";

/**
 * Displays a USD-cent amount in the chosen display currency (USD primary, PKR
 * secondary), optionally with the other currency underneath.
 */
export function Money({ cents, className, signed, compact, secondary, tone, currency }: { cents: Minor; className?: string; signed?: boolean; compact?: boolean; secondary?: boolean; tone?: "auto" | "none"; currency?: CurrencyCode }) {
  const { displayCurrency, data } = useFinance();
  const rate = data?.settings.defaultFxRatePkrPerUsd ?? "280";
  const primaryCurrency: CurrencyCode = currency ?? displayCurrency;
  const primary = currency ? cents : displayCurrency === "USD" ? cents : convertFromUsdCents(cents, "PKR", rate);
  const other: CurrencyCode = displayCurrency === "USD" ? "PKR" : "USD";
  const otherVal = other === "USD" ? cents : convertFromUsdCents(cents, "PKR", rate);
  const toneCls = tone === "auto" ? (cents < 0 ? "text-critical" : cents > 0 ? "text-positive" : "") : "";
  return (
    <span className={clsx("tabular", toneCls, className)}>
      {formatMoney(primary, primaryCurrency, { signed, compact })}
      {secondary && !currency && <span className="ml-1 text-[11px] font-normal text-fg-faint">({formatMoney(otherVal, other, { compact: true })})</span>}
    </span>
  );
}

export function Pct({ value, className, digits = 1 }: { value: string | number | null | undefined; className?: string; digits?: number }) {
  if (value === null || value === undefined || value === "") return <span className={clsx("tabular text-fg-faint", className)}>—</span>;
  return <span className={clsx("tabular", className)}>{Number(value).toFixed(digits)}%</span>;
}
