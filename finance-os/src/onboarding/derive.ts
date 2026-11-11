import type { EngineData } from "@/engine/types";
import { accountBalance } from "@/engine/ledger";
import type { CurrencyCode } from "@/lib/money";
import type { Frequency } from "@/lib/constants";
import { emptyAnswers, parseAnswers, type OnboardingAnswers } from "./model";

/**
 * Setup answers reconstructed from what is in the workspace. Used when a
 * workspace was never taken through the questions (the demo, the owner's own
 * template, older accounts) so "review my setup" always has something to show.
 */
export function answersFromData(data: EngineData): OnboardingAnswers {
  const a = emptyAnswers();
  const st = data.settings;
  a.name = st.ownerName === "Owner" ? "" : st.ownerName;
  a.businessName = st.businessName === "My business" ? "" : st.businessName;
  a.persona = data.clients.length > 1 ? "agency" : "solopreneur";
  a.baseCurrency = st.baseCurrency as CurrencyCode;
  a.householdCurrency = st.householdCurrency as CurrencyCode;
  a.fxRate = a.baseCurrency === a.householdCurrency ? "1" : st.defaultFxRatePkrPerUsd;
  a.country = data.taxProfiles[0]?.jurisdiction && data.taxProfiles[0].jurisdiction !== "To be set" ? data.taxProfiles[0].jurisdiction : "";
  const entity = data.entities.find((e) => e.type === "us_llc") ?? data.entities[0];
  if (entity && entity.jurisdiction !== "To be set" && a.country && !entity.jurisdiction.toLowerCase().includes(a.country.toLowerCase())) {
    a.registration = "abroad";
    a.registrationCountry = entity.jurisdiction;
  }
  const policy = data.policies.find((p) => p.isDefault) ?? data.policies[0];
  if (policy) {
    a.split = { opex: Number(policy.opexPct), owner: Number(policy.ownerPct), tax: Number(policy.taxPct), profit: Number(policy.profitPct), reserve: Number(policy.reservePct), growth: Number(policy.growthPct) };
    a.taxPct = Number(policy.taxPct);
  }
  a.reserveMonths = Number(st.reserveTargetMonths) || 3;
  const active = data.recurringExpenses.filter((r) => r.status === "active" && r.amountMinor > 0);
  a.subscriptions = active.filter((r) => r.frequency === "monthly").map((r) => ({ name: r.name, amountMinor: r.amountMinor }));
  a.otherCosts = active.filter((r) => r.frequency !== "monthly").map((r) => ({ name: r.name, amountMinor: r.amountMinor, frequency: r.frequency as Frequency }));
  const lines = data.householdLines.filter((l) => l.isActive && l.amountMinor > 0);
  if (lines.length) a.household = lines.map((l) => ({ name: l.name, amountMinor: l.amountMinor }));
  const bal = (role: string) => {
    const acc = data.accounts.find((x) => x.role === role && !x.isArchived);
    return acc ? Math.max(0, accountBalance(acc, data.transactions, st)) : 0;
  };
  a.businessCashMinor = bal("operating");
  a.taxSavedMinor = bal("tax");
  a.reserveSavedMinor = bal("savings");
  a.personalCashMinor = bal("personal");
  const proc = data.processors[0]?.name;
  if (proc && proc !== "Payment processor") a.paymentMethods = [proc];
  // A usual month: the average of the last three months that had income.
  const byMonth = new Map<string, number>();
  for (const t of data.transactions) if (t.type === "client_payment" || t.type === "income") byMonth.set(t.month, (byMonth.get(t.month) ?? 0) + t.amountUsdCents);
  const recent = [...byMonth.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 3);
  if (recent.length) a.monthlyIncomeMinor = Math.round(recent.reduce((s, [, v]) => s + v, 0) / recent.length);
  return a;
}

/** The stored answers, or answers reconstructed from the workspace. */
export function currentAnswers(data: EngineData): OnboardingAnswers {
  return parseAnswers(data.settings.onboardingJson) ?? answersFromData(data);
}
