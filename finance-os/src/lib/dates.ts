import { addMonths as dfAddMonths, format, parseISO, differenceInCalendarDays, startOfMonth, endOfMonth, isValid } from "date-fns";

export type MonthKey = string; // YYYY-MM
export type DateKey = string; // YYYY-MM-DD

export function todayKey(): DateKey {
  return format(new Date(), "yyyy-MM-dd");
}

export function monthKeyOf(date: DateKey | Date): MonthKey {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "yyyy-MM");
}

export function currentMonthKey(): MonthKey {
  return monthKeyOf(new Date());
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  return format(dfAddMonths(parseISO(`${month}-01`), n), "yyyy-MM");
}

export function monthRange(month: MonthKey): { start: DateKey; end: DateKey } {
  const d = parseISO(`${month}-01`);
  return { start: format(startOfMonth(d), "yyyy-MM-dd"), end: format(endOfMonth(d), "yyyy-MM-dd") };
}

export function monthLabel(month: MonthKey, style: "short" | "long" = "short"): string {
  const d = parseISO(`${month}-01`);
  return format(d, style === "short" ? "MMM yyyy" : "MMMM yyyy");
}

export function dateLabel(date: DateKey | null | undefined): string {
  if (!date) return "—";
  const d = parseISO(date);
  return isValid(d) ? format(d, "d MMM yyyy") : date;
}

export function daysBetween(from: DateKey, to: DateKey): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

export function addDays(date: DateKey, n: number): DateKey {
  const d = parseISO(date);
  d.setDate(d.getDate() + n);
  return format(d, "yyyy-MM-dd");
}

export function compareMonth(a: MonthKey, b: MonthKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive list of months from `from` to `to`. */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  let m = from;
  while (compareMonth(m, to) <= 0) {
    out.push(m);
    m = addMonths(m, 1);
    if (out.length > 600) break;
  }
  return out;
}

export function lastNMonths(endMonth: MonthKey, n: number): MonthKey[] {
  return monthsBetween(addMonths(endMonth, -(n - 1)), endMonth);
}

export function isValidDateKey(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && isValid(parseISO(s));
}
