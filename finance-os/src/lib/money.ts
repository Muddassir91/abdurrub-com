import Decimal from "decimal.js";

/**
 * Money primitives.
 *
 * Every amount is stored as an INTEGER in the currency's minor unit
 * (USD cents, PKR paisa). All arithmetic goes through decimal.js so we never
 * rely on binary floating point for currency math. Percentages and exchange
 * rates are stored as decimal strings ("25", "280.5") and parsed on demand.
 */

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Minor = number; // integer minor units
export type CurrencyCode = "USD" | "PKR" | "EUR" | "GBP" | "AED" | "CAD" | "AUD";

export const CURRENCIES: Record<CurrencyCode, { symbol: string; name: string; digits: number; locale: string }> = {
  USD: { symbol: "$", name: "US Dollar", digits: 2, locale: "en-US" },
  PKR: { symbol: "Rs", name: "Pakistani Rupee", digits: 2, locale: "en-PK" },
  EUR: { symbol: "€", name: "Euro", digits: 2, locale: "de-DE" },
  GBP: { symbol: "£", name: "British Pound", digits: 2, locale: "en-GB" },
  AED: { symbol: "AED", name: "UAE Dirham", digits: 2, locale: "en-AE" },
  CAD: { symbol: "C$", name: "Canadian Dollar", digits: 2, locale: "en-CA" },
  AUD: { symbol: "A$", name: "Australian Dollar", digits: 2, locale: "en-AU" },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export const D = (v: Decimal.Value) => new Decimal(v);

/** Parse a user-entered major-unit amount ("1,234.50") into integer minor units. */
export function parseMajorToMinor(input: string | number, currency: CurrencyCode = "USD"): Minor {
  const cleaned = String(input).replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return 0;
  const d = new Decimal(cleaned);
  if (!d.isFinite()) throw new Error("Invalid amount");
  return d.mul(Decimal.pow(10, CURRENCIES[currency].digits)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function minorToMajor(minor: Minor, currency: CurrencyCode = "USD"): Decimal {
  return new Decimal(minor).div(Decimal.pow(10, CURRENCIES[currency].digits));
}

export function majorToMinor(major: Decimal.Value, currency: CurrencyCode = "USD"): Minor {
  return new Decimal(major).mul(Decimal.pow(10, CURRENCIES[currency].digits)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Round a Decimal to an integer minor amount (half-up). */
export function toMinor(d: Decimal.Value): Minor {
  return new Decimal(d).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Percentage of an amount. pct is a decimal string or number in percent units ("25" = 25%). */
export function pctOf(amount: Minor, pct: Decimal.Value): Minor {
  return toMinor(new Decimal(amount).mul(pct).div(100));
}

/** Ratio a / b as a percentage Decimal; returns null when b is zero. */
export function ratioPct(a: Minor, b: Minor): Decimal | null {
  if (b === 0) return null;
  return new Decimal(a).div(b).mul(100);
}

export function sum(values: Minor[]): Minor {
  return values.reduce((acc, v) => acc + v, 0);
}

/**
 * Split `total` across weights (percentages) so the parts add up EXACTLY to
 * total, using the largest-remainder method. Deterministic: ties broken by
 * input order.
 */
export function allocateExact<K extends string>(total: Minor, weights: { key: K; pct: Decimal.Value }[]): Record<K, Minor> {
  const result = {} as Record<K, Minor>;
  if (weights.length === 0) return result;
  const raw = weights.map((w) => new Decimal(total).mul(w.pct).div(100));
  const floors = raw.map((r) => (total >= 0 ? r.floor() : r.ceil()));
  let assigned = floors.reduce((a, b) => a.plus(b), new Decimal(0));
  const remainders = raw.map((r, i) => ({ i, rem: r.minus(floors[i]).abs() }));
  remainders.sort((a, b) => b.rem.comparedTo(a.rem) || a.i - b.i);
  const step = total >= 0 ? 1 : -1;
  let idx = 0;
  while (!assigned.equals(total) && idx < remainders.length * 2) {
    const target = remainders[idx % remainders.length].i;
    floors[target] = floors[target].plus(step);
    assigned = assigned.plus(step);
    idx++;
  }
  weights.forEach((w, i) => {
    result[w.key] = floors[i].toNumber();
  });
  return result;
}

/** Convert a foreign minor amount to USD cents using a rate expressed as "quote units per 1 USD". */
export function convertToUsdCents(amountMinor: Minor, currency: CurrencyCode, ratePerUsd: Decimal.Value): Minor {
  if (currency === "USD") return amountMinor;
  const rate = new Decimal(ratePerUsd);
  if (rate.lte(0)) throw new Error("Exchange rate must be positive");
  // Both currencies have 2 minor digits so minor/minor conversion is direct.
  return toMinor(new Decimal(amountMinor).div(rate));
}

export function convertFromUsdCents(usdCents: Minor, currency: CurrencyCode, ratePerUsd: Decimal.Value): Minor {
  if (currency === "USD") return usdCents;
  return toMinor(new Decimal(usdCents).mul(ratePerUsd));
}

export function formatMoney(minor: Minor, currency: CurrencyCode = "USD", opts: { compact?: boolean; signed?: boolean; decimals?: number } = {}): string {
  const meta = CURRENCIES[currency];
  const major = minorToMajor(minor, currency);
  const abs = major.abs();
  const sign = major.isNegative() ? "-" : opts.signed && major.gt(0) ? "+" : "";
  let body: string;
  if (opts.compact && abs.gte(1_000_000)) {
    body = abs.div(1_000_000).toDecimalPlaces(2).toString() + "M";
  } else if (opts.compact && abs.gte(10_000)) {
    body = abs.div(1_000).toDecimalPlaces(1).toString() + "k";
  } else {
    const decimals = opts.decimals ?? (currency === "PKR" ? 0 : 2);
    body = abs.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  return `${sign}${meta.symbol}${currency === "PKR" || currency === "AED" ? " " : ""}${body}`;
}

export function formatPct(value: Decimal.Value | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${new Decimal(value).toFixed(digits)}%`;
}

/** Validate that a set of percentage strings sums to exactly 100. */
export function percentagesSumTo100(pcts: Decimal.Value[]): { ok: boolean; total: Decimal } {
  const total = pcts.reduce<Decimal>((acc, p) => acc.plus(p || 0), new Decimal(0));
  return { ok: total.equals(100), total };
}

export function isValidDecimalString(s: string): boolean {
  try {
    const d = new Decimal(s);
    return d.isFinite();
  } catch {
    return false;
  }
}
