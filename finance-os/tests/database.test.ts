import { describe, expect, it } from "vitest";
import { openDatabase, exportImage } from "@/db/client";
import { seedDatabase, IDS } from "@/db/seed";
import * as s from "@/db/schema";
import { loadEngineData } from "@/db/repo";
import { buildSnapshot } from "@/engine/snapshot";
import { eq } from "drizzle-orm";

describe("database", () => {
  it("creates schema, seeds the owner's starting position and survives an export/import round trip", async () => {
    const opened = await openDatabase();
    expect(opened.isNew).toBe(true);
    expect(seedDatabase(opened.db)).toBe(true);
    expect(seedDatabase(opened.db)).toBe(false); // idempotent

    const settings = opened.db.select().from(s.settings).get();
    expect(settings?.businessName).toBe("Retention Rules");
    const policies = opened.db.select().from(s.allocationPolicies).all();
    expect(policies[0].opexPct).toBe("25");
    const subs = opened.db.select().from(s.recurringExpenses).all();
    const known = subs.filter((r) => r.status === "active").reduce((a, r) => a + r.amountMinor, 0);
    expect(known).toBe(83100); // ListKit 600 + Claude 100 + Loom 24 + Kit 39 + LinkedIn 68
    const hh = opened.db.select().from(s.householdBudgetLines).all();
    expect(hh.reduce((a, l) => a + l.amountMinor, 0)).toBe(19500000); // PKR 195,000
    const client = opened.db.select().from(s.clients).where(eq(s.clients.id, IDS.clientOne)).get();
    expect(client?.revenueSharePct).toBe("20");

    opened.db
      .insert(s.transactions)
      .values({
        id: "t1",
        date: "2026-11-05",
        month: "2026-11",
        type: "client_payment",
        amountMinor: 400000,
        currency: "USD",
        fxRatePerUsd: "1",
        amountUsdCents: 400000,
        description: "November commission",
        accountId: IDS.acctOperating,
        clientId: IDS.clientOne,
        isEssential: false,
        isRecurring: false,
        createdAt: "x",
        updatedAt: "x",
      })
      .run();

    const bytes = exportImage(opened.sql);
    expect(bytes.byteLength).toBeGreaterThan(1000);

    const reopened = await openDatabase(bytes);
    expect(reopened.isNew).toBe(false);
    const data = loadEngineData(reopened.db);
    expect(data.transactions.length).toBe(1);
    const snap = buildSnapshot(data, "2026-11", "2026-11-15");
    expect(snap.allocations).toEqual({ opex: 100000, owner: 140000, tax: 60000, profit: 40000, reserve: 40000, growth: 20000 });
    expect(snap.expenses.committedSubscriptionsMonthly).toBe(83100);
    expect(snap.owner.householdLinesBudget).toBe(69642); // PKR 195,000 at 280, rounded per line
  });
});
