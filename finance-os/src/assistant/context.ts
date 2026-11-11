import type { EngineData, MonthSnapshot } from "@/engine/types";
import { accountBalance, isBusinessSpend, isPersonalSpend, isRevenue } from "@/engine/ledger";
import { minorToMajor, type CurrencyCode, type Minor } from "@/lib/money";
import { parseUi, SECTION_LABELS } from "@/lib/ui";
import { currentAnswers } from "@/onboarding/derive";
import { nextSteps } from "@/engine/nextSteps";

/**
 * The summary the language model sees: this month's figures, budgets, recent
 * entries and settings, as short labelled lines. Amounts are plain numbers in
 * the workspace's base currency unless a currency code follows them. This is
 * the only data that leaves the device, and only when a message needs the model.
 */
export function buildContext(data: EngineData, snap: MonthSnapshot, month: string, today: string): string {
  const base = data.settings.baseCurrency as CurrencyCode;
  const home = data.settings.householdCurrency as CurrencyCode;
  const n = (m: Minor, c: CurrencyCode = base) => {
    const d = minorToMajor(m, c);
    return d.isInteger() ? d.toFixed(0) : d.toFixed(2);
  };
  const a = currentAnswers(data);
  const ex = snap.expenses;
  const own = snap.owner;
  const p = snap.policy;
  const weekday = new Date(`${today}T12:00:00`).toLocaleDateString("en", { weekday: "long" });
  const businessSpend = ex.overheadActual + ex.directDeliveryActual + ex.growthActual;
  const personalSpend = own.householdActual + own.discretionaryActual;
  const homeBudget = own.householdBudget > 0 ? own.householdBudget : own.householdLinesBudget;
  const cats = [...ex.byCategory, ...own.byCategory].filter((c) => c.amount > 0).sort((x, y) => y.amount - x.amount);
  const catName = new Map(data.categories.map((c) => [c.id, c.name]));
  const recent = data.transactions.slice(0, 12).map((t) => {
    const dir = isRevenue(t) ? "in" : isBusinessSpend(t) ? "out business" : isPersonalSpend(t) ? "out personal" : t.type.replace(/_/g, " ");
    return `${t.date} ${dir} ${n(t.amountMinor, t.currency)} ${t.currency} "${t.description}"${t.categoryId ? ` [${catName.get(t.categoryId) ?? ""}]` : ""}`;
  });
  const ui = parseUi(data.settings.uiJson);
  const shown = ui.dashboard.order.filter((s) => !ui.dashboard.hidden.includes(s));
  const bal = (role: string) => {
    const acc = data.accounts.find((x) => x.role === role && !x.isArchived);
    return acc ? `${n(accountBalance(acc, data.transactions, data.settings), acc.currency)} ${acc.currency}` : "none";
  };
  const lines = [
    `today: ${today} (${weekday}); month on screen: ${month}`,
    `person: ${data.settings.ownerName}; business: ${data.settings.businessName}; kind: ${a.persona}`,
    `currencies: earns in ${base}; spends at home in ${home}${base === home ? "" : ` (${data.settings.defaultFxRatePkrPerUsd} ${home} = 1 ${base})`}. Amounts below are ${base} unless marked.`,
    `split %: running costs ${p.opexPct}, your pay ${p.ownerPct}, tax ${p.taxPct}, profit ${p.profitPct}, cushion ${p.reservePct}, growth ${p.growthPct}`,
    `usual monthly income: ${a.monthlyIncomeMinor > 0 ? n(a.monthlyIncomeMinor) : "not set"}`,
    `this month: collected ${n(snap.revenue.collected)}, fees ${n(snap.revenue.totalFees)}, money in after fees ${n(snap.revenue.netDistributable)}, business spending ${n(businessSpend)}, personal spending ${n(personalSpend)}, kept ${n(ex.netResultAfterOwnerPay)}`,
    `budgets: running costs ${n(ex.overheadActual)} spent of ${n(ex.ceiling)} ceiling; home essentials ${n(own.householdActual)} spent of ${n(homeBudget)}; your pay ${n(own.drawn)} taken of ${n(own.target)}`,
    `set aside: tax account ${n(snap.tax.fundedBalance)} (split puts ${n(snap.tax.target)} toward tax this month); cushion ${n(snap.reserve.fundedBalance)} of ${n(snap.reserve.target)} target; profit kept ${n(Math.max(0, snap.profit.cumulativeRetained))}`,
    `cash: business ${bal("operating")}; personal ${bal("personal")}; runway ${snap.cash.runwayMonths ?? "unknown"} months`,
    `spending by category this month: ${cats.length ? cats.slice(0, 10).map((c) => `${c.name} ${n(c.amount)}`).join("; ") : "none yet"}`,
    `subscriptions: ${data.recurringExpenses.filter((r) => r.status === "active").map((r) => `${r.name} ${n(r.amountMinor, r.currency)} ${r.currency} ${r.frequency}`).join("; ") || "none"}`,
    `home budget lines: ${data.householdLines.filter((l) => l.isActive && l.amountMinor > 0).map((l) => `${l.name} ${n(l.amountMinor, l.currency)} ${l.currency}`).join("; ") || "none"}`,
    `clients: ${data.clients.filter((c) => c.status === "active").map((c) => c.name).join("; ") || "none"}`,
    `business categories: ${data.categories.filter((c) => c.scope === "business").map((c) => c.name).join(", ")}`,
    `personal categories: ${data.categories.filter((c) => c.scope === "personal").map((c) => c.name).join(", ")}`,
    `goals: ${a.goals.join(", ") || "none picked"}`,
    `dashboard shows: ${shown.map((s) => SECTION_LABELS[s]).join(", ")}; hidden: ${ui.dashboard.hidden.map((s) => SECTION_LABELS[s]).join(", ") || "nothing"}; trackers: ${ui.dashboard.trackers.map((t) => t.label).join(", ") || "none"}`,
    `to do next: ${nextSteps(data, snap, today, month).map((x) => x.title).join("; ") || "nothing outstanding"}`,
    `recent entries, newest first:`,
    ...(recent.length ? recent : ["(none)"]),
  ];
  return lines.join("\n").slice(0, 6000);
}
