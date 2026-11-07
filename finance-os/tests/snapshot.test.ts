import { describe, expect, it } from "vitest";
import { buildSnapshot } from "@/engine/snapshot";
import { buildAlerts } from "@/engine/alerts";
import { computeSaleFees, computePayoutFee } from "@/engine/processor";
import { evaluateInvestment } from "@/engine/investment";
import { simulate } from "@/engine/scenarios";
import { commissionFor } from "@/engine/clients";
import { accountBalance } from "@/engine/ledger";
import { buildMonthReport } from "@/engine/monthClose";
import { buildForecast } from "@/engine/forecast";
import { IDS, categoryId } from "@/db/seed";
import { data, payment, tx, MONTH, TODAY, processor, baseSettings, leanPolicy } from "./fixtures";

describe("revenue and allocation base", () => {
  it("allocates only collected revenue, never earned or invoiced", () => {
    const d = data({
      revenuePeriods: [{ id: "p1", clientId: IDS.clientOne, month: MONTH, clientAttributableRevenueUsdCents: 2000000, revenueSharePct: "20", commissionUsdCents: 400000, retainerUsdCents: 0, fixedFeesUsdCents: 0, notes: null, createdAt: "", updatedAt: "" }],
      invoices: [{ id: "i1", clientId: IDS.clientOne, number: "001", periodMonth: MONTH, issueDate: `${MONTH}-01`, dueDate: `${MONTH}-08`, expectedPaymentDate: null, amountUsdCents: 400000, status: "sent", notes: null, createdAt: "" }],
      transactions: [payment(250000, { invoiceId: "i1" })],
    });
    const s = buildSnapshot(d, MONTH, TODAY);
    expect(s.revenue.grossEarned).toBe(400000);
    expect(s.revenue.invoiced).toBe(400000);
    expect(s.revenue.collected).toBe(250000);
    expect(s.revenue.outstandingReceivables).toBe(150000);
    expect(s.revenue.overdueReceivables).toBe(150000);
    expect(s.revenue.allocatable).toBe(250000);
    expect(s.allocations.owner).toBe(87500);
    expect(Object.values(s.allocations).reduce((a, b) => a + b, 0)).toBe(250000);
    const alerts = buildAlerts(d, s, TODAY);
    expect(alerts.some((a) => a.key === "invoices-overdue")).toBe(true);
  });

  it("subtracts refunds, chargebacks and each fee exactly once", () => {
    const d = data({
      transactions: [
        payment(400000, { accountId: IDS.acctWhopAvailable }),
        tx({ type: "processing_fee", amountUsdCents: 11130, accountId: IDS.acctWhopAvailable }),
        tx({ type: "conversion_fee", amountUsdCents: 4000, accountId: IDS.acctWhopAvailable }),
        tx({ type: "platform_fee", amountUsdCents: 12000, accountId: IDS.acctWhopAvailable }),
        tx({ type: "refund", amountUsdCents: 20000, accountId: IDS.acctWhopAvailable }),
        tx({ type: "chargeback", amountUsdCents: 10000, accountId: IDS.acctWhopAvailable }),
        tx({ type: "payout", amountUsdCents: 300000, accountId: IDS.acctWhopAvailable, toAccountId: IDS.acctOperating }),
        tx({ type: "payout_fee", amountUsdCents: 250, accountId: IDS.acctWhopAvailable }),
      ],
    });
    const s = buildSnapshot(d, MONTH, TODAY);
    expect(s.revenue.collected).toBe(400000);
    expect(s.revenue.totalFees).toBe(11130 + 4000 + 12000 + 250);
    expect(s.revenue.netDistributable).toBe(400000 - 20000 - 10000 - 27380);
    expect(s.revenue.allocatable).toBe(s.revenue.netDistributable);
    // Payout is a transfer: it is neither revenue nor expense.
    expect(s.expenses.overheadActual).toBe(0);
    expect(s.cash.bankBusinessCash).toBe(300000);
    expect(s.cash.processorAvailable).toBe(400000 - 27380 - 30000 - 300000);
  });

  it("excludes processor reserves from the allocation base until released", () => {
    const d = data({
      transactions: [
        payment(400000, { accountId: IDS.acctWhopAvailable }),
        tx({ type: "reserve_hold", amountUsdCents: 40000, accountId: IDS.acctWhopAvailable, toAccountId: IDS.acctWhopRestricted }),
      ],
      reserves: [{ id: "r1", processorId: IDS.processorWhop, amountUsdCents: 40000, dateWithheld: `${MONTH}-10`, expectedReleaseDate: "2027-02-10", releasedDate: null, status: "held", reason: "Rolling reserve", holdTransactionId: null, releaseTransactionId: null, notes: null, createdAt: "" }],
    });
    const s = buildSnapshot(d, MONTH, TODAY);
    expect(s.revenue.netDistributable).toBe(400000);
    expect(s.revenue.allocatable).toBe(360000);
    expect(s.cash.processorRestricted).toBe(40000);
    expect(s.cash.processorAvailable).toBe(360000);
    expect(s.cash.bankBusinessCash).toBe(0);
    const alerts = buildAlerts(d, s, TODAY);
    expect(alerts.some((a) => a.key === "processor-reserve")).toBe(true);
    // Release in a later month makes it allocatable then.
    const d2 = data({ ...d, transactions: [...d.transactions, tx({ type: "reserve_release", amountUsdCents: 40000, date: "2027-02-10", accountId: IDS.acctWhopRestricted, toAccountId: IDS.acctWhopAvailable })] });
    const s2 = buildSnapshot(d2, "2027-02", "2027-02-20");
    expect(s2.revenue.allocatable).toBe(40000);
    const forecast = buildForecast(d, s, 4, TODAY);
    expect(forecast.find((f) => f.month === "2027-02")?.expectedReserveReleases).toBe(40000);
  });

  it("zero revenue month with spending yields zero targets and negative result", () => {
    const d = data({
      transactions: [
        tx({ type: "expense", amountUsdCents: 60000, accountId: IDS.acctOperating, costType: "overhead", isEssential: true }),
        tx({ type: "owner_draw", amountUsdCents: 50000, accountId: IDS.acctOperating, toAccountId: IDS.acctPersonal }),
      ],
    });
    const s = buildSnapshot(d, MONTH, TODAY);
    expect(s.revenue.collected).toBe(0);
    expect(s.allocations.owner).toBe(0);
    expect(s.expenses.ceiling).toBe(0);
    expect(s.expenses.netResultAfterOwnerPay).toBe(-110000);
    expect(s.cash.bankBusinessCash).toBe(-110000);
    const alerts = buildAlerts(d, s, TODAY);
    expect(alerts.some((a) => a.key === "no-revenue")).toBe(true);
    expect(alerts.some((a) => a.key === "opex-over-ceiling")).toBe(false); // ceiling 0 -> no ratio noise
  });
});

describe("expenses, PKR and owner compensation", () => {
  it("converts PKR household spend with the transaction rate and never double counts draws", () => {
    const d = data({
      transactions: [
        payment(400000),
        tx({ type: "owner_draw", amountUsdCents: 140000, accountId: IDS.acctOperating, toAccountId: IDS.acctPersonal }),
        tx({ type: "household_expense", amountMinor: 5000000, currency: "PKR", fxRatePerUsd: "280", accountId: IDS.acctPersonal, categoryId: categoryId("personal", "Food") }),
        tx({ type: "household_expense", amountMinor: 3000000, currency: "PKR", fxRatePerUsd: "275", accountId: IDS.acctPersonal }),
        tx({ type: "personal_expense", amountUsdCents: 10000, accountId: IDS.acctPersonal }),
      ],
    });
    const s = buildSnapshot(d, MONTH, TODAY);
    expect(s.owner.target).toBe(140000);
    expect(s.owner.drawn).toBe(140000);
    expect(s.owner.householdActual).toBe(17857 + 10909); // 50,000/280 + 30,000/275
    expect(s.owner.discretionaryActual).toBe(10000);
    expect(s.owner.discretionaryAvailable).toBe(140000 - 28766);
    expect(s.owner.personalSavings).toBe(140000 - 28766 - 10000);
    // Personal spend never hits business opex.
    expect(s.expenses.overheadActual).toBe(0);
    expect(s.actualByBucket.owner).toBe(140000);
    // Personal account balance = draw − spend (in USD).
    const personal = d.accounts.find((a) => a.id === IDS.acctPersonal)!;
    expect(accountBalance(personal, d.transactions, d.settings)).toBe(140000 - 28766 - 10000);
  });

  it("tracks operating ceiling, remaining allowance and ratio; unspent allowance stays in business cash", () => {
    const d = data({
      transactions: [
        payment(400000),
        tx({ type: "expense", amountUsdCents: 60000, accountId: IDS.acctOperating, costType: "overhead", isRecurring: true, categoryId: categoryId("business", "Software and AI") }),
        tx({ type: "expense", amountUsdCents: 23100, accountId: IDS.acctOperating, costType: "overhead", isRecurring: true }),
        tx({ type: "contractor_payment", amountUsdCents: 50000, accountId: IDS.acctOperating, costType: "direct_delivery", clientId: IDS.clientOne }),
        tx({ type: "growth_investment", amountUsdCents: 10000, accountId: IDS.acctOperating }),
      ],
    });
    const s = buildSnapshot(d, MONTH, TODAY);
    expect(s.expenses.ceiling).toBe(100000);
    expect(s.expenses.overheadActual).toBe(83100);
    expect(s.expenses.remainingAllowance).toBe(16900);
    expect(s.expenses.unspentAllowance).toBe(16900);
    expect(s.expenses.opexRatioPct).toBe("20.78");
    expect(s.expenses.directDeliveryActual).toBe(50000);
    expect(s.expenses.growthActual).toBe(10000);
    expect(s.expenses.grossProfit).toBe(350000);
    expect(s.expenses.grossMarginPct).toBe("87.5");
    expect(s.actualByBucket.growth).toBe(10000);
    expect(s.actualByBucket.opex).toBe(83100);
    // Unspent allowance is not income and not personal: bank cash keeps it.
    expect(s.cash.bankBusinessCash).toBe(400000 - 83100 - 50000 - 10000);
    expect(s.clients[0].directCosts).toBe(50000);
  });

  it("honours an approved higher operating ceiling", () => {
    const d = data({ settings: baseSettings({ opexCeilingOverrideUsdCents: 150000, opexCeilingOverrideNote: "Hired VA" }), transactions: [payment(400000), tx({ type: "expense", amountUsdCents: 120000, accountId: IDS.acctOperating })] });
    const s = buildSnapshot(d, MONTH, TODAY);
    expect(s.expenses.ceiling).toBe(150000);
    expect(s.expenses.ceilingSource).toBe("override");
    expect(buildAlerts(d, s, TODAY).some((a) => a.key === "opex-over-ceiling")).toBe(false);
  });

  it("flags overhead above the ceiling", () => {
    const d = data({ transactions: [payment(400000), tx({ type: "expense", amountUsdCents: 125000, accountId: IDS.acctOperating })] });
    const s = buildSnapshot(d, MONTH, TODAY);
    const a = buildAlerts(d, s, TODAY).find((x) => x.key === "opex-over-ceiling");
    expect(a?.level).toBe("critical");
  });
});

describe("clients", () => {
  it("only the commission is agency revenue", () => {
    expect(commissionFor(2000000, "20")).toBe(400000);
    expect(commissionFor(1234567, "20")).toBe(246913);
    expect(commissionFor(2000000, null)).toBe(0);
  });
  it("concentration warnings at 50% and 75%", () => {
    const two = data({
      clients: [data().clients[0], { ...data().clients[0], id: "c2", name: "Client 2" }],
      revenuePeriods: [
        { id: "p1", clientId: IDS.clientOne, month: MONTH, clientAttributableRevenueUsdCents: 0, revenueSharePct: null, commissionUsdCents: 0, retainerUsdCents: 300000, fixedFeesUsdCents: 0, notes: null, createdAt: "", updatedAt: "" },
        { id: "p2", clientId: "c2", month: MONTH, clientAttributableRevenueUsdCents: 0, revenueSharePct: null, commissionUsdCents: 0, retainerUsdCents: 100000, fixedFeesUsdCents: 0, notes: null, createdAt: "", updatedAt: "" },
      ],
    });
    const s = buildSnapshot(two, MONTH, TODAY);
    expect(s.concentration.largestSharePct).toBe("75");
    expect(buildAlerts(two, s, TODAY).find((a) => a.key.startsWith("concentration"))?.level).toBe("critical");
    two.revenuePeriods[1].retainerUsdCents = 200000;
    const s2 = buildSnapshot(two, MONTH, TODAY);
    expect(s2.concentration.largestSharePct).toBe("60");
    expect(buildAlerts(two, s2, TODAY).find((a) => a.key.startsWith("concentration"))?.level).toBe("caution");
  });
});

describe("Whop fees", () => {
  it("computes per-sale fees from configurable defaults", () => {
    const p = processor();
    const domestic = computeSaleFees(p, { grossUsdCents: 100000, internationalCard: false, currencyConversion: false, applyPlatformFee: true });
    expect(domestic.processingFee).toBe(2730);
    expect(domestic.platformFee).toBe(3000);
    expect(domestic.conversionFee).toBe(0);
    expect(domestic.net).toBe(94270);
    const intl = computeSaleFees(p, { grossUsdCents: 100000, internationalCard: true, currencyConversion: true, applyPlatformFee: false, reservePct: "10" });
    expect(intl.processingFee).toBe(2730 + 1500);
    expect(intl.conversionFee).toBe(1000);
    expect(intl.platformFee).toBe(0);
    expect(intl.net).toBe(94770);
    expect(intl.reserveHold).toBe(9477);
    expect(intl.availableAfterReserve).toBe(94770 - 9477);
    const override = computeSaleFees(p, { grossUsdCents: 100000, internationalCard: false, currencyConversion: false, applyPlatformFee: true, overrides: { processingFee: 2500 } });
    expect(override.processingFee).toBe(2500);
  });
  it("payout fees depend on method", () => {
    const p = processor();
    expect(computePayoutFee(p, 100000, "ach")).toBe(250);
    expect(computePayoutFee(p, 100000, "wire")).toBe(2500);
    expect(computePayoutFee(p, 100000, "international")).toBe(3500);
    expect(computePayoutFee(p, 100000, "instant")).toBe(4100);
  });
});

describe("growth and hiring decisions", () => {
  const base = data({ transactions: [payment(400000), tx({ type: "expense", amountUsdCents: 83100, accountId: IDS.acctOperating, isEssential: true })] });
  const snap = buildSnapshot(base, MONTH, TODAY);

  it("evaluates a new subscription against ceiling and ratio", () => {
    const ok = evaluateInvestment(snap, base.settings, { type: "subscription", monthlyCost: 10000, oneTimeCost: 0, expectedAdditionalRevenue: 50000, deliveryCapacity: 0, costType: "overhead", bucket: "opex" });
    expect(ok.fitsInRemainingAllowance).toBe(true);
    expect(ok.newOpexRatioPct).toBe("23.3");
    expect(ok.verdict).toBe("affordable");
    const bad = evaluateInvestment(snap, base.settings, { type: "subscription", monthlyCost: 50000, oneTimeCost: 0, expectedAdditionalRevenue: 0, deliveryCapacity: 0, costType: "overhead", bucket: "opex" });
    expect(bad.fitsInRemainingAllowance).toBe(false);
    expect(bad.revenueNeededToFundInsideCeiling).toBe(200000);
    expect(bad.verdict).toBe("not_recommended");
  });

  it("does not approve a hire just because growth money exists", () => {
    const hire = evaluateInvestment(snap, base.settings, { type: "hire", monthlyCost: 100000, oneTimeCost: 0, expectedAdditionalRevenue: 0, deliveryCapacity: 0, costType: "direct_delivery", bucket: "opex" });
    expect(hire.verdict).toBe("not_recommended");
    expect(hire.reserveOk).toBe(false);
    const withReserve = data({ ...base, allocationEntries: [{ id: "a1", month: "2026-10", bucket: "reserve", amountUsdCents: 200000, source: "month_close", note: null, createdAt: "" }] });
    const snap2 = buildSnapshot(withReserve, MONTH, TODAY);
    expect(snap2.reserve.coverageMonths).toBe("2.4");
    const good = evaluateInvestment(snap2, base.settings, { type: "hire", monthlyCost: 100000, oneTimeCost: 50000, expectedAdditionalRevenue: 300000, deliveryCapacity: 300000, costType: "direct_delivery", bucket: "opex" });
    expect(good.reserveOk).toBe(true);
    expect(good.projectedGrossMarginPct).toBe("85.7");
    expect(good.breakEvenMonths).toBe(1);
    expect(good.verdict).toBe("affordable");
  });
});

describe("scenario simulator", () => {
  it("applies the same rules and never scales personal spending", () => {
    const pcts = { opex: "25", owner: "35", tax: "15", profit: "10", reserve: "10", growth: "5" };
    const r = simulate({ revenue: 1000000, pcts, settings: baseSettings(), expectedOpexActual: 83100 });
    expect(r.allocations.owner).toBe(350000);
    expect(r.householdBudget).toBe(100000);
    expect(r.discretionaryIncome).toBe(250000);
    expect(r.unspentOpexAllowance).toBe(250000 - 83100);
    expect(r.monthlyBusinessCashAccumulation).toBe(100000 + 100000 + 166900);
    const big = simulate({ revenue: 40000000, pcts, settings: baseSettings(), expectedOpexActual: 83100 });
    expect(big.discretionaryGoalMet).toBe(true);
    expect(big.householdBudget).toBe(100000);
  });
});

describe("reserves and month close", () => {
  it("computes reserve coverage, target and projected date", () => {
    const d = data({
      transactions: [payment(400000), tx({ type: "expense", amountUsdCents: 83100, accountId: IDS.acctOperating, isEssential: true })],
      allocationEntries: [{ id: "a1", month: "2026-10", bucket: "reserve", amountUsdCents: 40000, source: "month_close", note: null, createdAt: "" }],
    });
    const s = buildSnapshot(d, MONTH, TODAY);
    expect(s.reserve.essentialMonthly).toBe(83100);
    expect(s.reserve.target).toBe(249300);
    expect(s.reserve.balance).toBe(40000);
    expect(s.reserve.coverageMonths).toBe("0.5");
    expect(s.reserve.monthsToTarget).toBe(6);
    expect(s.reserve.projectedTargetDate).toBe("2027-05-01");
    expect(buildAlerts(d, s, TODAY).find((a) => a.key === "reserve-low")?.level).toBe("critical");
  });

  it("builds a month report with variances and recommendations", () => {
    const d = data({ transactions: [payment(400000), tx({ type: "expense", amountUsdCents: 83100, accountId: IDS.acctOperating }), tx({ type: "owner_draw", amountUsdCents: 100000, accountId: IDS.acctOperating, toAccountId: IDS.acctPersonal })] });
    const r = buildMonthReport(d, MONTH, TODAY, { amount: 16900, to: "reserve" });
    expect(r.variances.find((v) => v.bucket === "opex")?.variance).toBe(16900);
    expect(r.variances.find((v) => v.bucket === "owner")?.variance).toBe(40000);
    expect(r.expenses.netResultAfterOwnerPay).toBe(400000 - 83100 - 100000);
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.unspentOpexDisposition?.to).toBe("reserve");
  });

  it("uses a scale-stage policy when revenue crosses the threshold", () => {
    const d = data({ policies: [leanPolicy(), leanPolicy({ id: "scale", isDefault: false, appliesFromMonthlyRevenueUsdCents: 5000000, opexPct: "40", ownerPct: "20" })], transactions: [payment(6000000)] });
    const s = buildSnapshot(d, MONTH, TODAY);
    expect(s.policy.id).toBe("scale");
    expect(s.allocations.opex).toBe(2400000);
  });
});
