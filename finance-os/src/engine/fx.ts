import type { FxRate, Settings } from "@/db/schema";
import type { CurrencyCode } from "@/lib/money";

/**
 * Exchange rate (quote units per 1 USD) applicable on a date: the most recent
 * manually entered rate on or before the date, else the settings default.
 */
export function rateFor(currency: CurrencyCode, date: string, fxRates: FxRate[], settings: Settings): string {
  if (currency === "USD") return "1";
  const candidates = fxRates.filter((r) => r.currency === currency && r.date <= date).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (candidates.length > 0) return candidates[0].ratePerUsd;
  const after = fxRates.filter((r) => r.currency === currency).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (after.length > 0) return after[0].ratePerUsd;
  if (currency === settings.householdCurrency) return settings.defaultFxRatePkrPerUsd;
  return "1";
}

export function latestRate(currency: CurrencyCode, fxRates: FxRate[], settings: Settings): string {
  if (currency === "USD") return "1";
  const sorted = fxRates.filter((r) => r.currency === currency).sort((a, b) => (a.date < b.date ? 1 : -1));
  return sorted[0]?.ratePerUsd ?? (currency === settings.householdCurrency ? settings.defaultFxRatePkrPerUsd : "1");
}
