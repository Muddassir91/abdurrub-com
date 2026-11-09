import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { IDS, categoryId } from "@/db/seed";
import { updateSettings, upsertPolicy, upsertHouseholdLine, upsertRecurring, upsertAccount } from "@/db/repo";
import { todayKey, addMonths, currentMonthKey } from "@/lib/dates";
import { nowIso } from "@/lib/ids";
import { householdInBaseMinor, isPersonal, normaliseSplit, splitTotal, type OnboardingAnswers } from "./model";

/**
 * Write the questionnaire answers into a seeded (blank) workspace. Safe to run
 * again: recurring costs and household lines that have no transactions yet are
 * replaced by the new answers; everything else is updated in place.
 */
export function applyOnboarding(db: Db, raw: OnboardingAnswers): void {
  const a: OnboardingAnswers = { ...raw, split: normaliseSplit(raw.split), completedAt: raw.completedAt ?? nowIso() };
  if (splitTotal(a.split) !== 100) throw new Error("The split must add up to 100%");
  const today = todayKey();
  const sameCurrency = a.baseCurrency === a.householdCurrency;
  const fxRate = sameCurrency ? "1" : Number(a.fxRate) > 0 ? a.fxRate : "1";
  const personal = isPersonal(a);
  const businessName = a.businessName.trim() || (personal ? `${a.name.trim() || "My"} money` : "My business");

  updateSettings(db, {
    businessName,
    ownerName: a.name.trim() || "Owner",
    baseCurrency: a.baseCurrency,
    householdCurrency: a.householdCurrency,
    defaultFxRatePkrPerUsd: fxRate,
    householdBudgetUsdCents: householdInBaseMinor({ ...a, fxRate }),
    discretionaryGoalUsdCents: 0,
    reserveTargetMonths: String(a.reserveMonths),
    reserveMinMonths: String(Math.min(a.reserveMonths, 3)),
    reserveMaxMonths: String(Math.max(a.reserveMonths, 6)),
    onboardingJson: JSON.stringify(a),
  });

  // The split: one policy, applied to everything that comes in.
  const policies = db.select().from(s.allocationPolicies).all();
  const target = policies.find((p) => p.isDefault) ?? policies[0];
  upsertPolicy(db, {
    id: target?.id ?? IDS.policyLean,
    name: "Your split",
    description: "Set during setup. Every unit of income is divided by these shares; change them any time in Settings.",
    appliesFromMonthlyRevenueUsdCents: 0,
    opexPct: String(a.split.opex),
    ownerPct: String(a.split.owner),
    taxPct: String(a.split.tax),
    profitPct: String(a.split.profit),
    reservePct: String(a.split.reserve),
    growthPct: String(a.split.growth),
    isDefault: true,
  });

  // Opening balances. Business accounts hold the base currency; the personal account holds the household currency.
  const setOpening = (id: string, amount: number, currency: string) => {
    const acc = db.select().from(s.accounts).where(eq(s.accounts.id, id)).get();
    if (!acc) return;
    upsertAccount(db, { ...acc, openingBalanceMinor: amount, openingBalanceDate: today, currency });
  };
  setOpening(IDS.acctOperating, a.businessCashMinor, a.baseCurrency);
  setOpening(IDS.acctTax, a.taxSavedMinor, a.baseCurrency);
  setOpening(IDS.acctSavings, a.reserveSavedMinor, a.baseCurrency);
  setOpening(IDS.acctProfit, 0, a.baseCurrency);
  setOpening(IDS.acctGrowth, 0, a.baseCurrency);
  setOpening(IDS.acctPersonal, a.personalCashMinor, a.householdCurrency);
  for (const acc of db.select().from(s.accounts).all()) {
    if (acc.kind === "processor") db.update(s.accounts).set({ currency: a.baseCurrency }).where(eq(s.accounts.id, acc.id)).run();
  }

  // Payment processor name from how they get paid.
  const processorName = a.paymentMethods.find((m) => !["Bank transfer", "Cash", "Other"].includes(m)) ?? "Payment processor";
  const proc = db.select().from(s.processors).all()[0];
  if (proc) {
    db.update(s.processors).set({ name: processorName }).where(eq(s.processors.id, proc.id)).run();
    db.update(s.accounts).set({ name: `${processorName} available balance` }).where(eq(s.accounts.id, IDS.acctWhopAvailable)).run();
    db.update(s.accounts).set({ name: `${processorName} restricted balance` }).where(eq(s.accounts.id, IDS.acctWhopRestricted)).run();
  }

  // Recurring business costs: replace the ones that never produced a transaction.
  const used = new Set(db.select().from(s.transactions).all().map((t) => t.recurringExpenseId).filter(Boolean));
  for (const r of db.select().from(s.recurringExpenses).all()) {
    if (!used.has(r.id)) db.delete(s.recurringExpenses).where(eq(s.recurringExpenses.id, r.id)).run();
  }
  const catIds = new Set(db.select().from(s.categories).all().map((c) => c.id));
  const bizCat = (name: string | undefined, fallback: string) => {
    const id = categoryId("business", name ?? fallback);
    return catIds.has(id) ? id : categoryId("business", fallback);
  };
  const renewal = `${addMonths(currentMonthKey(), 1)}-${today.slice(8, 10)}`;
  let order = 0;
  for (const x of a.subscriptions) {
    if (!x.name.trim() || x.amountMinor <= 0) continue;
    upsertRecurring(db, { name: x.name.trim(), amountMinor: x.amountMinor, currency: a.baseCurrency, frequency: "monthly", categoryId: bizCat(x.category, "Software and AI"), costType: "overhead", bucket: "opex", accountId: IDS.acctOperating, startDate: today, nextRenewalDate: renewal, status: "active", isEssential: true, justification: "Entered during setup.", notes: null });
    order++;
  }
  for (const x of a.otherCosts) {
    if (!x.name.trim() || x.amountMinor <= 0) continue;
    const contractors = /contract|freelanc|team|staff|assistant|va\b/i.test(x.name);
    upsertRecurring(db, { name: x.name.trim(), amountMinor: x.amountMinor, currency: a.baseCurrency, frequency: x.frequency ?? "monthly", categoryId: bizCat(contractors ? "Contractors" : "Operations", "Operations"), costType: "overhead", bucket: "opex", accountId: IDS.acctOperating, startDate: today, nextRenewalDate: renewal, status: "active", isEssential: true, justification: "Entered during setup.", notes: null });
    order++;
  }
  void order;

  // Household essentials, in the household currency.
  for (const l of db.select().from(s.householdBudgetLines).all()) db.delete(s.householdBudgetLines).where(eq(s.householdBudgetLines.id, l.id)).run();
  a.household.forEach((h, i) => {
    if (h.amountMinor <= 0) return;
    const id = categoryId("personal", h.category ?? "Other");
    upsertHouseholdLine(db, { name: h.name, categoryId: catIds.has(id) ? id : categoryId("personal", "Other"), amountMinor: h.amountMinor, currency: a.householdCurrency, isActive: true, sortOrder: i + 1, notes: null });
  });

  // Where the business lives, and the share they told us goes to tax (an estimate, theirs).
  const country = a.country.trim();
  if (country) {
    for (const e of db.select().from(s.entities).all()) db.update(s.entities).set({ name: businessName, jurisdiction: country }).where(eq(s.entities.id, e.id)).run();
    for (const t of db.select().from(s.taxProfiles).all()) db.update(s.taxProfiles).set({ jurisdiction: country, assumedRatePct: String(a.taxPct), isEstimate: true }).where(eq(s.taxProfiles.id, t.id)).run();
    for (const c of db.select().from(s.complianceItems).all()) if (c.jurisdiction === "To be set") db.update(s.complianceItems).set({ jurisdiction: country }).where(eq(s.complianceItems.id, c.id)).run();
  } else {
    for (const t of db.select().from(s.taxProfiles).all()) db.update(s.taxProfiles).set({ assumedRatePct: String(a.taxPct) }).where(eq(s.taxProfiles.id, t.id)).run();
  }
}
