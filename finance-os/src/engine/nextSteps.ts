import { addMonths, currentMonthKey, dateLabel, daysBetween, monthLabel } from "@/lib/dates";
import { formatMoney, minorToMajor, type CurrencyCode, type Minor } from "@/lib/money";
import { currentAnswers } from "@/onboarding/derive";
import { isPersonal } from "@/onboarding/model";
import { upcomingRenewals } from "./expenses";
import type { EngineData, MonthSnapshot } from "./types";

/**
 * "What do I do with all this?" — up to three plain next steps drawn from the
 * person's own numbers and their own split. Each one states a fact and offers
 * one tap to act on it. Nothing here is advice; it only points at gaps between
 * what the person set up and what the ledger shows.
 */
export interface NextStep {
  id: string;
  title: string;
  detail: string;
  cta: string;
  /** A command to run through the assistant when tapped. */
  say?: string;
  href?: string;
  setupStep?: string;
  quickAdd?: "in" | "out";
}

const plain = (minor: Minor, currency: CurrencyCode) => {
  const d = minorToMajor(minor, currency);
  return d.isInteger() ? d.toFixed(0) : d.toFixed(2);
};

export function nextSteps(data: EngineData, snap: MonthSnapshot, today: string, month: string): NextStep[] {
  const base = data.settings.baseCurrency as CurrencyCode;
  const fmt = (m: Minor) => formatMoney(m, base, { decimals: minorToMajor(m, base).isInteger() ? 0 : undefined });
  const personal = isPersonal(currentAnswers(data));
  const isCurrent = month === currentMonthKey() || month === today.slice(0, 7);
  const rows = data.transactions.filter((t) => t.month === month);
  const steps: NextStep[] = [];

  if (rows.length === 0) {
    steps.push({ id: "first-entry", title: `Add what came in during ${monthLabel(month, "long")}`, detail: "One payment is enough to start. Your split, budgets and charts fill in from it.", cta: "Add money in", quickAdd: "in" });
    steps.push({ id: "first-spend", title: "Add something you paid for", detail: "A tool, a bill, lunch. Type it in the box above or tap the plus.", cta: "Add money out", quickAdd: "out" });
    if (data.householdLines.filter((l) => l.isActive && l.amountMinor > 0).length === 0 && data.settings.householdBudgetUsdCents === 0) steps.push({ id: "home-budget", title: "Set what you need at home each month", detail: "Rent, groceries, bills. It becomes the bar your home spending fills.", cta: "Set it", setupStep: "household" });
    return steps.slice(0, 3);
  }

  if (isCurrent) {
    const last = rows.reduce((d, t) => (t.date > d ? t.date : d), "");
    const gap = last ? daysBetween(last, today) : 0;
    if (gap >= 3) steps.push({ id: "stale", title: `Anything since ${dateLabel(last)}?`, detail: `Your last entry was ${gap} days ago. Add what came in or went out so the numbers stay true.`, cta: "Add it", quickAdd: "out" });
  }

  const ex = snap.expenses;
  if (ex.ceiling > 0 && ex.overheadActual > ex.ceiling) steps.push({ id: "over-ceiling", title: `${personal ? "Bills" : "Running costs"} are ${fmt(ex.overheadActual - ex.ceiling)} over this month's ceiling`, detail: `Your ceiling is ${fmt(ex.ceiling)} and ${fmt(ex.overheadActual)} has gone out.`, cta: "See what's in there", href: "/app/expenses/" });

  const taxGap = snap.tax.envelopeBalance + snap.tax.target - snap.tax.fundedBalance;
  if (snap.allocations.tax > 0 && taxGap > 0) steps.push({ id: "tax", title: `${fmt(taxGap)} of tax is not set aside yet`, detail: `Your split puts ${fmt(snap.tax.target)} of this month toward tax. Your tax account holds ${fmt(snap.tax.fundedBalance)}.`, cta: "I moved it", say: `moved ${plain(taxGap, base)} to tax` });

  if (!personal && snap.owner.target > 0 && snap.owner.drawn < snap.owner.target) steps.push({ id: "pay", title: `${fmt(snap.owner.target - snap.owner.drawn)} of your pay is still in the business`, detail: `Your share this month is ${fmt(snap.owner.target)}. You have taken ${fmt(snap.owner.drawn)}.`, cta: "I paid myself", say: `paid myself ${plain(snap.owner.target - snap.owner.drawn, base)}` });

  const renewals = upcomingRenewals(data.recurringExpenses, today, 7);
  if (isCurrent && renewals.length > 0) steps.push({ id: "renewals", title: `${renewals.length} renewal${renewals.length === 1 ? "" : "s"} in the next 7 days`, detail: renewals.slice(0, 3).map((r) => `${r.name} ${formatMoney(r.amountMinor, r.currency)}`).join(" · "), cta: "See them", href: "/app/expenses/" });

  const savings = data.accounts.find((a) => a.role === "savings");
  const movedToCushion = savings ? rows.filter((t) => t.type === "transfer" && t.toAccountId === savings.id).reduce((a, t) => a + t.amountUsdCents, 0) : 0;
  if (!personal && snap.allocations.reserve > movedToCushion && snap.reserve.fundedBalance < snap.reserve.target) steps.push({ id: "cushion", title: `${fmt(snap.allocations.reserve - movedToCushion)} of this month is meant for your cushion`, detail: `Your cushion holds ${fmt(snap.reserve.fundedBalance)} of a ${fmt(snap.reserve.target)} target.`, cta: "I moved it", say: `moved ${plain(snap.allocations.reserve - movedToCushion, base)} to cushion` });

  const prev = addMonths(month, -1);
  if (isCurrent && !personal && data.transactions.some((t) => t.month === prev) && !data.monthCloses.some((c) => c.month === prev && c.status === "closed")) steps.push({ id: "close", title: `${monthLabel(prev, "long")} is not closed yet`, detail: "Closing books the month's split into your envelopes and locks its entries.", cta: "Close it", href: "/app/month-end/" });

  if (data.householdLines.filter((l) => l.isActive && l.amountMinor > 0).length === 0 && data.settings.householdBudgetUsdCents === 0) steps.push({ id: "home-budget", title: "Set what you need at home each month", detail: "Rent, groceries, bills. It becomes the bar your home spending fills.", cta: "Set it", setupStep: "household" });

  return steps.slice(0, 3);
}
