import Decimal from "decimal.js";
import type { Processor, ProcessorReserve } from "@/db/schema";
import { addMonths, monthKeyOf } from "@/lib/dates";
import { pctOf, toMinor, type Minor } from "@/lib/money";

export interface SaleFeeInput {
  grossUsdCents: Minor;
  internationalCard: boolean;
  currencyConversion: boolean;
  applyPlatformFee: boolean;
  reservePct?: string; // optional override; "" or undefined -> processor default
  /** Explicit overrides when the statement shows the exact fees. */
  overrides?: Partial<{ processingFee: Minor; conversionFee: Minor; platformFee: Minor; reserveHold: Minor }>;
}

export interface SaleFeeBreakdown {
  gross: Minor;
  processingFee: Minor; // card % + fixed (+ international surcharge)
  intlSurchargePortion: Minor;
  conversionFee: Minor;
  platformFee: Minor;
  totalFees: Minor;
  net: Minor; // gross − fees (lands in processor available balance before any reserve)
  reserveHold: Minor; // moved to restricted balance
  availableAfterReserve: Minor;
  effectiveFeePct: string | null;
}

/** Compute fee lines for one sale. Every component is configurable and individually overridable; nothing is assumed uniform. */
export function computeSaleFees(p: Processor, input: SaleFeeInput): SaleFeeBreakdown {
  const gross = input.grossUsdCents;
  const o = input.overrides ?? {};
  const basePct = new Decimal(p.domesticCardPct);
  const intlPortion = input.internationalCard ? pctOf(gross, p.intlCardSurchargePct) : 0;
  const processingFee = o.processingFee ?? (gross > 0 ? pctOf(gross, basePct) + p.domesticCardFixedCents + intlPortion : 0);
  const conversionFee = o.conversionFee ?? (input.currencyConversion ? pctOf(gross, p.conversionPct) : 0);
  const platformFee = o.platformFee ?? (input.applyPlatformFee ? pctOf(gross, p.platformFeePct) : 0);
  const totalFees = processingFee + conversionFee + platformFee;
  const net = gross - totalFees;
  const reservePct = input.reservePct && input.reservePct !== "" ? input.reservePct : p.defaultReservePct;
  const reserveHold = o.reserveHold ?? (new Decimal(reservePct || 0).gt(0) ? pctOf(net, reservePct) : 0);
  return {
    gross,
    processingFee,
    intlSurchargePortion: o.processingFee != null ? 0 : intlPortion,
    conversionFee,
    platformFee,
    totalFees,
    net,
    reserveHold,
    availableAfterReserve: net - reserveHold,
    effectiveFeePct: gross > 0 ? new Decimal(totalFees).div(gross).mul(100).toDecimalPlaces(2).toString() : null,
  };
}

export type PayoutMethod = "ach" | "wire" | "international" | "instant" | "none";

export function computePayoutFee(p: Processor, amountUsdCents: Minor, method: PayoutMethod): Minor {
  switch (method) {
    case "ach":
      return p.achPayoutFeeCents;
    case "wire":
      return p.wirePayoutFeeCents;
    case "international":
      return p.intlTransferFeeCents + pctOf(amountUsdCents, p.intlTransferPct);
    case "instant":
      return pctOf(amountUsdCents, p.instantPayoutPct) + p.instantPayoutFixedCents;
    default:
      return 0;
  }
}

/** Reserve releases expected per month, for the cash-flow projection. */
export function reserveReleaseSchedule(reserves: ProcessorReserve[], fromMonth: string, months: number): { month: string; amount: Minor; unknownDate: Minor }[] {
  const out: { month: string; amount: Minor; unknownDate: Minor }[] = [];
  const held = reserves.filter((r) => r.status === "held");
  const unknown = held.filter((r) => !r.expectedReleaseDate).reduce((a, r) => a + r.amountUsdCents, 0);
  for (let i = 0; i < months; i++) {
    const m = addMonths(fromMonth, i);
    const amount = held.filter((r) => r.expectedReleaseDate && monthKeyOf(r.expectedReleaseDate) === m).reduce((a, r) => a + r.amountUsdCents, 0);
    out.push({ month: m, amount, unknownDate: i === 0 ? unknown : 0 });
  }
  // Releases already overdue (expected date before fromMonth) are shown in the first month.
  const overdue = held.filter((r) => r.expectedReleaseDate && monthKeyOf(r.expectedReleaseDate) < fromMonth).reduce((a, r) => a + r.amountUsdCents, 0);
  if (out[0]) out[0].amount += overdue;
  return out;
}

export function heldReservesTotal(reserves: ProcessorReserve[], processorId?: string): Minor {
  return reserves.filter((r) => r.status === "held" && (!processorId || r.processorId === processorId)).reduce((a, r) => a + r.amountUsdCents, 0);
}

export const toCents = toMinor;
