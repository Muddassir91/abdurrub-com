import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { IDS, categoryId } from "@/db/seed";
import { updateSettings, upsertPolicy, upsertHouseholdLine, upsertRecurring, upsertAccount, recordBalanceAdjustment } from "@/db/repo";
import { accountBalance } from "@/engine/ledger";
import { householdLinesUsd } from "@/engine/owner";
import { currencyMeta, parseMajorToMinor, type CurrencyCode } from "@/lib/money";
import { todayKey, addMonths, currentMonthKey } from "@/lib/dates";
import { nowIso, uid } from "@/lib/ids";
import { householdInBaseMinor, isPersonal, normaliseSplit, parseAnswers, rebalanceSplit, splitTotal, GOALS, type Goal, type OnboardingAnswers, type SplitPct } from "./model";
import { answersFromData } from "./derive";
import { loadEngineData } from "@/db/repo";

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
  /** What the person answered last time, if this is a review of an earlier setup. */
  const previous = parseAnswers(db.select().from(s.settings).get()?.onboardingJson);

  updateSettings(db, {
    businessName,
    ownerName: a.name.trim() || "Owner",
    baseCurrency: a.baseCurrency,
    householdCurrency: a.householdCurrency,
    defaultFxRatePkrPerUsd: fxRate,
    householdBudgetUsdCents: householdInBaseMinor({ ...a, fxRate }),
    // The questionnaire asks for home-currency units per 1 base unit, which is exactly this setting.
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

  // Balances. Business accounts hold the base currency; the personal account holds the household currency.
  // An account with no entries yet gets the answer as its opening balance. An account that already has
  // entries is never reset: when the person changed the answer, today's balance is corrected to match it.
  const txs = db.select().from(s.transactions).all();
  const settingsNow = db.select().from(s.settings).get()!;
  const fxRows = db.select().from(s.fxRates).all();
  const setBalance = (id: string, amount: number, currency: string, previous: number | undefined) => {
    const acc = db.select().from(s.accounts).where(eq(s.accounts.id, id)).get();
    if (!acc) return;
    const used = txs.some((t) => t.accountId === id || t.toAccountId === id);
    if (!used) {
      upsertAccount(db, { ...acc, openingBalanceMinor: amount, openingBalanceDate: today, currency });
      return;
    }
    const changed = previous === undefined ? amount !== 0 : previous !== amount;
    if (!changed) return;
    const delta = amount - accountBalance(acc, txs, settingsNow);
    if (delta === 0) return;
    try {
      recordBalanceAdjustment(db, id, delta, today, "Balance corrected in setup", settingsNow, fxRows);
    } catch {
      /* the month is closed: leave the ledger alone */
    }
  };
  setBalance(IDS.acctOperating, a.businessCashMinor, a.baseCurrency, previous?.businessCashMinor);
  setBalance(IDS.acctTax, a.taxSavedMinor, a.baseCurrency, previous?.taxSavedMinor);
  setBalance(IDS.acctSavings, a.reserveSavedMinor, a.baseCurrency, previous?.reserveSavedMinor);
  setBalance(IDS.acctPersonal, a.personalCashMinor, a.householdCurrency, previous?.personalCashMinor);
  for (const acc of db.select().from(s.accounts).all()) {
    const used = txs.some((t) => t.accountId === acc.id || t.toAccountId === acc.id);
    if (!used && acc.isBusiness && acc.currency !== a.baseCurrency) db.update(s.accounts).set({ currency: a.baseCurrency }).where(eq(s.accounts.id, acc.id)).run();
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
  const kept = new Map(db.select().from(s.recurringExpenses).all().map((r) => [r.name.trim().toLowerCase(), r]));
  /** A cost that already exists (it has entries against it) is updated in place rather than added twice. */
  const updateKept = (name: string, amountMinor: number) => {
    const r = kept.get(name.trim().toLowerCase());
    if (!r) return false;
    db.update(s.recurringExpenses).set({ amountMinor, status: "active", cancelledAt: null, updatedAt: nowIso() }).where(eq(s.recurringExpenses.id, r.id)).run();
    return true;
  };
  for (const x of a.subscriptions) {
    if (!x.name.trim() || x.amountMinor <= 0) continue;
    if (updateKept(x.name, x.amountMinor)) continue;
    upsertRecurring(db, { name: x.name.trim(), amountMinor: x.amountMinor, currency: a.baseCurrency, frequency: "monthly", categoryId: bizCat(x.category, "Software and AI"), costType: "overhead", bucket: "opex", accountId: IDS.acctOperating, startDate: today, nextRenewalDate: renewal, status: "active", isEssential: true, justification: "Entered during setup.", notes: null });
    order++;
  }
  for (const x of a.otherCosts) {
    if (!x.name.trim() || x.amountMinor <= 0) continue;
    if (updateKept(x.name, x.amountMinor)) continue;
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

  // Where the person pays tax (home), where the business is registered (may differ), and the share they told us goes to tax.
  const country = a.country.trim();
  const abroad = a.registration === "abroad" && a.registrationCountry.trim().length > 0;
  const regCountry = abroad ? a.registrationCountry.trim() : country;
  const entityType = abroad ? (/united states|^usa?$|u\.s\./i.test(regCountry) ? "us_llc" : "other") : "other";
  const taxNote = abroad
    ? `Registered in ${regCountry}; tax is paid where the owner lives${country ? ` (${country})` : ""}. Filings in ${regCountry} may be information-only (nil) returns. Confirm both with a professional.`
    : "Rate entered during setup. Confirm with a professional.";
  for (const e of db.select().from(s.entities).all()) db.update(s.entities).set({ name: businessName, type: entityType, ...(regCountry ? { jurisdiction: regCountry } : {}) }).where(eq(s.entities.id, e.id)).run();
  for (const t of db.select().from(s.taxProfiles).all()) db.update(s.taxProfiles).set({ ...(country ? { jurisdiction: country } : {}), assumedRatePct: String(a.taxPct), isEstimate: true, notes: taxNote }).where(eq(s.taxProfiles.id, t.id)).run();
  if (country) for (const c of db.select().from(s.complianceItems).all()) if (c.jurisdiction === "To be set") db.update(s.complianceItems).set({ jurisdiction: country }).where(eq(s.complianceItems.id, c.id)).run();
  if (abroad) {
    const title = `Annual filing in ${regCountry}`;
    const exists = db.select().from(s.complianceItems).all().some((c) => c.title === title);
    if (!exists) db.insert(s.complianceItems).values({ id: uid(), title, jurisdiction: regCountry, description: `The business is registered in ${regCountry} but tax is paid at home. Most registries still expect an annual return or information filing even when nothing is owed. Add the due date once you know it.`, frequency: "annual", status: "pending", applicable: true, sortOrder: 50 }).run();
  }
}


/** A partial change to the setup, as the assistant or a settings form would make it. Amounts are in major units. */
export interface SetupPatch {
  name?: string;
  businessName?: string;
  monthlyIncome?: number;
  taxPct?: number;
  reserveMonths?: number;
  country?: string;
  registrationCountry?: string;
  fxRate?: number | string;
  goals?: string[];
  /** Replace the whole home budget. */
  homeBudget?: { name: string; amount: number }[];
  /** Set (or add) one home budget line; amount 0 removes it. */
  homeLine?: { name: string; amount: number };
  split?: Partial<SplitPct>;
}

/**
 * Change part of the setup without touching anything else: no balances, no
 * transactions, no recurring costs. Returns short notes describing what changed.
 */
export function patchSetup(db: Db, patch: SetupPatch): string[] {
  const data = loadEngineData(db);
  const a: OnboardingAnswers = parseAnswers(data.settings.onboardingJson) ?? answersFromData(data);
  const notes: string[] = [];
  const settingsPatch: Partial<s.Settings> = {};
  const base = data.settings.baseCurrency as CurrencyCode;
  const home = data.settings.householdCurrency as CurrencyCode;

  if (patch.name?.trim()) {
    a.name = patch.name.trim();
    settingsPatch.ownerName = a.name;
    notes.push(`Name set to ${a.name}`);
  }
  if (patch.businessName?.trim()) {
    a.businessName = patch.businessName.trim();
    settingsPatch.businessName = a.businessName;
    notes.push(`Business name set to ${a.businessName}`);
  }
  if (patch.monthlyIncome !== undefined && Number(patch.monthlyIncome) >= 0) {
    a.monthlyIncomeMinor = parseMajorToMinor(String(patch.monthlyIncome), base);
    notes.push(`Usual monthly income set to ${patch.monthlyIncome} ${base}`);
  }
  if (patch.reserveMonths !== undefined && Number(patch.reserveMonths) > 0) {
    const m = Math.round(Number(patch.reserveMonths));
    a.reserveMonths = m;
    settingsPatch.reserveTargetMonths = String(m);
    settingsPatch.reserveMinMonths = String(Math.min(m, 3));
    settingsPatch.reserveMaxMonths = String(Math.max(m, 6));
    notes.push(`Cushion target set to ${m} month${m === 1 ? "" : "s"} of costs`);
  }
  if (patch.fxRate !== undefined && Number(patch.fxRate) > 0) {
    a.fxRate = String(patch.fxRate);
    settingsPatch.defaultFxRatePkrPerUsd = a.fxRate;
    notes.push(`Rate set to ${a.fxRate} ${home} per 1 ${base}`);
  }
  if (patch.goals) {
    const valid = new Set(GOALS.map((g) => g.value));
    const picked = patch.goals.map((g) => String(g).trim().toLowerCase().replace(/\s+/g, "_")).filter((g): g is Goal => valid.has(g as Goal));
    if (picked.length) {
      a.goals = [...new Set(picked)];
      notes.push(`Goals updated (${a.goals.length})`);
    }
  }
  if (patch.country?.trim()) {
    a.country = patch.country.trim();
    for (const t of data.taxProfiles) db.update(s.taxProfiles).set({ jurisdiction: a.country }).where(eq(s.taxProfiles.id, t.id)).run();
    notes.push(`Home country set to ${a.country}`);
  }
  if (patch.registrationCountry?.trim()) {
    a.registration = "abroad";
    a.registrationCountry = patch.registrationCountry.trim();
    for (const e of data.entities) db.update(s.entities).set({ jurisdiction: a.registrationCountry }).where(eq(s.entities.id, e.id)).run();
    notes.push(`Business registered in ${a.registrationCountry}`);
  }

  // Home budget lines live in the home currency.
  const catFor = (name: string) => {
    const n = name.toLowerCase();
    const pick = /rent|mortgage|electric|gas|water|utilit/.test(n) ? "Utilities" : /food|grocer|water/.test(n) ? "Food" : /internet|wifi|phone/.test(n) ? "Internet" : /family|parent|brother|sister|wife|husband|kid|child/.test(n) ? "Family support" : /netflix|spotify|stream/.test(n) ? "Streaming" : "Other";
    return categoryId("personal", pick);
  };
  const lines = () => db.select().from(s.householdBudgetLines).all();
  if (patch.homeBudget) {
    for (const l of lines()) db.delete(s.householdBudgetLines).where(eq(s.householdBudgetLines.id, l.id)).run();
    patch.homeBudget.forEach((h, i) => {
      if (!h.name?.trim() || !(Number(h.amount) > 0)) return;
      upsertHouseholdLine(db, { name: h.name.trim(), categoryId: catFor(h.name), amountMinor: parseMajorToMinor(String(h.amount), home), currency: home, isActive: true, sortOrder: i + 1, notes: null });
    });
    notes.push("Home budget replaced");
  }
  if (patch.homeLine?.name?.trim()) {
    const name = patch.homeLine.name.trim();
    const amountMinor = parseMajorToMinor(String(patch.homeLine.amount ?? 0), home);
    const existing = lines().find((l) => l.name.toLowerCase() === name.toLowerCase()) ?? lines().find((l) => l.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(l.name.toLowerCase().split(" ")[0]));
    if (existing && amountMinor <= 0) {
      db.delete(s.householdBudgetLines).where(eq(s.householdBudgetLines.id, existing.id)).run();
      notes.push(`Removed ${existing.name} from the home budget`);
    } else if (existing) {
      db.update(s.householdBudgetLines).set({ amountMinor, currency: home, isActive: true }).where(eq(s.householdBudgetLines.id, existing.id)).run();
      notes.push(`Home budget: ${existing.name} set to ${patch.homeLine.amount} ${home}`);
    } else if (amountMinor > 0) {
      upsertHouseholdLine(db, { name, categoryId: catFor(name), amountMinor, currency: home, isActive: true, sortOrder: lines().length + 1, notes: null });
      notes.push(`Home budget: added ${name} at ${patch.homeLine.amount} ${home}`);
    }
  }
  if (patch.homeBudget || patch.homeLine || settingsPatch.defaultFxRatePkrPerUsd) {
    const merged = { ...data.settings, ...settingsPatch } as s.Settings;
    const now = lines();
    settingsPatch.householdBudgetUsdCents = householdLinesUsd(now, merged);
    a.household = now.map((l) => ({ name: l.name, amountMinor: l.amountMinor }));
  }

  // The split. A new tax share moves the difference into (or out of) the other shares.
  const wantsSplit: Partial<SplitPct> = { ...(patch.split ?? {}) };
  if (patch.taxPct !== undefined && Number(patch.taxPct) >= 0 && Number(patch.taxPct) <= 60) {
    a.taxPct = Number(patch.taxPct);
    wantsSplit.tax = Math.round(a.taxPct);
    for (const t of data.taxProfiles) db.update(s.taxProfiles).set({ assumedRatePct: String(a.taxPct) }).where(eq(s.taxProfiles.id, t.id)).run();
  }
  if (Object.keys(wantsSplit).length) {
    const policy = data.policies.find((p) => p.isDefault) ?? data.policies[0];
    const current: SplitPct = { opex: Number(policy.opexPct), owner: Number(policy.ownerPct), tax: Number(policy.taxPct), profit: Number(policy.profitPct), reserve: Number(policy.reservePct), growth: Number(policy.growthPct) };
    const next = rebalanceSplit(current, wantsSplit);
    upsertPolicy(db, { id: policy.id, name: policy.name, description: policy.description, appliesFromMonthlyRevenueUsdCents: policy.appliesFromMonthlyRevenueUsdCents, opexPct: String(next.opex), ownerPct: String(next.owner), taxPct: String(next.tax), profitPct: String(next.profit), reservePct: String(next.reserve), growthPct: String(next.growth), isDefault: true });
    a.split = next;
    notes.push(`Split is now running costs ${next.opex}%, your pay ${next.owner}%, tax ${next.tax}%, profit ${next.profit}%, cushion ${next.reserve}%, growth ${next.growth}%`);
  }

  updateSettings(db, { ...settingsPatch, onboardingJson: JSON.stringify(a) });
  void currencyMeta;
  return notes;
}
