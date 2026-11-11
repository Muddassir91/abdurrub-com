import { describe, expect, it } from "vitest";
import { openDatabase } from "@/db/client";
import { seedDatabase } from "@/db/seed";
import { loadEngineData } from "@/db/repo";
import { buildSnapshot } from "@/engine/snapshot";
import { parseLocal, takeAmount } from "@/assistant/parser";
import { runAction, resolvePage } from "@/assistant/actions";
import { applyOnboarding } from "@/onboarding/apply";
import { currentAnswers } from "@/onboarding/derive";
import { emptyAnswers, rebalanceSplit, splitTotal } from "@/onboarding/model";
import { parseUi } from "@/lib/ui";
import { nextSteps } from "@/engine/nextSteps";

const TODAY = "2026-11-15";
const MONTH = "2026-11";

async function workspace() {
  const opened = await openDatabase();
  seedDatabase(opened.db, { template: "blank", businessName: "x", ownerName: "y" });
  applyOnboarding(opened.db, { ...emptyAnswers(), name: "Ayesha", businessName: "Ayesha Design", baseCurrency: "USD", householdCurrency: "PKR", fxRate: "280", monthlyIncomeMinor: 400000, businessCashMinor: 100000, subscriptions: [{ name: "Figma", amountMinor: 1500 }], split: { opex: 25, owner: 35, tax: 15, profit: 10, reserve: 10, growth: 5 } });
  const env = { db: opened.db, today: TODAY, month: MONTH };
  return { db: opened.db, env };
}

describe("on-device parser", () => {
  it("reads amounts with symbols, codes and multipliers", () => {
    expect(takeAmount("$1,250.50 on rent")).toMatchObject({ amount: 1250.5, currency: "$", after: "on rent" });
    expect(takeAmount("5k pkr")).toMatchObject({ amount: 5000, currency: "PKR" });
    expect(takeAmount("rs 450 for uber")).toMatchObject({ amount: 450, currency: "RS", after: "for uber" });
    expect(takeAmount("2 lakh")).toMatchObject({ amount: 200000 });
    expect(takeAmount("20 for lunch")).toMatchObject({ amount: 20, currency: undefined, after: "for lunch" });
  });

  it("understands everyday money commands", () => {
    expect(parseLocal("spent 20 on lunch")).toEqual([{ name: "add_money_out", args: { amount: 20, what: "Lunch" } }]);
    expect(parseLocal("I just paid $15 for Figma")).toEqual([{ name: "add_money_out", args: { amount: 15, currency: "$", what: "Figma" } }]);
    expect(parseLocal("hey, bought groceries for 5000 rs yesterday")).toEqual([{ name: "add_money_out", args: { amount: 5000, currency: "RS", what: "Groceries", date: "yesterday" } }]);
    expect(parseLocal("uber 450")).toEqual([{ name: "add_money_out", args: { amount: 450, what: "Uber" } }]);
    expect(parseLocal("20 on coffee")).toEqual([{ name: "add_money_out", args: { amount: 20, what: "Coffee" } }]);
    expect(parseLocal("netflix cost me 12")).toEqual([{ name: "add_money_out", args: { amount: 12, what: "Netflix" } }]);
    expect(parseLocal("got paid 1,200 from Harbor Coffee")).toEqual([{ name: "add_money_in", args: { amount: 1200, from: "Harbor Coffee" } }]);
    expect(parseLocal("I just got paid 500 more")).toEqual([{ name: "add_money_in", args: { amount: 500 } }]);
    expect(parseLocal("received 4500 for november retainer")).toEqual([{ name: "add_money_in", args: { amount: 4500, what: "November retainer" } }]);
    expect(parseLocal("Lumen paid me 780")).toEqual([{ name: "add_money_in", args: { amount: 780, from: "Lumen" } }]);
    expect(parseLocal("paid myself 800")).toEqual([{ name: "pay_myself", args: { amount: 800 } }]);
    expect(parseLocal("moved 600 to tax")).toEqual([{ name: "set_aside", args: { amount: 600, for: "tax" } }]);
    expect(parseLocal("put 300 into savings")).toEqual([{ name: "set_aside", args: { amount: 300, for: "cushion" } }]);
    expect(parseLocal("paid 250 in taxes")).toEqual([{ name: "pay_tax", args: { amount: 250 } }]);
  });

  it("splits several commands and carries the verb", () => {
    expect(parseLocal("spent 20 on lunch and 50 on fuel")).toEqual([
      { name: "add_money_out", args: { amount: 20, what: "Lunch" } },
      { name: "add_money_out", args: { amount: 50, what: "Fuel" } },
    ]);
    expect(parseLocal("got paid 900 from Acme and paid myself 300")).toEqual([
      { name: "add_money_in", args: { amount: 900, from: "Acme" } },
      { name: "pay_myself", args: { amount: 300 } },
    ]);
  });

  it("understands settings, setup, layout and navigation commands", () => {
    expect(parseLocal("undo")).toEqual([{ name: "undo" }]);
    expect(parseLocal("I misunderstood the onboarding questions, I need to go through that again")).toEqual([{ name: "redo_setup" }]);
    expect(parseLocal("redo setup")).toEqual([{ name: "redo_setup" }]);
    expect(parseLocal("dark mode")).toEqual([{ name: "set_theme", args: { theme: "dark" } }]);
    expect(parseLocal("my tax is 1%")).toEqual([{ name: "update_setup", args: { taxPct: 1 } }]);
    expect(parseLocal("set tax to 12.5 percent")).toEqual([{ name: "update_setup", args: { taxPct: 12.5 } }]);
    expect(parseLocal("my income is 6,000 a month")).toEqual([{ name: "update_setup", args: { monthlyIncome: 6000 } }]);
    expect(parseLocal("i make 5k a month")).toEqual([{ name: "update_setup", args: { monthlyIncome: 5000 } }]);
    expect(parseLocal("give me a simple dashboard")).toEqual([{ name: "customize_dashboard", args: { preset: "simple" } }]);
    expect(parseLocal("hide the weekly chart")).toEqual([{ name: "customize_dashboard", args: { hide: ["weeks"] } }]);
    expect(parseLocal("show coming up")).toEqual([{ name: "customize_dashboard", args: { show: ["upcoming"] } }]);
    expect(parseLocal("track food with a 300 limit")).toEqual([{ name: "customize_dashboard", args: { add_tracker: { category: "food", limit: 300 } } }]);
    expect(parseLocal("go to subscriptions")).toEqual([{ name: "navigate", args: { page: "Tools & overhead" } }]);
    expect(parseLocal("last month")).toEqual([{ name: "set_month", args: { month: "previous" } }]);
    expect(parseLocal("cancel figma", { subscriptions: ["Figma"] })).toEqual([{ name: "remove_subscription", args: { name: "figma" } }]);
  });

  it("leaves questions and anything unclear to the model", () => {
    expect(parseLocal("how much did I spend on food?")).toBeNull();
    expect(parseLocal("can I afford a 200 dollar tool")).toBeNull();
    expect(parseLocal("what is my runway")).toBeNull();
    expect(parseLocal("rent and utilities 500 600")).toBeNull();
    expect(parseLocal("my rent went up to 900")).toBeNull();
    expect(parseLocal("cancel figma")).toBeNull();
  });
});

describe("assistant actions", () => {
  it("adds money in and out with the right side, category and currency", async () => {
    const { db, env } = await workspace();
    expect(runAction(env, { name: "add_money_in", args: { amount: 4000, what: "November retainer" } }).ok).toBe(true);
    const lunch = runAction(env, { name: "add_money_out", args: { amount: 5600, currency: "RS", what: "Groceries" } });
    expect(lunch.text).toContain("Rs 5,600");
    expect(lunch.text).toContain("personal");
    const tool = runAction(env, { name: "add_money_out", args: { amount: 20, what: "ChatGPT" } });
    expect(tool.text).toContain("business");
    const data = loadEngineData(db);
    const byDesc = Object.fromEntries(data.transactions.map((t) => [t.description, t]));
    expect(byDesc["Groceries"].type).toBe("household_expense");
    expect(byDesc["Groceries"].currency).toBe("PKR");
    expect(byDesc["Groceries"].amountUsdCents).toBe(2000);
    expect(data.categories.find((c) => c.id === byDesc["ChatGPT"].categoryId)?.name).toBe("Software and AI");
    const snap = buildSnapshot(data, MONTH, TODAY);
    expect(snap.revenue.collected).toBe(400000);
    expect(snap.expenses.overheadActual).toBe(2000);
    expect(snap.owner.householdActual).toBe(2000);
  });

  it("records pay, set-asides and tax, then edits and deletes", async () => {
    const { db, env } = await workspace();
    runAction(env, { name: "add_money_in", args: { amount: 4000 } });
    expect(runAction(env, { name: "pay_myself", args: { amount: 800 } }).ok).toBe(true);
    expect(runAction(env, { name: "set_aside", args: { amount: 600, for: "tax" } }).ok).toBe(true);
    expect(runAction(env, { name: "pay_tax", args: { amount: 100 } }).ok).toBe(true);
    let snap = buildSnapshot(loadEngineData(db), MONTH, TODAY);
    expect(snap.owner.drawn).toBe(80000);
    expect(snap.tax.fundedBalance).toBe(50000);
    expect(snap.tax.paidThisMonth).toBe(10000);
    runAction(env, { name: "add_money_out", args: { amount: 15, what: "Lunch" } });
    // Personal spending defaults to the home currency (PKR here).
    expect(runAction(env, { name: "update_transaction", args: { amount: 50 } }).text).toContain("Rs 50");
    expect(loadEngineData(db).transactions.find((t) => t.description === "Lunch")?.amountMinor).toBe(5000);
    expect(runAction(env, { name: "delete_transaction", args: { match: "lunch" } }).ok).toBe(true);
    expect(loadEngineData(db).transactions.some((t) => t.description === "Lunch")).toBe(false);
    snap = buildSnapshot(loadEngineData(db), MONTH, TODAY);
    expect(snap.owner.discretionaryActual + snap.owner.householdActual).toBe(0);
  });

  it("changes setup answers without touching balances or entries", async () => {
    const { db, env } = await workspace();
    runAction(env, { name: "add_money_in", args: { amount: 1000 } });
    const before = buildSnapshot(loadEngineData(db), MONTH, TODAY).cash.bankBusinessCash;
    const r = runAction(env, { name: "update_setup", args: { taxPct: 1, monthlyIncome: 6000, homeLine: { name: "Rent", amount: 80000 } } });
    expect(r.ok).toBe(true);
    const data = loadEngineData(db);
    const policy = data.policies.find((p) => p.isDefault)!;
    expect(policy.taxPct).toBe("1");
    expect(Number(policy.profitPct)).toBe(24); // the 14 points freed from tax moved to profit
    expect(currentAnswers(data).monthlyIncomeMinor).toBe(600000);
    expect(data.householdLines.find((l) => l.name === "Rent")?.amountMinor).toBe(8000000);
    expect(data.settings.householdBudgetUsdCents).toBe(Math.round(8000000 / 280));
    expect(buildSnapshot(data, MONTH, TODAY).cash.bankBusinessCash).toBe(before);
    expect(data.transactions.length).toBe(1);
    expect(runAction(env, { name: "set_split", args: { profit: 10, cushion: 24 } }).ok).toBe(true);
    const p2 = loadEngineData(db).policies.find((p) => p.isDefault)!;
    expect([p2.profitPct, p2.reservePct]).toEqual(["10", "24"]);
    expect(runAction(env, { name: "set_split", args: { opex: 90, owner: 90 } }).ok).toBe(false);
  });

  it("corrects a balance, manages subscriptions and customizes the home screen", async () => {
    const { db, env } = await workspace();
    expect(runAction(env, { name: "set_balance", args: { account: "business", amount: 2500 } }).ok).toBe(true);
    expect(buildSnapshot(loadEngineData(db), MONTH, TODAY).cash.bankBusinessCash).toBe(250000);
    expect(runAction(env, { name: "add_subscription", args: { name: "Notion", amount: 10 } }).ok).toBe(true);
    expect(runAction(env, { name: "remove_subscription", args: { name: "figma" } }).ok).toBe(true);
    const subs = loadEngineData(db).recurringExpenses;
    expect(subs.find((r) => r.name === "Notion")?.status).toBe("active");
    expect(subs.find((r) => r.name === "Figma")?.status).toBe("cancelled");
    expect(runAction(env, { name: "customize_dashboard", args: { preset: "simple" } }).ok).toBe(true);
    expect(runAction(env, { name: "customize_dashboard", args: { show: ["weekly chart"], add_tracker: { category: "food", limit: 300 } } }).ok).toBe(true);
    const ui = parseUi(loadEngineData(db).settings.uiJson);
    expect(ui.dashboard.hidden).not.toContain("weeks");
    expect(ui.dashboard.hidden).toContain("categories");
    expect(ui.dashboard.trackers[0]).toMatchObject({ kind: "category", category: "Food", limitMinor: 30000 });
    expect(runAction(env, { name: "redo_setup" }).effect).toEqual({ kind: "setup", step: null });
    expect(runAction(env, { name: "navigate", args: { page: "taxes" } }).effect).toMatchObject({ href: "/app/tax/" });
    expect(resolvePage("my subscriptions page")?.href).toBe("/app/expenses/");
    expect(runAction(env, { name: "add_money_out", args: { amount: 10, currency: "AED", what: "Taxi" } }).ok).toBe(false); // no rate known
    expect(runAction(env, { name: "add_money_out", args: { amount: 10, currency: "AED", rate: 3.67, what: "Taxi" } }).ok).toBe(true);
    expect(runAction(env, { name: "launch_rocket" }).ok).toBe(false);
  });

  it("reviewing setup again keeps balances and does not duplicate costs", async () => {
    const { db, env } = await workspace();
    runAction(env, { name: "add_money_in", args: { amount: 1000 } });
    runAction(env, { name: "add_money_out", args: { amount: 15, what: "Figma", side: "business" } });
    const data = loadEngineData(db);
    const cashBefore = buildSnapshot(data, MONTH, TODAY).cash.bankBusinessCash;
    const answers = currentAnswers(data);
    applyOnboarding(db, { ...answers, name: "Ayesha K", taxPct: 5 });
    const after = loadEngineData(db);
    expect(after.settings.ownerName).toBe("Ayesha K");
    expect(after.recurringExpenses.filter((r) => r.name === "Figma").length).toBe(1);
    expect(after.transactions.length).toBe(2);
    expect(buildSnapshot(after, MONTH, TODAY).cash.bankBusinessCash).toBe(cashBefore);
  });
});

describe("split and next steps", () => {
  it("rebalances the split to 100", () => {
    const base = { opex: 25, owner: 35, tax: 15, profit: 10, reserve: 10, growth: 5 };
    expect(splitTotal(rebalanceSplit(base, { tax: 1 }))).toBe(100);
    expect(rebalanceSplit(base, { tax: 1 }).profit).toBe(24);
    expect(rebalanceSplit(base, { tax: 30 })).toMatchObject({ profit: 0, reserve: 5, tax: 30 });
    expect(() => rebalanceSplit(base, { opex: 60, owner: 60 })).toThrow();
  });

  it("says what to do next from the numbers", async () => {
    const { db, env } = await workspace();
    let data = loadEngineData(db);
    let steps = nextSteps(data, buildSnapshot(data, MONTH, TODAY), TODAY, MONTH);
    expect(steps[0].id).toBe("first-entry");
    runAction(env, { name: "add_money_in", args: { amount: 4000 } });
    runAction(env, { name: "add_money_out", args: { amount: 1500, what: "Ads", side: "business" } });
    data = loadEngineData(db);
    steps = nextSteps(data, buildSnapshot(data, MONTH, TODAY), TODAY, MONTH);
    const ids = steps.map((s) => s.id);
    expect(ids).toContain("over-ceiling");
    expect(ids).toContain("tax");
    expect(steps.find((s) => s.id === "tax")?.say).toBe("moved 600 to tax");
    expect(steps.length).toBeLessThanOrEqual(3);
  });
});
