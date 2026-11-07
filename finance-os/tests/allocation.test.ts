import { describe, expect, it } from "vitest";
import { computeAllocations, validatePercentages, selectPolicy, sumAllocations } from "@/engine/allocation";
import { allocateExact, parseMajorToMinor, convertToUsdCents, formatMoney } from "@/lib/money";
import { leanPolicy } from "./fixtures";

const LEAN = { opex: "25", owner: "35", tax: "15", profit: "10", reserve: "10", growth: "5" };

describe("allocation engine", () => {
  it("Scenario A: $4,000 revenue", () => {
    const a = computeAllocations(400000, LEAN);
    expect(a).toEqual({ opex: 100000, owner: 140000, tax: 60000, profit: 40000, reserve: 40000, growth: 20000 });
    expect(sumAllocations(a)).toBe(400000);
  });

  it("Scenario B: $10,000 revenue", () => {
    const a = computeAllocations(1000000, LEAN);
    expect(a).toEqual({ opex: 250000, owner: 350000, tax: 150000, profit: 100000, reserve: 100000, growth: 50000 });
    expect(sumAllocations(a)).toBe(1000000);
  });

  it("Scenario C: $20,000 revenue", () => {
    const a = computeAllocations(2000000, LEAN);
    expect(a).toEqual({ opex: 500000, owner: 700000, tax: 300000, profit: 200000, reserve: 200000, growth: 100000 });
    expect(sumAllocations(a)).toBe(2000000);
  });

  it("always sums exactly to the base, even with awkward amounts", () => {
    for (const base of [1, 3, 7, 99, 333333, 400001, 123456789, 999999999]) {
      const a = computeAllocations(base, LEAN);
      expect(sumAllocations(a)).toBe(base);
    }
    const odd = { opex: "33.33", owner: "33.33", tax: "33.34", profit: "0", reserve: "0", growth: "0" };
    for (const base of [100, 101, 1000001]) expect(sumAllocations(computeAllocations(base, odd))).toBe(base);
  });

  it("largest-remainder keeps parts within one cent of the exact share", () => {
    const parts = allocateExact(1000, [
      { key: "a", pct: "33.333" },
      { key: "b", pct: "33.333" },
      { key: "c", pct: "33.334" },
    ]);
    expect(parts.a + parts.b + parts.c).toBe(1000);
    expect(Math.abs(parts.a - 333.33)).toBeLessThan(1);
  });

  it("rejects policies that do not add up to 100%", () => {
    expect(validatePercentages({ ...LEAN, growth: "6" }).ok).toBe(false);
    expect(validatePercentages({ ...LEAN, growth: "abc" }).ok).toBe(false);
    expect(validatePercentages({ ...LEAN, growth: "-5", opex: "35" }).ok).toBe(false);
    expect(validatePercentages(LEAN).ok).toBe(true);
    expect(() => computeAllocations(1000, { ...LEAN, growth: "6" })).toThrow();
  });

  it("negative or zero revenue yields zero allocations, never negative targets", () => {
    expect(sumAllocations(computeAllocations(0, LEAN))).toBe(0);
    expect(sumAllocations(computeAllocations(-5000, LEAN))).toBe(0);
  });

  it("selects the policy by revenue band unless pinned", () => {
    const lean = leanPolicy();
    const scale = leanPolicy({ id: "scale", name: "Scale", appliesFromMonthlyRevenueUsdCents: 2000000, isDefault: false, opexPct: "35", ownerPct: "25" });
    expect(selectPolicy([lean, scale], 400000).id).toBe(lean.id);
    expect(selectPolicy([lean, scale], 2500000).id).toBe("scale");
    expect(selectPolicy([lean, scale], 2500000, lean.id).id).toBe(lean.id);
  });
});

describe("money primitives", () => {
  it("parses user input to minor units without float drift", () => {
    expect(parseMajorToMinor("4,000.10")).toBe(400010);
    expect(parseMajorToMinor("0.1")).toBe(10);
    expect(parseMajorToMinor("1.005")).toBe(101);
    expect(parseMajorToMinor("195000", "PKR")).toBe(19500000);
  });
  it("converts PKR to USD at the transaction rate", () => {
    expect(convertToUsdCents(19500000, "PKR", "280")).toBe(69643); // PKR 195,000 -> $696.43
    expect(convertToUsdCents(5000000, "PKR", "278.5")).toBe(17953);
    expect(convertToUsdCents(12345, "USD", "280")).toBe(12345);
  });
  it("formats money", () => {
    expect(formatMoney(400000)).toBe("$4,000.00");
    expect(formatMoney(-12345)).toBe("-$123.45");
    expect(formatMoney(19500000, "PKR")).toBe("Rs 195,000");
  });
});
