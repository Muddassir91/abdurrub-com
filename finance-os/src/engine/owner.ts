import type { Category, HouseholdBudgetLine, Settings, Transaction } from "@/db/schema";
import { convertToUsdCents, type CurrencyCode, type Minor } from "@/lib/money";
import type { OwnerMetrics } from "./types";

export function householdLinesUsd(lines: HouseholdBudgetLine[], settings: Settings): Minor {
  return lines.filter((l) => l.isActive).reduce((a, l) => a + convertToUsdCents(l.amountMinor, l.currency as CurrencyCode, l.currency === "USD" ? "1" : settings.defaultFxRatePkrPerUsd), 0);
}

export function householdLinesMinor(lines: HouseholdBudgetLine[]): Minor {
  return lines.filter((l) => l.isActive).reduce((a, l) => a + l.amountMinor, 0);
}

/**
 * Owner compensation view for a month.
 *
 * Owner compensation is a TOTAL budget. Household spending is paid out of it
 * first; what remains is discretionary. Owner draws are the cash actually moved
 * from the business to the personal account; they are transfers, never spend,
 * so household/personal expenses are never counted twice.
 */
export function computeOwner(month: string, transactions: Transaction[], lines: HouseholdBudgetLine[], categories: Category[], settings: Settings, ownerTarget: Minor): OwnerMetrics {
  const rows = transactions.filter((t) => t.month === month);
  const drawn = rows.filter((t) => t.type === "owner_draw" || t.type === "profit_distribution").reduce((a, t) => a + t.amountUsdCents, 0);
  const household = rows.filter((t) => t.type === "household_expense");
  const personal = rows.filter((t) => t.type === "personal_expense");
  const householdActual = household.reduce((a, t) => a + t.amountUsdCents, 0);
  const householdActualPkr = household.reduce((a, t) => {
    if (t.currency === "PKR") return a + t.amountMinor;
    return a + Math.round(t.amountUsdCents * Number(settings.defaultFxRatePkrPerUsd));
  }, 0);
  const discretionaryActual = personal.reduce((a, t) => a + t.amountUsdCents, 0);
  const householdBudget = settings.householdBudgetUsdCents;
  const householdLinesBudget = householdLinesUsd(lines, settings);
  const discretionaryAvailable = ownerTarget - householdActual;
  const remainingPersonalBudget = ownerTarget - householdActual - discretionaryActual;
  const personalSavings = drawn - householdActual - discretionaryActual;
  const discretionaryGoal = settings.discretionaryGoalUsdCents;

  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const byCat = new Map<string | null, Minor>();
  for (const t of [...household, ...personal]) byCat.set(t.categoryId ?? null, (byCat.get(t.categoryId ?? null) ?? 0) + t.amountUsdCents);
  const byCategory = [...byCat.entries()]
    .map(([categoryId, amount]) => ({ categoryId, name: categoryId ? (catName.get(categoryId) ?? "Unknown") : "Uncategorised", amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    target: ownerTarget,
    drawn,
    undrawn: ownerTarget - drawn,
    householdBudget,
    householdLinesBudget,
    householdActual,
    householdActualPkr,
    discretionaryActual,
    discretionaryAvailable,
    remainingPersonalBudget,
    personalSavings,
    discretionaryGoal,
    discretionaryGoalGap: Math.max(0, discretionaryGoal - Math.max(0, discretionaryAvailable)),
    byCategory,
  };
}

export function personalSpendTrend(transactions: Transaction[], months: string[]): { month: string; household: Minor; discretionary: Minor; drawn: Minor }[] {
  return months.map((m) => {
    const rows = transactions.filter((t) => t.month === m);
    return {
      month: m,
      household: rows.filter((t) => t.type === "household_expense").reduce((a, t) => a + t.amountUsdCents, 0),
      discretionary: rows.filter((t) => t.type === "personal_expense").reduce((a, t) => a + t.amountUsdCents, 0),
      drawn: rows.filter((t) => t.type === "owner_draw" || t.type === "profit_distribution").reduce((a, t) => a + t.amountUsdCents, 0),
    };
  });
}
