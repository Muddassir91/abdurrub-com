import { isKnownCurrency } from "@/lib/money";
import { PRESETS, resolveSection } from "@/lib/ui";
import { resolvePage, type RawAction } from "./actions";

/**
 * Understands the everyday commands on the device, with no model and no
 * network: "spent 20 on lunch", "got paid 1,200 from Harbor", "paid myself
 * 500", "undo", "dark mode", "my tax is 1%", "hide the weekly chart".
 *
 * It only answers when it is sure. Anything it does not fully recognise
 * returns null and goes to the language model instead.
 */

export interface ParseEnv {
  /** Names of active subscriptions, for "cancel X". */
  subscriptions?: string[];
}

interface Amount {
  amount: number;
  currency?: string;
  /** Text before and after the amount, with the amount removed. */
  before: string;
  after: string;
}

const SYMBOLS: Record<string, string> = { $: "$", "€": "EUR", "£": "GBP", "₹": "INR", "₨": "RS", rs: "RS", "rs.": "RS" };
const WORDS: Record<string, string> = { dollar: "$", dollars: "$", bucks: "$", usd: "USD", rupee: "RS", rupees: "RS", rs: "RS", pkr: "PKR", euro: "EUR", euros: "EUR", pound: "GBP", pounds: "GBP", dirham: "AED", dirhams: "AED", riyal: "SAR", riyals: "SAR" };
const MULT: Record<string, number> = { k: 1e3, m: 1e6, lakh: 1e5, lac: 1e5, lakhs: 1e5, crore: 1e7 };
const NUM = /(?:(\$|€|£|₹|₨|rs\.?|[a-z]{3})\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(k|m|lakhs?|lac|crore)\b)?(?:\s?([a-z]{2,7})\b)?/i;

const currencyOf = (token: string | undefined): string | undefined => {
  if (!token) return undefined;
  const t = token.toLowerCase();
  if (SYMBOLS[t]) return SYMBOLS[t];
  if (WORDS[t]) return WORDS[t];
  if (t.length === 3 && isKnownCurrency(t)) return t.toUpperCase();
  return undefined;
};

/** Pull the first amount out of a phrase. */
export function takeAmount(text: string): Amount | null {
  const m = NUM.exec(text);
  if (!m) return null;
  const [whole, pre, digits, mult, post] = m;
  let start = m.index;
  let end = m.index + whole.length;
  let currency = currencyOf(pre);
  if (pre && !currency) start += whole.indexOf(digits); // the "prefix" was an ordinary word
  const postCurrency = currencyOf(post);
  if (post && !postCurrency) end -= post.length; // so was the "suffix"
  currency = currency ?? postCurrency;
  const amount = Number(digits.replace(/,/g, "")) * (mult ? (MULT[mult.toLowerCase()] ?? 1) : 1);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency, before: text.slice(0, start).trim(), after: text.slice(end).trim() };
}

const countNumbers = (t: string) => (t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).length;

const tidy = (t: string) =>
  t
    .trim()
    .replace(/^(?:on|for|at|to|in|of|from|a|an|the|my|some|our)\s+/i, "")
    .replace(/^(?:a|an|the|my|some|our)\s+/i, "")
    .replace(/\s+(?:today|just now|right now)$/i, "")
    .replace(/\s+(?:for|on|at|of|worth)$/i, "")
    .replace(/[.!,;]+$/, "")
    .trim();
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

function money(a: Amount, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { amount: a.amount, ...(a.currency ? { currency: a.currency } : {}), ...extra };
}

/** Lift "yesterday", "2 days ago" out of the phrase. */
function takeDate(text: string): { text: string; date?: string } {
  let date: string | undefined;
  let t = text;
  t = t.replace(/\b(yesterday|last night)\b/i, () => ((date = "yesterday"), ""));
  t = t.replace(/\b(\d+)\s+days?\s+ago\b/i, (_, n) => ((date = `${n} days ago`), ""));
  t = t.replace(/\b(today|this morning|tonight|just now)\b/i, "");
  return { text: t.replace(/\s{2,}/g, " ").trim(), date };
}

function parseOne(input: string, env: ParseEnv): RawAction | null {
  const raw = input.trim().replace(/[.!?]+$/, "");
  const lower = raw.toLowerCase();
  if (!lower) return null;

  // Undo
  if (/^(undo|undo that|undo it|undo the last (one|thing|entry)|oops|revert( that)?|take that back|remove that|that was (a mistake|wrong))$/.test(lower)) return { name: "undo" };

  // Setup again
  if (/(redo|re-do|restart|start over|go through|go over|change|fix|edit|review|update|open|see).{0,30}(setup|set-up|set up|onboarding|questionnaire|questions|my answers)/.test(lower) || /(messed up|mess up|misunderstood|got .{0,12}wrong|made a mistake|mistake).{0,50}(setup|set-up|onboarding|questions|answers)/.test(lower)) return { name: "redo_setup" };

  // Theme
  let m = lower.match(/\b(dark|light|night|day)\s+(mode|theme)\b/);
  if (m) return { name: "set_theme", args: { theme: m[1] === "night" ? "dark" : m[1] === "day" ? "light" : m[1] } };

  // Month
  m = lower.match(/^(?:show |go to |switch to |open )?(last|previous|next|this|current)\s+month$/);
  if (m) return { name: "set_month", args: { month: m[1] === "last" ? "previous" : m[1] === "this" ? "current" : m[1] } };

  // Tax share: "my tax is 1%", "set tax to 15 percent"
  m = lower.match(/^(?:set |change |make |update )?(?:my |the )?tax(?:es)?(?: rate| share| percentage)?(?: is| to| at| should be| =)?\s*(\d+(?:\.\d+)?)\s?(?:%|percent|per cent)$/);
  if (m) return { name: "update_setup", args: { taxPct: Number(m[1]) } };

  // Usual income
  m = lower.match(/^(?:set |change |update )?(?:my )?(?:usual |monthly |typical |average )*(?:income|revenue)(?: a month| per month)?(?: is| to| =)?\s+(.+?)(?:\s+(?:a|per|every|each)\s+month)?$/) ?? lower.match(/^i\s+(?:usually |typically |normally )?(?:make|earn|bring in)\s+(.+?)\s+(?:a|per|every|each)\s+month$/);
  if (m) {
    const a = takeAmount(m[1]);
    if (a && !a.before && !a.after) return { name: "update_setup", args: { monthlyIncome: a.amount } };
  }

  // Dashboard layouts
  m = lower.match(/^(?:make|give me|i want|i need|switch to|use|show|set)?\s*(?:me\s+)?(?:a|an|the|my)?\s*(simple|simpler|minimal|clean|basic|standard|default|normal|everything|full|complete|spending|business)\s+(?:dashboard|layout|view|home|home screen)$/);
  if (m) {
    const map: Record<string, string> = { simpler: "simple", minimal: "simple", clean: "simple", basic: "simple", default: "standard", normal: "standard", full: "everything", complete: "everything" };
    const preset = map[m[1]] ?? m[1];
    if (PRESETS[preset]) return { name: "customize_dashboard", args: { preset } };
  }
  if (/^(show (me )?everything|reset (my |the )?(dashboard|layout|home)|show all( sections)?)$/.test(lower)) return { name: "customize_dashboard", args: { preset: "everything" } };
  if (/^(simplify|declutter|clean up)( (my|the))?( dashboard| home| this)?$/.test(lower)) return { name: "customize_dashboard", args: { preset: "simple" } };

  // Trackers: "track food", "track food with a 300 limit"
  m = lower.match(/^(?:add (?:a )?tracker for|track|keep an eye on|watch)\s+(?:my\s+)?(.+?)(?:\s+spending)?(?:\s+(?:with (?:a )?(?:limit|budget|cap) of|under|below|limit|budget|capped at|with a)\s+(.+?)(?:\s+(?:limit|budget|cap))?)?$/);
  if (m) {
    const limit = m[2] ? takeAmount(m[2]) : null;
    return { name: "customize_dashboard", args: { add_tracker: { category: m[1].trim(), ...(limit ? { limit: limit.amount } : {}) } } };
  }

  // Hide / show sections
  m = lower.match(/^(?:hide|remove|get rid of|drop|turn off|i don'?t need)\s+(.+)$/);
  if (m) {
    const sec = resolveSection(m[1]);
    if (sec) return { name: "customize_dashboard", args: { hide: [sec] } };
  }
  m = lower.match(/^(?:show|add|bring back|unhide|turn on|put back)\s+(?:me\s+)?(.+)$/);
  if (m && !/^(show|open) me\b/.test(lower)) {
    const sec = resolveSection(m[1]);
    if (sec) return { name: "customize_dashboard", args: { show: [sec] } };
  }

  // Navigation
  m = lower.match(/^(?:go to|open|take me to|show me|navigate to|bring up|where (?:is|are)|where (?:do|can) i (?:see|find|change|edit))\s+(.+)$/);
  if (m) {
    const page = resolvePage(m[1]);
    if (page) return { name: "navigate", args: { page: page.label } };
    const sec = resolveSection(m[1]);
    if (sec) return { name: "customize_dashboard", args: { show: [sec] } };
  }

  // Cancel a known subscription
  m = lower.match(/^(?:i\s+)?(?:cancel|cancelled|canceled|stop|stopped|remove)\s+(?:my\s+|the\s+)?(.+?)(?:\s+subscription)?$/);
  if (m && env.subscriptions?.some((n) => n.toLowerCase() === m![1] || m![1].includes(n.toLowerCase()))) return { name: "remove_subscription", args: { name: m[1] } };

  // Everything below is about an amount of money.
  if (countNumbers(lower) !== 1) return null;
  const dated = takeDate(raw);
  const text = dated.text;
  const t = text.toLowerCase();
  const date = dated.date ? { date: dated.date } : {};

  // Paying yourself
  m = t.match(/^(?:i\s+)?(?:just\s+)?(?:paid|pay|payed|paying)\s+myself\s+(.+)$/) ?? t.match(/^(?:i\s+)?(?:just\s+)?(?:took|drew|withdrew)\s+(.+?)\s+(?:as|for)\s+(?:my\s+)?(?:pay|salary|wage|draw)$/);
  if (m) {
    const a = takeAmount(m[1]);
    if (a && !a.before && !a.after) return { name: "pay_myself", args: money(a, date) };
  }

  // Setting money aside
  m = t.match(/^(?:i\s+)?(?:just\s+)?(?:moved|move|set aside|put|saved|save|transferred|transfer|sent)\s+(.+?)\s+(?:aside\s+)?(?:to|for|into|in|towards|toward)\s+(?:my\s+|the\s+)?(tax|taxes|savings|saving|cushion|reserve|reserves|profit|growth)(?:\s+account)?$/);
  if (m) {
    const a = takeAmount(m[1]);
    if (a && !a.before && !a.after) return { name: "set_aside", args: money(a, { for: /tax/.test(m[2]) ? "tax" : /profit/.test(m[2]) ? "profit" : /growth/.test(m[2]) ? "growth" : "cushion", ...date }) };
  }

  // Paying tax
  m = t.match(/^(?:i\s+)?(?:just\s+)?paid\s+(.+?)\s+(?:in\s+|of\s+|for\s+|as\s+)?(?:my\s+)?tax(?:es)?$/) ?? t.match(/^(?:i\s+)?(?:just\s+)?paid\s+(?:my\s+)?tax(?:es)?(?:\s+of)?\s+(.+)$/);
  if (m) {
    const a = takeAmount(m[1]);
    if (a && !a.before && !a.after) return { name: "pay_tax", args: money(a, date) };
  }

  // Money in
  m = t.match(/^(?:i\s+)?(?:just\s+)?(?:got paid|received|earned|collected|was paid|have received|made)\s+(.+)$/) ?? t.match(/^(?:i\s+)?(?:just\s+)?got\s+(.+\bfrom\b.+)$/) ?? t.match(/^(?:income|money in|payment|deposit)(?:\s+of)?\s+(.+)$/);
  if (m) {
    const a = takeAmount(text.slice(text.length - m[1].length));
    if (a && !a.before) {
      const rest = a.after.replace(/^more\b\s*/i, "");
      const from = rest.match(/^from\s+(.+?)(?:\s+for\s+(.+))?$/i);
      const forWhat = rest.match(/^for\s+(.+?)(?:\s+from\s+(.+))?$/i);
      if (!rest) return { name: "add_money_in", args: money(a, date) };
      if (from) return { name: "add_money_in", args: money(a, { from: cap(tidy(from[1])), ...(from[2] ? { what: cap(tidy(from[2])) } : {}), ...date }) };
      if (forWhat) return { name: "add_money_in", args: money(a, { what: cap(tidy(forWhat[1])), ...(forWhat[2] ? { from: cap(tidy(forWhat[2])) } : {}), ...date }) };
    }
  }
  // "Harbor paid me 4500", "client paid 800"
  m = t.match(/^(.+?)\s+(?:just\s+)?paid\s+(?:me\s+)(.+)$/) ?? t.match(/^(client|a client|customer)\s+paid\s+(.+)$/);
  if (m) {
    const a = takeAmount(text.slice(text.length - m[2].length));
    if (a && !a.before && (!a.after || /^for\s+/i.test(a.after))) {
      const who = /^(a )?(client|customer)$/.test(m[1]) ? undefined : cap(tidy(text.slice(0, m[1].length)));
      return { name: "add_money_in", args: money(a, { ...(who ? { from: who } : {}), ...(a.after ? { what: cap(tidy(a.after)) } : {}), ...date }) };
    }
  }

  // Money out
  m = t.match(/^(?:i\s+)?(?:just\s+)?(?:spent|spend|paid|pay|bought|purchased|got charged|was charged|dropped|blew)\s+(.+)$/);
  if (m) {
    const a = takeAmount(text.slice(text.length - m[1].length));
    if (a) {
      const what = tidy(a.before ? `${a.before} ${a.after.replace(/^(?:for|on)\s+/i, "")}` : a.after);
      return { name: "add_money_out", args: money(a, { ...(what ? { what: cap(what) } : {}), ...date }) };
    }
  }
  // "figma cost me 15", "lunch was 12"
  m = t.match(/^(.+?)\s+(?:cost|costs|costed|was|were|came to|for)\s+(?:me\s+)?(\S.*)$/);
  if (m) {
    const a = takeAmount(m[2]);
    const what = tidy(text.slice(0, m[1].length));
    if (a && !a.before && !a.after && what && !/\d/.test(what)) return { name: "add_money_out", args: money(a, { what: cap(what), ...date }) };
  }
  // "20 on groceries", "lunch 12", "uber 450 rs"
  if (t.split(/\s+/).length <= 6) {
    const a = takeAmount(text);
    if (a) {
      const after = a.after.match(/^(?:on|for|at)\s+(.+)$/i);
      if (!a.before && after) return { name: "add_money_out", args: money(a, { what: cap(tidy(after[1])), ...date }) };
      if (a.before && !a.after && /^[a-z][a-z '&-]*$/i.test(a.before) && !/\b(is|are|was|my|set|to|make|change|what|how|why|when|can|should|do|does)\b/i.test(a.before)) return { name: "add_money_out", args: money(a, { what: cap(tidy(a.before)), ...date }) };
    }
  }
  return null;
}

const STARTERS = /^(?:hey|hi|hello|ok|okay|so|please|pls|yo|cfoh|cfoh!|also|and|btw)[,!]?\s+/i;

/**
 * Parse a message into actions, or null when the model should handle it.
 * Several commands in one message ("spent 20 on lunch and 50 on fuel") are
 * accepted only when every part is understood.
 */
export function parseLocal(message: string, env: ParseEnv = {}): RawAction[] | null {
  let text = message.trim().replace(/\s+/g, " ");
  while (STARTERS.test(text)) text = text.replace(STARTERS, "");
  if (!text || text.length > 240 || text.includes("?")) return null;
  if (countNumbers(text) <= 1) {
    const one = parseOne(text, env);
    return one ? [one] : null;
  }
  const parts = text.split(/\s+(?:and then|and also|and|then|also|plus)\s+|\s*[;\n]\s*|,\s+(?=(?:i\s+)?(?:spent|paid|got|received|bought|earned|made)\b)/i).filter(Boolean);
  if (parts.length < 2) return null;
  const out: RawAction[] = [];
  let verb = "";
  for (const part of parts) {
    let p = part.trim();
    // "spent 20 on lunch and 50 on fuel": carry the verb forward.
    const v = p.match(/^(?:i\s+)?(?:just\s+)?(spent|paid|bought|got paid|received|earned)\b/i);
    if (v) verb = v[1];
    else if (verb && /^\S*\d/.test(p)) p = `${verb} ${p}`;
    const one = parseOne(p, env);
    if (!one) return null;
    out.push(one);
  }
  return out;
}
