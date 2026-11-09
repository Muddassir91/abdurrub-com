import Decimal from "decimal.js";

/**
 * Money primitives.
 *
 * Every amount is stored as an INTEGER in the currency's minor unit (cents,
 * paisa, fils…). All arithmetic goes through decimal.js so we never rely on
 * binary floating point for currency math. Percentages and exchange rates are
 * stored as decimal strings ("25", "280.5") and parsed on demand.
 *
 * The ledger's unit is the workspace's base currency; historically it is
 * called "USD cents" throughout the code and the functions below keep those
 * names.
 */

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Minor = number; // integer minor units
/** ISO 4217 code. Any code in ISO_CURRENCIES is accepted everywhere. */
export type CurrencyCode = string;

export interface CurrencyMeta {
  code: string;
  symbol: string;
  name: string;
  digits: number;
}

/** Every active ISO 4217 currency, with minor-unit digits where they are not 2. */
const ZERO_DIGITS = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DIGITS = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
export const ISO_CURRENCIES = [
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD",
  "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD",
  "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD",
  "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG",
  "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS",
  "UAH", "UGX", "USD", "UYU", "UZS", "VES", "VND", "VUV", "WST", "XAF", "XCD", "XOF", "XPF", "YER", "ZAR", "ZMW", "ZWL",
] as const;

/** Symbols kept short and unambiguous; everything else comes from Intl or falls back to the code. */
const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", PKR: "Rs", INR: "₹", JPY: "¥", CNY: "CN¥", KRW: "₩", AED: "AED", SAR: "SAR", CAD: "C$", AUD: "A$", NZD: "NZ$", SGD: "S$", HKD: "HK$", MXN: "MX$", BRL: "R$", ZAR: "R", NGN: "₦", PHP: "₱", TRY: "₺", RUB: "₽", UAH: "₴", ILS: "₪", THB: "฿", VND: "₫", BDT: "৳", LKR: "Rs", NPR: "Rs", EGP: "E£", KES: "KSh", GHS: "GH₵", IDR: "Rp", MYR: "RM", CHF: "CHF", SEK: "kr", NOK: "kr", DKK: "kr", PLN: "zł", CZK: "Kč", HUF: "Ft" };

const names = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {
    return null;
  }
})();

function build(code: string): CurrencyMeta {
  const digits = ZERO_DIGITS.has(code) ? 0 : THREE_DIGITS.has(code) ? 3 : 2;
  let name = code;
  try {
    name = names?.of(code) ?? code;
  } catch {
    name = code;
  }
  let symbol = SYMBOLS[code];
  if (!symbol) {
    try {
      const part = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(1).find((p) => p.type === "currency")?.value ?? code;
      // "$" alone would be ambiguous for anything but USD; letters-only symbols read better as the code.
      symbol = part === "$" || /^[A-Za-z]+$/.test(part) ? code : part;
    } catch {
      symbol = code;
    }
  }
  return { code, symbol, name, digits };
}

export const CURRENCIES: Record<string, CurrencyMeta> = Object.fromEntries(ISO_CURRENCIES.map((c) => [c, build(c)]));
export const CURRENCY_CODES: CurrencyCode[] = [...ISO_CURRENCIES];
/** Shown first in pickers. */
export const POPULAR_CURRENCIES: CurrencyCode[] = ["USD", "EUR", "GBP", "PKR", "INR", "AED", "SAR", "CAD", "AUD", "NGN", "PHP", "BDT", "EGP", "ZAR", "TRY", "IDR", "MYR", "SGD", "JPY", "CNY", "BRL", "MXN", "KES", "LKR"];

/** Metadata for a code; unknown codes get a sensible fallback instead of a crash. */
export function currencyMeta(code: CurrencyCode | null | undefined): CurrencyMeta {
  const c = (code ?? "USD").toUpperCase();
  return CURRENCIES[c] ?? { code: c, symbol: c, name: c, digits: 2 };
}

export const isKnownCurrency = (code: string) => code.toUpperCase() in CURRENCIES;

export const D = (v: Decimal.Value) => new Decimal(v);

/** Parse a user-entered major-unit amount ("1,234.50") into integer minor units. */
export function parseMajorToMinor(input: string | number, currency: CurrencyCode = "USD"): Minor {
  const cleaned = String(input).replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return 0;
  const d = new Decimal(cleaned);
  if (!d.isFinite()) throw new Error("Invalid amount");
  return d.mul(Decimal.pow(10, currencyMeta(currency).digits)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function minorToMajor(minor: Minor, currency: CurrencyCode = "USD"): Decimal {
  return new Decimal(minor).div(Decimal.pow(10, currencyMeta(currency).digits));
}

export function majorToMinor(major: Decimal.Value, currency: CurrencyCode = "USD"): Minor {
  return new Decimal(major).mul(Decimal.pow(10, currencyMeta(currency).digits)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
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

/**
 * Convert a foreign minor amount to ledger (base) minor units using a rate
 * expressed as "quote units per 1 base unit". Minor-unit digits of the quote
 * currency are respected (¥1,000 is 1000 minor units, not 10.00).
 */
export function convertToUsdCents(amountMinor: Minor, currency: CurrencyCode, ratePerUsd: Decimal.Value, baseDigits = 2): Minor {
  if (currency === "USD") return amountMinor;
  const rate = new Decimal(ratePerUsd);
  if (rate.lte(0)) throw new Error("Exchange rate must be positive");
  const major = new Decimal(amountMinor).div(Decimal.pow(10, currencyMeta(currency).digits));
  return toMinor(major.div(rate).mul(Decimal.pow(10, baseDigits)));
}

export function convertFromUsdCents(usdCents: Minor, currency: CurrencyCode, ratePerUsd: Decimal.Value, baseDigits = 2): Minor {
  if (currency === "USD") return usdCents;
  const major = new Decimal(usdCents).div(Decimal.pow(10, baseDigits)).mul(ratePerUsd);
  return toMinor(major.mul(Decimal.pow(10, currencyMeta(currency).digits)));
}

export function formatMoney(minor: Minor, currency: CurrencyCode = "USD", opts: { compact?: boolean; signed?: boolean; decimals?: number } = {}): string {
  const meta = currencyMeta(currency);
  const major = minorToMajor(minor, currency);
  const abs = major.abs();
  const sign = major.isNegative() ? "-" : opts.signed && major.gt(0) ? "+" : "";
  let body: string;
  if (opts.compact && abs.gte(1_000_000)) {
    body = abs.div(1_000_000).toDecimalPlaces(2).toString() + "M";
  } else if (opts.compact && abs.gte(10_000)) {
    body = abs.div(1_000).toDecimalPlaces(1).toString() + "k";
  } else {
    const decimals = opts.decimals ?? (currency === "PKR" || meta.digits === 0 ? 0 : meta.digits);
    body = abs.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  const space = /^[A-Za-z]/.test(meta.symbol) ? " " : "";
  return `${sign}${meta.symbol}${space}${body}`;
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
