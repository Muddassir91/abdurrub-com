"use client";

import React from "react";
import { clsx } from "clsx";
import { useFinance } from "@/store/FinanceProvider";
import { convertFromUsdCents, formatMoney, type CurrencyCode, type Minor } from "@/lib/money";

/**
 * Displays a ledger amount (base-currency minor units) in the chosen display
 * currency: the workspace's base currency, or its household currency converted
 * at the default rate. `displayCurrency` keeps its historical values "USD"
 * (= base) and "PKR" (= household).
 */
export function useDisplayCurrency(): { primary: CurrencyCode; other: CurrencyCode; rate: string; base: CurrencyCode; household: CurrencyCode } {
  const { displayCurrency, data } = useFinance();
  const base = (data?.settings.baseCurrency ?? "USD") as CurrencyCode;
  const household = (data?.settings.householdCurrency ?? "PKR") as CurrencyCode;
  const rate = data?.settings.defaultFxRatePkrPerUsd ?? "280";
  const primary = displayCurrency === "USD" ? base : household;
  const other = displayCurrency === "USD" ? household : base;
  return { primary, other, rate, base, household };
}

/** Convert a ledger amount into the currently displayed currency. */
export function toDisplay(cents: Minor, d: ReturnType<typeof useDisplayCurrency>): Minor {
  return d.primary === d.base ? cents : convertFromUsdCents(cents, d.household, d.rate);
}

export function Money({ cents, className, signed, compact, secondary, tone, currency, decimals }: { cents: Minor; className?: string; signed?: boolean; compact?: boolean; secondary?: boolean; tone?: "auto" | "none"; currency?: CurrencyCode; decimals?: number }) {
  const d = useDisplayCurrency();
  const primaryCurrency: CurrencyCode = currency ?? d.primary;
  const primary = currency ? cents : toDisplay(cents, d);
  const otherVal = d.other === d.base ? cents : convertFromUsdCents(cents, d.household, d.rate);
  const toneCls = tone === "auto" ? (cents < 0 ? "text-critical" : cents > 0 ? "text-positive" : "") : "";
  return (
    <span className={clsx("tabular", toneCls, className)}>
      {formatMoney(primary, primaryCurrency, { signed, compact, decimals })}
      {secondary && !currency && d.other !== d.primary && <span className="ml-1 text-[11px] font-normal text-fg-faint">({formatMoney(otherVal, d.other, { compact: true })})</span>}
    </span>
  );
}

export function Pct({ value, className, digits = 1 }: { value: string | number | null | undefined; className?: string; digits?: number }) {
  if (value === null || value === undefined || value === "") return <span className={clsx("tabular text-fg-faint", className)}>—</span>;
  return <span className={clsx("tabular", className)}>{Number(value).toFixed(digits)}%</span>;
}
