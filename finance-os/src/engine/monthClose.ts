import { BUCKETS, BUCKET_LABELS, type Bucket } from "@/lib/constants";
import { formatMoney, type Minor } from "@/lib/money";
import { addMonths } from "@/lib/dates";
import { buildAlerts } from "./alerts";
import { buildSnapshot } from "./snapshot";
import type { Alert, EngineData, MonthSnapshot } from "./types";

export interface BudgetVariance {
  bucket: Bucket;
  label: string;
  target: Minor;
  actual: Minor;
  variance: Minor; // target − actual (positive = under budget)
}

export interface MonthReport {
  month: string;
  generatedAt: string;
  revenue: MonthSnapshot["revenue"];
  expenses: Pick<MonthSnapshot["expenses"], "ceiling" | "overheadActual" | "directDeliveryActual" | "growthActual" | "grossProfit" | "grossMarginPct" | "operatingResult" | "operatingMarginPct" | "netResultAfterOwnerPay" | "netMarginPct" | "opexRatioPct" | "unspentAllowance">;
  allocations: MonthSnapshot["allocations"];
  owner: Pick<MonthSnapshot["owner"], "target" | "drawn" | "householdActual" | "discretionaryActual" | "personalSavings">;
  tax: MonthSnapshot["tax"];
  reserve: MonthSnapshot["reserve"];
  profit: MonthSnapshot["profit"];
  clients: MonthSnapshot["clients"];
  concentration: MonthSnapshot["concentration"];
  cash: MonthSnapshot["cash"];
  variances: BudgetVariance[];
  warnings: Alert[];
  recommendations: string[];
  unspentOpexDisposition: { amount: Minor; to: "operating" | "reserve" | "profit" } | null;
  previousMonth: { netDistributable: Minor; overheadActual: Minor; netResultAfterOwnerPay: Minor } | null;
}

export const CLOSE_STEPS = [
  { key: "revenue", title: "Reconcile collected revenue", hint: "Compare collected client payments with your bank and processor statements." },
  { key: "fees", title: "Reconcile processor fees", hint: "Every processing, conversion, platform and payout fee has its own ledger row; totals should match the processor statement." },
  { key: "reversals", title: "Reconcile refunds and chargebacks", hint: "Record every refund and chargeback as its own row; they reduce net distributable revenue." },
  { key: "opex", title: "Reconcile operating expenses", hint: "Confirm every subscription that renewed this month is in the ledger and marked recurring." },
  { key: "owner", title: "Reconcile owner compensation", hint: "Owner draws are transfers to the personal account, never an expense." },
  { key: "profit", title: "Calculate actual business profit", hint: "Net result after owner pay is accounting profit. It is not the bank balance." },
  { key: "reserves", title: "Update business reserves", hint: "Booking the close credits the reserve envelope; move real cash to match." },
  { key: "tax", title: "Calculate tax reserve", hint: "The tax allocation is an estimate pending professional confirmation." },
  { key: "clients", title: "Review client profitability", hint: "Check each client's revenue against the direct costs attached to it." },
  { key: "report", title: "Generate the monthly report", hint: "Closing books the allocations to the virtual envelopes and locks the month." },
] as const;

export function buildMonthReport(data: EngineData, month: string, today: string, unspentDisposition: MonthReport["unspentOpexDisposition"]): MonthReport {
  const snap = buildSnapshot(data, month, today);
  const prevSnap = buildSnapshot(data, addMonths(month, -1), today);
  const variances: BudgetVariance[] = BUCKETS.map((b) => ({
    bucket: b,
    label: BUCKET_LABELS[b],
    target: b === "opex" ? snap.expenses.ceiling : snap.allocations[b],
    actual: snap.actualByBucket[b],
    variance: (b === "opex" ? snap.expenses.ceiling : snap.allocations[b]) - snap.actualByBucket[b],
  }));
  const warnings = buildAlerts(data, snap, today).filter((a) => a.level !== "info");
  const recommendations = buildRecommendations(snap, prevSnap);
  const hasPrev = prevSnap.revenue.collected > 0 || prevSnap.expenses.overheadActual > 0;
  return {
    month,
    generatedAt: new Date().toISOString(),
    revenue: snap.revenue,
    expenses: {
      ceiling: snap.expenses.ceiling,
      overheadActual: snap.expenses.overheadActual,
      directDeliveryActual: snap.expenses.directDeliveryActual,
      growthActual: snap.expenses.growthActual,
      grossProfit: snap.expenses.grossProfit,
      grossMarginPct: snap.expenses.grossMarginPct,
      operatingResult: snap.expenses.operatingResult,
      operatingMarginPct: snap.expenses.operatingMarginPct,
      netResultAfterOwnerPay: snap.expenses.netResultAfterOwnerPay,
      netMarginPct: snap.expenses.netMarginPct,
      opexRatioPct: snap.expenses.opexRatioPct,
      unspentAllowance: snap.expenses.unspentAllowance,
    },
    allocations: snap.allocations,
    owner: { target: snap.owner.target, drawn: snap.owner.drawn, householdActual: snap.owner.householdActual, discretionaryActual: snap.owner.discretionaryActual, personalSavings: snap.owner.personalSavings },
    tax: snap.tax,
    reserve: snap.reserve,
    profit: snap.profit,
    clients: snap.clients,
    concentration: snap.concentration,
    cash: snap.cash,
    variances,
    warnings,
    recommendations,
    unspentOpexDisposition: unspentDisposition,
    previousMonth: hasPrev ? { netDistributable: prevSnap.revenue.netDistributable, overheadActual: prevSnap.expenses.overheadActual, netResultAfterOwnerPay: prevSnap.expenses.netResultAfterOwnerPay } : null,
  };
}

function buildRecommendations(snap: MonthSnapshot, prev: MonthSnapshot): string[] {
  const out: string[] = [];
  const usd = (c: Minor) => formatMoney(c, "USD");
  const ex = snap.expenses;
  if (ex.unspentAllowance > 0 && ex.ceiling > 0) out.push(`${usd(ex.unspentAllowance)} of operating allowance went unspent. Keep it in business cash or move it to reserves; do not treat it as income.`);
  if (ex.overheadActual > ex.ceiling && ex.ceiling > 0) out.push(`Overhead exceeded the ceiling by ${usd(ex.overheadActual - ex.ceiling)}. Cut or defer tools next month to get back under ${snap.policy.opexPct}%.`);
  if (snap.reserve.essentialMonthly > 0 && Number(snap.reserve.coverageMonths ?? 0) < Number(snap.reserve.targetMonths)) {
    out.push(`Reserves cover ${snap.reserve.coverageMonths ?? "0"} of a ${snap.reserve.targetMonths}-month target${snap.reserve.projectedTargetDate ? ` (on track for ${snap.reserve.projectedTargetDate.slice(0, 7)})` : ""}. Prioritise reserves before new fixed costs.`);
  }
  if (snap.concentration.largestSharePct && Number(snap.concentration.largestSharePct) >= 50) out.push(`${snap.concentration.largestClientName} is ${snap.concentration.largestSharePct}% of revenue. Keep outbound running until no client exceeds 50%.`);
  if (snap.revenue.outstandingReceivables > 0) out.push(`${usd(snap.revenue.outstandingReceivables)} is outstanding from clients. Follow up before month-end so it lands in next month's allocations.`);
  if (snap.cash.processorRestricted > 0) out.push(`${usd(snap.cash.processorRestricted)} is restricted at the processor. Record expected release dates so the forecast stays accurate.`);
  if (snap.owner.drawn < snap.owner.target && snap.owner.target > 0) out.push(`You drew ${usd(snap.owner.drawn)} of a ${usd(snap.owner.target)} compensation target. The remainder stays in business cash until you draw it; it is not profit.`);
  if (snap.tax.fundedBalance < snap.tax.envelopeBalance) out.push(`Transfer ${usd(snap.tax.envelopeBalance - snap.tax.fundedBalance)} to the tax account so the reserve is real cash, not a number on a page.`);
  if (prev.revenue.netDistributable > 0) {
    const delta = snap.revenue.netDistributable - prev.revenue.netDistributable;
    if (delta < 0) out.push(`Net revenue fell ${usd(-delta)} versus last month. Hold personal spending flat; allocations already scaled down automatically.`);
    else if (delta > 0) out.push(`Net revenue rose ${usd(delta)} versus last month. Keep household and discretionary budgets unchanged; let the increase build reserves and profit.`);
  }
  if (out.length === 0) out.push("All allocations are within targets. Keep running the same rules next month.");
  return out;
}
