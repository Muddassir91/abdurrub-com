import type { EngineData, MonthSnapshot } from "@/engine/types";
import { accountBalance, inMonth, isBusinessSpend, isPersonalSpend, isRevenue, sumUsd } from "@/engine/ledger";
import { formatMoney, type CurrencyCode, type Minor } from "@/lib/money";
import { nextSteps } from "@/engine/nextSteps";

/**
 * Answers the common questions about the person's own numbers on the device,
 * with no model and no network: "how much is left for running costs?",
 * "what did I spend on food?", "how much can I pay myself?", "what next?".
 *
 * It reads the same figures the dashboard shows and only reports them. It
 * never recommends anything. Questions about another period, or anything it
 * does not recognise, return null and go to the language model.
 */

const OTHER_PERIOD = /\b(last|previous|next|past)\s+(month|week|year|quarter)\b|\b(this|per)\s+(week|year|quarter)\b|\byesterday\b|\b(january|february|march|april|june|july|august|september|october|november|december)\b|\b20\d\d\b|\bcompared?\b|\bversus\b|\bvs\b|\baverage\b|\btrend\b/;
const QUESTION = /\?|^(how|what|whats|what's|where|which|who|when|am|is|are|do|does|did|can|could|show|tell|give|list|any)\b/;

export function answerLocal(message: string, data: EngineData, snap: MonthSnapshot, month: string, today: string): string | null {
  const q = message
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^(?:(?:hey|hi|hello|ok|okay|so|please|pls|yo|cfoh!?|and|btw)[,!]?\s+)+/, "")
    .replace(/^(?:can|could|would) you (?:please )?/, "")
    .replace(/^(?:please )?(?:show|tell|give) me (?=how|what|where|which)/, "")
    .replace(/\s+/g, " ")
    .trim();
  const bare = q.replace(/[?.!]+$/, "").trim();
  if (!bare) return null;

  const base = data.settings.baseCurrency as CurrencyCode;
  const fm = (m: Minor, c: CurrencyCode) => formatMoney(m, c).replace(/\.00$/, "");
  const f = (m: Minor) => fm(m, base);
  const name = (data.settings.ownerName || "").split(" ")[0];
  const ex = snap.expenses;
  const own = snap.owner;
  const p = snap.policy;

  // Small talk and help need no numbers.
  if (/^(hi|hello|hey|salam|salaam|assalam o alaikum|good (morning|afternoon|evening))$/.test(bare)) {
    return `Hi${name ? ` ${name}` : ""}. Tell me what happened, like "spent 20 on lunch" or "got paid 1,200", or ask about your numbers.`;
  }
  if (/^(who|what) are you$|^what('s| is) your name$|^are you (a |an )?(bot|ai|robot|human)$|^what('s| is) (cfoh!?|this|this app)$/.test(bare)) {
    return "I'm CFoh!. I record your money when you tell me what happened, change your setup and dashboard when you ask, and answer questions from your own numbers.";
  }
  if (/^(help|what can (you|i) do|what can i (ask|say)|how (do|can) i use (this|you|it|cfoh!?)|how does (this|it) work|what do you do|commands|examples?)$/.test(bare)) {
    return [
      "Just say it in plain words. For example:",
      '• "spent 20 on lunch" or "got paid 1,200 from Harbor"',
      '• "paid myself 500" or "moved 300 to tax"',
      '• "how much is left?", "what did I spend?", "what next?"',
      '• "simple dashboard", "track food under 300", "review my setup"',
      '• "undo" reverses the last change.',
    ].join("\n");
  }
  if (/^(thanks|thank you|thx|ty|great|nice|cool|ok|okay|got it|perfect)$/.test(bare)) return "Anytime.";

  if (!QUESTION.test(q) && !/^(my |summary|overview|status|recap|catch me up|balance|runway|subscriptions|split|profit|next)/.test(bare)) return null;
  // Advice, how-to questions and commands are not lookups.
  if (/^(should|shall|why)\b|\bafford\b|\bworth it\b|^how (do|can|should|would) (i|we)\b|^(add|set|change|update|remove|delete|make|create|hide|track|record|log|edit|fix|move|cancel)\b/.test(bare)) return null;

  const businessSpend = ex.overheadActual + ex.directDeliveryActual + ex.growthActual;
  const personalSpend = own.householdActual + own.discretionaryActual;
  const homeBudget = own.householdBudget > 0 ? own.householdBudget : own.householdLinesBudget;
  const cats = [...ex.byCategory, ...own.byCategory].filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  const left = (limit: Minor, used: Minor) => (limit - used >= 0 ? `${f(limit - used)} is left` : `you are ${f(used - limit)} over`);
  const steps = () => nextSteps(data, snap, today, month);
  const balance = (role: string) => {
    const acc = data.accounts.find((a) => a.role === role && !a.isArchived);
    return acc ? fm(accountBalance(acc, data.transactions, data.settings), acc.currency as CurrencyCode) : null;
  };

  // What to do next (the app's own list).
  if (/\bwhat('s| is)? next\b|\bwhat (should|do|can) i do( next| now| first| today)?$|\bwhat now\b|\bwhat needs (my )?attention\b|\bto.?do\b|\banything (i need|to do|pending|outstanding)\b|^next( steps?)?$|\bwhere (do|should) i start\b/.test(bare)) {
    const list = steps().slice(0, 3);
    if (!list.length) return "Nothing is waiting on you right now.";
    return ["Next on your list:", ...list.map((s, i) => `${i + 1}. ${s.title}${s.detail ? `${/[.?!]$/.test(s.title) ? "" : "."} ${s.detail}` : ""}`)].join("\n");
  }

  if (OTHER_PERIOD.test(bare)) return null;

  // Left to spend.
  if (/\b(left|remaining|remain)\b|\bhow much (more )?can i spend\b|\bam i (over|under|within)\b|\bover (my |the )?(budget|limit|ceiling)\b/.test(bare)) {
    const tracker = parseTrackerLeft(bare, data, cats, f);
    if (tracker) return tracker;
    if (/\b(pay|salary|myself|draw)\b/.test(bare)) return `Your pay share this month is ${f(own.target)}. You have taken ${f(own.drawn)}, so ${f(Math.max(0, own.target - own.drawn))} is still in the business.`;
    if (/\b(home|house|household|personal|essentials?|family)\b/.test(bare)) return homeBudget > 0 ? `Home essentials: ${f(own.householdActual)} spent of ${f(homeBudget)}, so ${left(homeBudget, own.householdActual)} this month.` : `You have spent ${f(own.householdActual)} on home essentials this month. No home budget is set yet.`;
    if (/\b(running|business|costs?|overheads?|opex|operating|ceiling|expenses?)\b/.test(bare)) return ex.ceiling > 0 ? `Running costs: ${f(ex.overheadActual)} spent of a ${f(ex.ceiling)} ceiling, so ${left(ex.ceiling, ex.overheadActual)} this month.` : `You have spent ${f(ex.overheadActual)} on running costs this month. The ceiling appears once money comes in.`;
    const named = cats.find((c) => new RegExp(`\\b${c.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(bare));
    if (named) return `${named.name}: ${f(named.amount)} spent this month. No limit is set for it. Say "track ${named.name.toLowerCase()} under 300" to add one.`;
    const parts = [];
    if (ex.ceiling > 0) parts.push(`Running costs: ${left(ex.ceiling, ex.overheadActual)} of ${f(ex.ceiling)}.`);
    if (homeBudget > 0) parts.push(`Home essentials: ${left(homeBudget, own.householdActual)} of ${f(homeBudget)}.`);
    if (own.target > 0) parts.push(`Your pay: ${f(Math.max(0, own.target - own.drawn))} not taken yet of ${f(own.target)}.`);
    return parts.length ? parts.join("\n") : "There are no limits to measure against yet. Record a payment and they appear.";
  }

  // Pay.
  if (/\bpay myself\b|\b(my|own|owner'?s?) (pay|salary|draw|share)\b|\bhow much (is|was) my pay\b|\bhow much (have|did) i (taken|take|paid myself|pay myself)\b/.test(bare)) {
    return `Your pay share this month is ${f(own.target)} (${p.ownerPct}% of what came in). You have taken ${f(own.drawn)}, so ${f(Math.max(0, own.target - own.drawn))} is still in the business.`;
  }

  // Tax: report the split and the account, never an amount owed.
  if (/\btax(es)?\b/.test(bare)) {
    return `Your split puts ${p.taxPct}% toward tax, which is ${f(snap.tax.target)} this month. Your tax account holds ${f(snap.tax.fundedBalance)}. I can't tell you what you owe; that is for your accountant.`;
  }

  // Spending.
  if (/\bspen[dt]\b|\bspending\b|\bexpenses?\b|\bwhere (did|does|is) (all )?(my|the) money (go|going|gone|went)\b|\bmoney out\b|\b(biggest|top|largest|most)\b.*\b(cost|costs|category|categories)\b/.test(bare)) {
    const on = bare.match(/\b(?:on|for|at|in)\s+(?:my\s+|the\s+)?([a-z][a-z &'-]{1,30}?)(?:\s+(?:this month|so far|month to date|today))?$/);
    const topic = on && !/^(this month|the month|total|all|everything|business|personal|home)$/.test(on[1]) ? on[1].trim() : null;
    if (topic) {
      const cat = cats.find((c) => c.name.toLowerCase() === topic) ?? cats.find((c) => c.name.toLowerCase().includes(topic) || topic.includes(c.name.toLowerCase()));
      if (cat) return `${cat.name}: ${f(cat.amount)} this month.`;
      const rows = data.transactions.filter((t) => inMonth(t, month) && (isBusinessSpend(t) || isPersonalSpend(t)) && t.description.toLowerCase().includes(topic));
      if (rows.length) return `"${topic}": ${f(sumUsd(rows))} this month across ${rows.length} ${rows.length === 1 ? "entry" : "entries"}.`;
      return `Nothing recorded for "${topic}" this month.`;
    }
    if (/\btoday\b/.test(bare)) {
      const rows = data.transactions.filter((t) => t.date === today && (isBusinessSpend(t) || isPersonalSpend(t)));
      return rows.length ? `Today: ${f(sumUsd(rows))} out across ${rows.length} ${rows.length === 1 ? "entry" : "entries"}.` : "Nothing spent today.";
    }
    if (businessSpend + personalSpend === 0) return "Nothing spent yet this month.";
    const top = cats.slice(0, 3).map((c) => `${c.name} ${f(c.amount)}`).join(", ");
    return `Money out this month: ${f(businessSpend + personalSpend)} (business ${f(businessSpend)}, personal ${f(personalSpend)}).${top ? `\nBiggest: ${top}.` : ""}`;
  }

  if (/\btoday\b/.test(bare)) return null;

  // Money in.
  if (/\b(how much|what)\b.*\b(make|made|earn|earned|collect|collected|came in|come in|got paid|get paid|bring in|brought in|receive|received)\b|\b(income|revenue|money in)\b/.test(bare)) {
    const r = snap.revenue;
    if (r.collected === 0) return "No money in recorded yet this month.";
    return `Money in this month: ${f(r.collected)}${r.totalFees > 0 ? `, ${f(r.netDistributable)} after ${f(r.totalFees)} in fees` : ""}.`;
  }

  // Kept.
  if (/\b(keep|kept|profit|net|left over|leftover|margin)\b/.test(bare)) {
    return `Kept this month: ${f(ex.netResultAfterOwnerPay)}, after costs and your pay. Profit held back so far: ${f(Math.max(0, snap.profit.cumulativeRetained))}.`;
  }

  // Savings.
  if (/\b(cushion|reserve|reserves|savings?|saved|emergency|rainy day)\b/.test(bare)) {
    return `Cushion: ${f(snap.reserve.fundedBalance)} set aside${snap.reserve.target > 0 ? ` of a ${f(snap.reserve.target)} target` : ""}.`;
  }

  // Cash.
  if (/\b(balance|balances|cash|in (the|my) (bank|account)|how much (money )?do i have|runway|how long .* last)\b/.test(bare)) {
    const biz = balance("operating");
    const personal = balance("personal");
    const parts = [biz ? `Business account: ${biz}.` : "", personal ? `Personal account: ${personal}.` : "", snap.cash.runwayMonths ? `Runway: about ${snap.cash.runwayMonths} months at this month's costs.` : ""].filter(Boolean);
    return parts.length ? parts.join("\n") : "No accounts are set up yet.";
  }

  // Subscriptions.
  if (/\b(subscriptions?|recurring|renew|renews|renewals?|monthly bills?)\b/.test(bare)) {
    const subs = data.recurringExpenses.filter((r) => r.status === "active");
    if (!subs.length) return "No subscriptions recorded.";
    return [`${subs.length} active:`, ...subs.slice(0, 12).map((r) => `• ${r.name} ${fm(r.amountMinor, r.currency as CurrencyCode)} ${r.frequency}`)].join("\n");
  }

  // Split.
  if (/\bsplit\b|\bhow is (my|the) money (divided|split|shared)\b|\bpercentages?\b/.test(bare)) {
    return `Your split: running costs ${p.opexPct}%, your pay ${p.ownerPct}%, tax ${p.taxPct}%, profit ${p.profitPct}%, cushion ${p.reservePct}%, growth ${p.growthPct}%.`;
  }

  // Recent entries.
  if (/\b(last|latest|recent|recently)\b.*\b(entry|entries|transactions?|added|recorded|payments?)\b|\bwhat did i (add|record|enter)\b/.test(bare)) {
    const rows = data.transactions.slice(0, 4);
    if (!rows.length) return "Nothing recorded yet.";
    return ["Latest entries:", ...rows.map((t) => `• ${t.date} ${isRevenue(t) ? "in" : "out"} ${fm(t.amountMinor, t.currency as CurrencyCode)} ${t.description}`)].join("\n");
  }

  // How am I doing.
  if (/\bhow am i doing\b|\bhow('s| is| are) (my |the )?(month|business|money|finances?|numbers?|things)\b|^(summary|overview|status|recap|catch me up)\b|\b(summary|overview|recap|snapshot)\b/.test(bare)) {
    const first = steps()[0];
    return [`This month: ${f(snap.revenue.netDistributable)} in, ${f(businessSpend + personalSpend)} out, ${f(ex.netResultAfterOwnerPay)} kept.`, ex.ceiling > 0 ? `Running costs: ${f(ex.overheadActual)} of ${f(ex.ceiling)}.` : "", own.target > 0 ? `Your pay: ${f(own.drawn)} taken of ${f(own.target)}.` : "", first ? `Next: ${first.title}${/[.?!]$/.test(first.title) ? "" : "."}` : ""].filter(Boolean).join("\n");
  }

  return null;
}

/** "how much is left for food" when a tracker or category has a limit. */
function parseTrackerLeft(bare: string, data: EngineData, cats: { name: string; amount: Minor }[], f: (m: Minor) => string): string | null {
  let trackers: { label: string; category?: string; limitMinor?: number; kind: string }[] = [];
  try {
    const ui = JSON.parse(data.settings.uiJson || "{}");
    trackers = Array.isArray(ui?.dashboard?.trackers) ? ui.dashboard.trackers : [];
  } catch {
    return null;
  }
  for (const t of trackers) {
    if (t.kind !== "category" || !t.category) continue;
    const key = t.category.toLowerCase();
    if (!new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(bare)) continue;
    const spent = cats.filter((c) => c.name.toLowerCase().includes(key) || key.includes(c.name.toLowerCase())).reduce((s, c) => s + c.amount, 0);
    if (!t.limitMinor) return `${t.label}: ${f(spent)} spent this month. No limit is set.`;
    return `${t.label}: ${f(spent)} spent of ${f(t.limitMinor)}, so ${t.limitMinor - spent >= 0 ? `${f(t.limitMinor - spent)} is left` : `you are ${f(spent - t.limitMinor)} over`} this month.`;
  }
  return null;
}

/** What to say when the language model cannot be reached or has hit its daily limit. */
export function modelUnavailable(reason: "limit" | "offline" | "error"): string {
  const why = reason === "limit" ? "I've hit today's limit for open-ended questions. It resets at midnight UTC." : reason === "offline" ? "I can't get online right now, so open-ended questions will have to wait." : "I couldn't work that one out just now.";
  return `${why}\nEverything else still works. Try "spent 20 on lunch", "got paid 1,200", "how much is left?", "what did I spend?" or "what next?".`;
}
