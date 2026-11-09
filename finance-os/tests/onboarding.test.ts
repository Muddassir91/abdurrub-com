import { describe, expect, it } from "vitest";
import { openDatabase } from "@/db/client";
import { seedDatabase, IDS } from "@/db/seed";
import * as s from "@/db/schema";
import { loadEngineData } from "@/db/repo";
import { buildSnapshot } from "@/engine/snapshot";
import { applyOnboarding } from "@/onboarding/apply";
import { emptyAnswers, parseAnswers, suggestSplit, splitTotal, type OnboardingAnswers } from "@/onboarding/model";

function answers(): OnboardingAnswers {
  return {
    ...emptyAnswers(),
    name: "Ayesha Khan",
    persona: "freelancer",
    businessName: "Ayesha Design",
    baseCurrency: "USD",
    householdCurrency: "PKR",
    fxRate: "280",
    country: "Pakistan",
    monthlyIncomeMinor: 600000,
    paymentMethods: ["Bank transfer", "Wise"],
    businessCashMinor: 250000,
    taxSavedMinor: 50000,
    reserveSavedMinor: 100000,
    subscriptions: [
      { name: "Google Workspace", amountMinor: 1400, category: "Administrative" },
      { name: "Figma", amountMinor: 1500, category: "Software and AI" },
    ],
    otherCosts: [{ name: "Contractor help", amountMinor: 60000, frequency: "monthly" }],
    household: [
      { name: "Rent or mortgage", amountMinor: 8000000, category: "Utilities" },
      { name: "Groceries", amountMinor: 5000000, category: "Food" },
      { name: "Family support", amountMinor: 0, category: "Family support" },
    ],
    personalCashMinor: 12000000,
    goals: ["cushion", "see_where"],
    taxPct: 15,
    reserveMonths: 3,
    split: { opex: 20, owner: 40, tax: 15, profit: 10, reserve: 10, growth: 5 },
  };
}

describe("onboarding", () => {
  it("suggests a split that adds up to 100 and reflects the answers", () => {
    const a = answers();
    const split = suggestSplit(a);
    expect(splitTotal(split)).toBe(100);
    expect(split.tax).toBe(15);
    // Costs are 629/6000 ≈ 10.5% → ceiling 16%; household 130,000 PKR ≈ $464 → 7.7% + 10 = 18% → floor 20.
    expect(split.opex).toBe(16);
    expect(split.owner).toBe(20);
    expect(split.reserve).toBeGreaterThan(split.growth);
    expect(splitTotal(suggestSplit({ ...a, monthlyIncomeMinor: 0 }))).toBe(100);
    expect(suggestSplit({ ...a, persona: "personal", monthlyIncomeMinor: 0 }).growth).toBe(0);
  });

  it("writes the answers into a blank workspace and the dashboard reads them back", async () => {
    const opened = await openDatabase();
    seedDatabase(opened.db, { template: "blank", businessName: "x", ownerName: "y" });
    expect(opened.db.select().from(s.settings).get()?.onboardingJson).toBeNull();
    applyOnboarding(opened.db, answers());

    const data = loadEngineData(opened.db);
    expect(data.settings.businessName).toBe("Ayesha Design");
    expect(data.settings.ownerName).toBe("Ayesha Khan");
    expect(data.settings.householdCurrency).toBe("PKR");
    expect(data.settings.defaultFxRatePkrPerUsd).toBe("280");
    expect(data.settings.householdBudgetUsdCents).toBe(Math.round(13000000 / 280));
    expect(parseAnswers(data.settings.onboardingJson)?.monthlyIncomeMinor).toBe(600000);

    const policy = data.policies.find((p) => p.isDefault)!;
    expect([policy.opexPct, policy.ownerPct, policy.taxPct]).toEqual(["20", "40", "15"]);
    expect(data.recurringExpenses.map((r) => r.name).sort()).toEqual(["Contractor help", "Figma", "Google Workspace"]);
    expect(data.householdLines.length).toBe(2); // zero lines are dropped
    expect(data.householdLines.every((l) => l.currency === "PKR")).toBe(true);
    expect(data.processors[0].name).toBe("Wise");
    expect(data.accounts.find((a) => a.id === IDS.acctPersonal)?.currency).toBe("PKR");
    expect(data.taxProfiles[0].jurisdiction).toBe("Pakistan");

    const snap = buildSnapshot(data, "2026-11", "2026-11-15");
    expect(snap.cash.bankBusinessCash).toBe(250000 + 50000 + 100000);
    expect(snap.cash.personalCash).toBe(Math.round(12000000 / 280));
    expect(snap.expenses.committedSubscriptionsMonthly).toBe(62900);
    expect(snap.owner.householdLinesBudget).toBe(Math.round(8000000 / 280) + Math.round(5000000 / 280));

    // Running it again (the person redoes setup) replaces the unused recurring costs instead of duplicating them.
    applyOnboarding(opened.db, { ...answers(), subscriptions: [{ name: "Notion", amountMinor: 1000, category: "Operations" }], otherCosts: [] });
    expect(loadEngineData(opened.db).recurringExpenses.map((r) => r.name)).toEqual(["Notion"]);
  });

  it("handles a business registered abroad that pays tax at home, and any world currency", async () => {
    const opened = await openDatabase();
    seedDatabase(opened.db, { template: "blank", businessName: "x", ownerName: "y" });
    applyOnboarding(opened.db, { ...answers(), registration: "abroad", registrationCountry: "United States (Wyoming LLC)", taxPct: 1, baseCurrency: "USD", householdCurrency: "JPY", fxRate: "150", household: [{ name: "Rent", amountMinor: 150000, category: "Utilities" }], personalCashMinor: 300000 });
    const data = loadEngineData(opened.db);
    expect(data.entities[0].jurisdiction).toBe("United States (Wyoming LLC)");
    expect(data.entities[0].type).toBe("us_llc");
    expect(data.taxProfiles[0].jurisdiction).toBe("Pakistan");
    expect(data.taxProfiles[0].assumedRatePct).toBe("1");
    expect(data.complianceItems.some((c) => c.title.startsWith("Annual filing in United States"))).toBe(true);
    expect(data.policies.find((p) => p.isDefault)?.taxPct).toBe("15"); // the split keeps the shares the person reviewed
    // Yen has no minor digits: ¥150,000 at 150 per dollar is $1,000.00.
    expect(data.settings.householdBudgetUsdCents).toBe(100000);
    const snap = buildSnapshot(data, "2026-11", "2026-11-15");
    expect(snap.cash.personalCash).toBe(200000);
  });

  it("marks the templates as already set up", async () => {
    const demo = await openDatabase();
    seedDatabase(demo.db, { template: "demo" });
    expect(demo.db.select().from(s.settings).get()?.onboardingJson).toContain("template");
    const owner = await openDatabase();
    seedDatabase(owner.db);
    expect(owner.db.select().from(s.settings).get()?.onboardingJson).toContain("template");
  });
});
