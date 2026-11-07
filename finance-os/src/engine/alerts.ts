import Decimal from "decimal.js";
import { formatMoney } from "@/lib/money";
import { dateLabel, lastNMonths, todayKey } from "@/lib/dates";
import { upcomingRenewals, subscriptionTrend, monthlyCostUsd } from "./expenses";
import { invoiceOutstanding, invoiceStatus } from "./revenue";
import type { Alert, EngineData, MonthSnapshot } from "./types";

const usd = (c: number) => formatMoney(c, "USD");

/**
 * Alert engine. Every alert explains what happened, why it matters, the
 * financial impact and the action to take. Thresholds include tolerances so
 * ordinary fluctuations do not generate noise.
 */
export function buildAlerts(data: EngineData, snap: MonthSnapshot, today = todayKey()): Alert[] {
  const alerts: Alert[] = [];
  const s = data.settings;
  const rev = snap.revenue;
  const ex = snap.expenses;

  if (!snap.policyValid) {
    alerts.push({
      key: "policy-invalid",
      level: "critical",
      title: "Allocation policy does not add up to 100%",
      what: `The active policy "${snap.policy.name}" has percentages that do not sum to 100%.`,
      why: "Allocations are disabled until the policy is valid, so targets on this page are zero.",
      impact: "No guidance on owner pay, tax or reserves this month.",
      action: "Fix the percentages in Settings. The system never changes them silently.",
      href: "/settings/",
    });
  }

  // Operating expenses vs ceiling (tolerance: 2% over before caution; 10% over critical)
  if (ex.ceiling > 0 && ex.overheadActual > ex.ceiling) {
    const over = ex.overheadActual - ex.ceiling;
    const overPct = new Decimal(over).div(ex.ceiling).mul(100);
    if (overPct.gt(2)) {
      alerts.push({
        key: "opex-over-ceiling",
        level: overPct.gt(10) ? "critical" : "caution",
        title: "Operating expenses exceed the monthly ceiling",
        what: `Overhead spend is ${usd(ex.overheadActual)} against a ceiling of ${usd(ex.ceiling)} (${overPct.toFixed(0)}% over).`,
        why: "Overhead above the ceiling is funded from money earmarked for owner pay, tax or reserves.",
        impact: `${usd(over)} has effectively been taken from other allocations this month.`,
        action: "Cancel or defer non-essential subscriptions, or document and approve a higher ceiling in Settings if a growth decision justifies it.",
        href: "/expenses/",
      });
    }
  } else if (ex.ceiling > 0 && rev.netDistributable > 0 && ex.committedSubscriptionsMonthly > ex.ceiling) {
    alerts.push({
      key: "committed-over-ceiling",
      level: "caution",
      title: "Committed subscriptions exceed the operating ceiling",
      what: `Active subscriptions total ${usd(ex.committedSubscriptionsMonthly)}/month; this month's ceiling is ${usd(ex.ceiling)}.`,
      why: "Even before one-off purchases, recurring costs will breach the allowance.",
      impact: `${usd(ex.committedSubscriptionsMonthly - ex.ceiling)} per month of structural overspend.`,
      action: "Review the subscription list and cut or downgrade tools that do not produce revenue.",
      href: "/expenses/",
    });
  }

  // Subscription spending trend (3 consecutive rising months, > 10% total)
  const trend = subscriptionTrend(data.transactions, lastNMonths(snap.month, 3));
  if (trend.every((t) => t.amount > 0) && trend[2].amount > trend[1].amount && trend[1].amount > trend[0].amount) {
    const growth = new Decimal(trend[2].amount - trend[0].amount).div(trend[0].amount).mul(100);
    if (growth.gt(10)) {
      alerts.push({
        key: "subscription-creep",
        level: "info",
        title: "Subscription spending is increasing",
        what: `Recurring tool spend rose from ${usd(trend[0].amount)} to ${usd(trend[2].amount)} over three months (+${growth.toFixed(0)}%).`,
        why: "Subscription creep is the most common way lean agencies lose margin.",
        impact: `${usd(trend[2].amount - trend[0].amount)} more per month than three months ago.`,
        action: "Check each new subscription has a documented justification and ROI.",
        href: "/expenses/",
      });
    }
  }

  // Household vs budget (5% tolerance)
  const hh = snap.owner;
  if (hh.householdBudget > 0 && hh.householdActual > new Decimal(hh.householdBudget).mul(1.05).toNumber()) {
    alerts.push({
      key: "household-over-budget",
      level: hh.householdActual > hh.householdBudget * 1.25 ? "caution" : "info",
      title: "Household spending exceeds its budget",
      what: `Household spending is ${usd(hh.householdActual)} against a ${usd(hh.householdBudget)} budget.`,
      why: "Household costs come out of owner compensation first, so overspend shrinks discretionary income one for one.",
      impact: `Discretionary room reduced by ${usd(hh.householdActual - hh.householdBudget)}.`,
      action: "Check utilities and food lines; if the overspend is structural, update the household budget rather than ignoring it.",
      href: "/personal/",
    });
  }
  if (hh.target > 0 && hh.remainingPersonalBudget < 0) {
    alerts.push({
      key: "discretionary-over-budget",
      level: -hh.remainingPersonalBudget > hh.target * 0.1 ? "caution" : "info",
      title: "Personal spending exceeds owner compensation",
      what: `Household plus discretionary spending is ${usd(hh.householdActual + hh.discretionaryActual)} against owner compensation of ${usd(hh.target)}.`,
      why: "Spending beyond compensation is funded from business cash or past savings.",
      impact: `${usd(-hh.remainingPersonalBudget)} over budget this month.`,
      action: "Pause discretionary purchases until next month's allocation.",
      href: "/personal/",
    });
  }
  if (hh.drawn > hh.target && hh.target > 0 && hh.drawn - hh.target > hh.target * 0.05) {
    alerts.push({
      key: "owner-draw-over-target",
      level: "caution",
      title: "Owner draws exceed this month's compensation target",
      what: `You have drawn ${usd(hh.drawn)}; the target is ${usd(hh.target)}.`,
      why: "Extra draws come out of tax, reserve or profit money that has not been set aside yet.",
      impact: `${usd(hh.drawn - hh.target)} drawn ahead of allocation.`,
      action: "Treat the excess as an advance against next month, or reduce next month's draw.",
      href: "/personal/",
    });
  }

  // Reserves
  const res = snap.reserve;
  if (res.essentialMonthly > 0) {
    const coverage = new Decimal(res.balance).div(res.essentialMonthly);
    if (coverage.lt(1)) {
      alerts.push({
        key: "reserve-low",
        level: coverage.lt(0.5) ? "critical" : "caution",
        title: "Cash reserves are below one month of essential expenses",
        what: `Reserve envelope holds ${usd(res.balance)}, covering ${coverage.toFixed(1)} month(s) of essential costs (${usd(res.essentialMonthly)}/month).`,
        why: "One slow month or one late client payment would force cuts or personal cash injections.",
        impact: `${usd(Math.max(0, res.essentialMonthly - res.balance))} short of one month's cover; target is ${usd(res.target)}.`,
        action: "Close the month to book the reserve allocation, redirect unspent operating allowance to reserves, and hold off on hiring or new recurring costs.",
        href: "/reserves/",
      });
    }
  }

  // Tax reserve funding (virtual envelope vs real account)
  const tax = snap.tax;
  if (tax.envelopeBalance > 0 && tax.fundedBalance < new Decimal(tax.envelopeBalance).mul(0.95).toNumber()) {
    alerts.push({
      key: "tax-underfunded",
      level: tax.fundedBalance < tax.envelopeBalance * 0.5 ? "critical" : "caution",
      title: "Tax reserve is below target",
      what: `Allocations say ${usd(tax.envelopeBalance)} should be set aside for tax, but the tax account holds ${usd(tax.fundedBalance)}.`,
      why: "Virtual allocations are not cash. If the money is still in operating, it tends to get spent.",
      impact: `${usd(tax.envelopeBalance - tax.fundedBalance)} of tax money is not physically reserved.`,
      action: "Transfer the difference to the tax reserve account and record the transfer.",
      href: "/accounts/",
    });
  }

  // Client concentration
  const conc = snap.concentration;
  if (conc.largestSharePct) {
    const share = new Decimal(conc.largestSharePct);
    const crit = new Decimal(s.concentrationCriticalPct);
    const warn = new Decimal(s.concentrationWarnPct);
    if (share.gte(crit)) {
      alerts.push({
        key: "concentration-critical",
        level: "critical",
        title: "Severe client concentration",
        what: `${conc.largestClientName} represents ${share.toFixed(0)}% of agency revenue.`,
        why: "Losing this client would remove most of your income at once.",
        impact: `Up to ${usd(rev.netDistributable)} of monthly revenue depends on a single relationship.`,
        action: "Prioritise acquiring a second and third client before scaling fixed costs. Keep reserves higher than the standard target.",
        href: "/clients/",
      });
    } else if (share.gte(warn)) {
      alerts.push({
        key: "concentration-high",
        level: "caution",
        title: "Client concentration is high",
        what: `${conc.largestClientName} represents ${share.toFixed(0)}% of agency revenue.`,
        why: "Above 50% a single client dispute or churn event threatens solvency.",
        impact: "Revenue volatility is tied to one client's performance.",
        action: "Keep lead generation running and diversify agreement types (retainers alongside revenue share).",
        href: "/clients/",
      });
    }
  }

  // Overdue invoices
  const overdue = data.invoices.filter((i) => invoiceStatus(i, data.transactions, today, s.invoiceOverdueGraceDays) === "overdue");
  if (overdue.length > 0) {
    const total = overdue.reduce((a, i) => a + invoiceOutstanding(i, data.transactions), 0);
    const oldest = overdue.slice().sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
    alerts.push({
      key: "invoices-overdue",
      level: total > rev.netDistributable * 0.5 && total > 0 ? "critical" : "caution",
      title: `${overdue.length} client payment${overdue.length > 1 ? "s" : ""} overdue`,
      what: `${usd(total)} is past due; the oldest was due ${dateLabel(oldest.dueDate)}.`,
      why: "Earned revenue is not allocatable until it is collected.",
      impact: `${usd(total)} of expected allocations are on hold.`,
      action: "Send a payment reminder today and confirm the client's payout date.",
      href: "/clients/",
    });
  }

  // Processor holds
  const held = data.reserves.filter((r) => r.status === "held");
  if (held.length > 0) {
    const total = held.reduce((a, r) => a + r.amountUsdCents, 0);
    const unknown = held.filter((r) => !r.expectedReleaseDate).length;
    alerts.push({
      key: "processor-reserve",
      level: total > rev.netDistributable * 0.25 && total > 0 ? "caution" : "info",
      title: "A payment processor is holding funds",
      what: `${usd(total)} is held in restricted balances across ${held.length} reserve record${held.length > 1 ? "s" : ""}${unknown ? `, ${unknown} without a known release date` : ""}.`,
      why: "Restricted funds are not spendable and are excluded from allocations until released.",
      impact: `${usd(total)} of collected revenue is unavailable.`,
      action: "Check the processor dashboard for release dates and record them so the cash-flow forecast stays accurate.",
      href: "/whop/",
    });
  }

  // Upcoming renewals
  const renewals = upcomingRenewals(data.recurringExpenses, today, s.renewalReminderDays);
  for (const r of renewals) {
    const cost = monthlyCostUsd(r, s);
    alerts.push({
      key: `renewal-${r.id}`,
      level: "info",
      title: `${r.name} renews ${dateLabel(r.nextRenewalDate)}`,
      what: `${r.name} (${formatMoney(r.amountMinor, r.currency as "USD")} ${r.frequency}) renews soon.`,
      why: "Renewal is the moment to decide whether a tool still earns its cost.",
      impact: `${usd(cost)}/month of operating allowance.`,
      action: r.justification ? `Confirm it still delivers: "${r.justification}"` : "Add a business justification or cancel before renewal.",
      href: "/expenses/",
    });
  }

  // Unconfigured expenses
  const needsConfig = data.recurringExpenses.filter((r) => r.status === "needs_config");
  if (needsConfig.length > 0) {
    alerts.push({
      key: "expenses-need-config",
      level: "info",
      title: `${needsConfig.length} expense${needsConfig.length > 1 ? "s need" : " needs"} configuration`,
      what: `${needsConfig.map((r) => r.name).join(", ")} ${needsConfig.length > 1 ? "have" : "has"} no amount set.`,
      why: "Unknown recurring costs make the operating ceiling and reserve target understated.",
      impact: "Essential monthly cost and runway are approximate until set.",
      action: "Enter the real plan price and activate the subscription.",
      href: "/expenses/",
    });
  }

  // Compliance deadlines (30 days)
  for (const c of data.complianceItems) {
    if (!c.applicable || c.status === "done" || c.status === "not_applicable" || !c.dueDate) continue;
    const days = Math.ceil((new Date(c.dueDate).getTime() - new Date(today).getTime()) / 86400000);
    if (days <= 30) {
      alerts.push({
        key: `compliance-${c.id}`,
        level: days < 0 ? "critical" : days <= 7 ? "caution" : "info",
        title: days < 0 ? `${c.title} is overdue` : `${c.title} due in ${days} day${days === 1 ? "" : "s"}`,
        what: `${c.title} (${c.jurisdiction}) is due ${dateLabel(c.dueDate)}.`,
        why: "Missed filings carry penalties; US Form 5472 penalties start at $25,000.",
        impact: "Potential penalties and compliance risk.",
        action: "Complete the filing or confirm with your accountant, then mark it done.",
        href: "/tax/",
      });
    }
  }

  // Hire affordability for proposed hires
  for (const g of data.growthProposals) {
    if (g.type !== "hire" || g.status !== "proposed" || !g.evaluationJson) continue;
    try {
      const ev = JSON.parse(g.evaluationJson) as { verdict?: string };
      if (ev.verdict === "not_recommended") {
        alerts.push({
          key: `hire-${g.id}`,
          level: "caution",
          title: `The business cannot safely afford "${g.name}" yet`,
          what: `The proposed hire costs ${usd(g.monthlyCostUsdCents)}/month and failed the affordability evaluation.`,
          why: "Hiring on cash availability alone, before reserves and margin support it, is the fastest way to a cash crisis.",
          impact: `${usd(g.monthlyCostUsdCents)} of new fixed monthly cost.`,
          action: "Re-run the evaluation after reserves reach one month and the hire has revenue or capacity attached.",
          href: "/growth/",
        });
      }
    } catch {
      /* ignore malformed */
    }
  }

  // Zero revenue month with spending
  if (rev.collected === 0 && (ex.overheadActual > 0 || hh.drawn > 0) && snap.month <= today.slice(0, 7)) {
    alerts.push({
      key: "no-revenue",
      level: snap.month < today.slice(0, 7) ? "critical" : "caution",
      title: "No revenue collected this month",
      what: `Nothing has been collected in ${snap.month} while ${usd(ex.overheadActual + hh.drawn)} has gone out.`,
      why: "Allocations are based on collected revenue, so every target is zero and all spending draws down reserves.",
      impact: `Negative cash flow of ${usd(ex.overheadActual + ex.directDeliveryActual + ex.growthActual + hh.drawn)}.`,
      action: "Chase outstanding invoices, record any collections, and limit draws to what reserves can support.",
      href: "/transactions/",
    });
  }

  // Snoozes
  const snoozed = new Map(data.snoozes.map((x) => [x.alertKey, x.snoozedUntil]));
  const order = { critical: 0, caution: 1, info: 2 };
  return alerts.filter((a) => !(snoozed.get(a.key) && snoozed.get(a.key)! >= today)).sort((a, b) => order[a.level] - order[b.level]);
}
