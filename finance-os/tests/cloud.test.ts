import { describe, expect, it } from "vitest";
import { decideSync } from "@/cloud/sync";
import { MemoryCloud } from "@/cloud/memory";
import { buildTrend, summarizeTrend, trendBuckets } from "@/engine/trends";
import { tx, payment } from "./fixtures";
import { IDS } from "@/db/seed";

describe("sync decisions", () => {
  it("uploads when only local exists, downloads when only remote exists", () => {
    expect(decideSync({ version: 3, savedAt: "2026-11-01T00:00:00Z", lastSyncedVersion: 0 }, null)).toEqual({ action: "upload" });
    expect(decideSync(null, { version: 2, savedAt: "2026-11-01T00:00:00Z" })).toEqual({ action: "download" });
    expect(decideSync(null, null)).toEqual({ action: "none" });
  });
  it("detects which side changed since the last sync", () => {
    const synced = { version: 5, savedAt: "2026-11-01T00:00:00Z", lastSyncedVersion: 5 };
    expect(decideSync(synced, { version: 5, savedAt: "2026-11-01T00:00:00Z" })).toEqual({ action: "none" });
    expect(decideSync({ ...synced, version: 6 }, { version: 5, savedAt: "2026-11-01T00:00:00Z" })).toEqual({ action: "upload" });
    expect(decideSync(synced, { version: 7, savedAt: "2026-11-02T00:00:00Z" })).toEqual({ action: "download" });
  });
  it("flags a conflict when both changed and prefers the newer save", () => {
    const d = decideSync({ version: 6, savedAt: "2026-11-03T00:00:00Z", lastSyncedVersion: 5 }, { version: 7, savedAt: "2026-11-02T00:00:00Z" });
    expect(d).toEqual({ action: "conflict", prefer: "local" });
    const d2 = decideSync({ version: 6, savedAt: "2026-11-01T00:00:00Z", lastSyncedVersion: 5 }, { version: 7, savedAt: "2026-11-02T00:00:00Z" });
    expect(d2).toEqual({ action: "conflict", prefer: "remote" });
  });
});

describe("memory cloud backend", () => {
  it("isolates workspaces per user and round-trips images", async () => {
    const cloud = new MemoryCloud();
    await cloud.signUp("a@example.com", "password1");
    const now = new Date().toISOString();
    await cloud.upsertWorkspace({ id: "w1", name: "A", businessName: "A Ltd", ownerName: "A", template: "blank", version: 1, savedAt: now, encrypted: false, salt: null, iv: null, createdAt: now });
    await cloud.uploadImage("w1", new Uint8Array([1, 2, 3]), { version: 2, savedAt: now, encrypted: false });
    expect((await cloud.listWorkspaces()).map((w) => [w.id, w.version])).toEqual([["w1", 2]]);
    expect(Array.from((await cloud.downloadImage("w1"))!)).toEqual([1, 2, 3]);
    await cloud.signOut();
    await cloud.signUp("b@example.com", "password2");
    expect(await cloud.listWorkspaces()).toEqual([]);
    expect(await cloud.downloadImage("w1")).toBeNull();
    await expect(cloud.signInWithPassword("a@example.com", "wrong")).rejects.toThrow();
  });
});

describe("trends", () => {
  const rows = [
    payment(100000, { date: "2026-11-02" }),
    payment(50000, { date: "2026-11-09" }),
    tx({ type: "expense", amountUsdCents: 20000, date: "2026-11-03", accountId: IDS.acctOperating }),
    tx({ type: "owner_draw", amountUsdCents: 30000, date: "2026-11-10", accountId: IDS.acctOperating, toAccountId: IDS.acctPersonal }),
    tx({ type: "household_expense", amountUsdCents: 5000, date: "2026-11-10", accountId: IDS.acctPersonal }),
    tx({ type: "transfer", amountUsdCents: 99999, date: "2026-11-10", accountId: IDS.acctOperating, toAccountId: IDS.acctSavings }),
    payment(70000, { date: "2025-12-15" }),
  ];
  it("buckets by day, week, month and year", () => {
    expect(trendBuckets("day", "2026-11-10", 3).map((b) => b.key)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10"]);
    expect(trendBuckets("week", "2026-11-10", 2).map((b) => b.start)).toEqual(["2026-11-02", "2026-11-09"]);
    expect(trendBuckets("month", "2026-11-10", 2).map((b) => b.key)).toEqual(["2026-10", "2026-11"]);
    expect(trendBuckets("year", "2026-11-10", 2).map((b) => b.key)).toEqual(["2025", "2026"]);
  });
  it("aggregates revenue, spend and draws; transfers and personal spend never hit the business result", () => {
    const weeks = buildTrend(rows, "week", "2026-11-10", 2);
    expect(weeks[0]).toMatchObject({ start: "2026-11-02", collected: 100000, overhead: 20000, result: 80000 });
    expect(weeks[1]).toMatchObject({ start: "2026-11-09", collected: 50000, ownerDraws: 30000, personalSpend: 5000, result: 20000, cumulativeResult: 100000 });
    const years = buildTrend(rows, "year", "2026-11-10", 2);
    expect(years[0].collected).toBe(70000);
    expect(years[1].collected).toBe(150000);
    const s = summarizeTrend(weeks);
    expect(s.netChangePct).toBe("-50.0");
    expect(s.bestPeriod?.start).toBe("2026-11-02");
  });
});
