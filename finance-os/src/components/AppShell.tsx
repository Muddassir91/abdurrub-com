"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { LayoutDashboard, ArrowLeftRight, Receipt, Users, CreditCard, Wallet, Landmark, PiggyBank, Scale, Rocket, SlidersHorizontal, Bell, CalendarCheck, Settings, Lock, Sun, Moon, Menu, X, ChevronLeft, ChevronRight, TrendingUp, Save } from "lucide-react";
import { useFinance } from "@/store/FinanceProvider";
import { addMonths, monthLabel, currentMonthKey } from "@/lib/dates";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions/", label: "Transactions", icon: ArrowLeftRight },
  { href: "/expenses/", label: "Business expenses", icon: Receipt },
  { href: "/clients/", label: "Clients & revenue", icon: Users },
  { href: "/whop/", label: "Whop", icon: CreditCard },
  { href: "/personal/", label: "Owner & personal", icon: Wallet },
  { href: "/accounts/", label: "Accounts & cash", icon: Landmark },
  { href: "/reserves/", label: "Profit & reserves", icon: PiggyBank },
  { href: "/tax/", label: "Tax & compliance", icon: Scale },
  { href: "/growth/", label: "Growth & hiring", icon: Rocket },
  { href: "/scenarios/", label: "Scenarios", icon: SlidersHorizontal },
  { href: "/forecast/", label: "Cash-flow forecast", icon: TrendingUp },
  { href: "/alerts/", label: "Alerts", icon: Bell },
  { href: "/month-end/", label: "Month-end & reports", icon: CalendarCheck },
  { href: "/settings/", label: "Settings", icon: Settings },
];

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const stored = localStorage.getItem("finance-os:theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const t = stored === "dark" || stored === "light" ? stored : prefersDark ? "dark" : "light";
    setTheme(t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, []);
  const toggle = () => {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t);
    localStorage.setItem("finance-os:theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  };
  return { theme, toggle };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const path = pathname.startsWith(base) ? pathname.slice(base.length) || "/" : pathname;
  const { month, setMonth, alerts, displayCurrency, setDisplayCurrency, isEncrypted, lock, saving, lastSavedAt, data } = useFinance();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const critical = alerts.filter((a) => a.level === "critical").length;
  const caution = alerts.filter((a) => a.level === "caution").length;
  const isClosed = data?.monthCloses.some((c) => c.month === month && c.status === "closed");

  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
      {NAV.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors", active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg")}>
            <Icon size={16} className="shrink-0" />
            <span className="flex-1 truncate">{item.label}</span>
            {item.href === "/alerts/" && (critical > 0 || caution > 0) && <span className={clsx("rounded-full px-1.5 text-[10px] font-semibold", critical > 0 ? "bg-critical text-white" : "bg-caution text-white")}>{critical + caution}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg">RR</div>
          <div>
            <div className="text-sm font-semibold leading-tight text-fg">Finance OS</div>
            <div className="text-[11px] text-fg-faint">{data?.settings.businessName ?? "Retention Rules"}</div>
          </div>
        </div>
        {nav}
        <div className="border-t border-border px-4 py-3 text-[11px] text-fg-faint">
          <div className="flex items-center gap-1.5">
            <Save size={12} className={saving ? "animate-pulse text-accent" : ""} />
            {saving ? "Saving…" : lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : "Not saved yet"}
          </div>
          <div className="mt-1">Data lives in this browser only.</div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="flex w-64 flex-col border-r border-border bg-surface">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-semibold">Finance OS</span>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-fg-muted hover:bg-surface-2">
                <X size={16} />
              </button>
            </div>
            {nav}
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setOpen(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 lg:hidden" aria-label="Open navigation">
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-0.5">
            <button onClick={() => setMonth(addMonths(month, -1))} className="rounded-md p-1 text-fg-muted hover:bg-surface hover:text-fg" aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => setMonth(currentMonthKey())} className="min-w-[96px] px-2 text-sm font-medium text-fg" title="Jump to current month">
              {monthLabel(month)}
            </button>
            <button onClick={() => setMonth(addMonths(month, 1))} className="rounded-md p-1 text-fg-muted hover:bg-surface hover:text-fg" aria-label="Next month">
              <ChevronRight size={16} />
            </button>
          </div>
          {isClosed && <span className="hidden rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-muted sm:inline">Closed</span>}
          <div className="flex-1" />
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
            {(["USD", "PKR"] as const).map((c) => (
              <button key={c} onClick={() => setDisplayCurrency(c)} className={clsx("rounded-md px-2 py-1 font-medium", displayCurrency === c ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}>
                {c}
              </button>
            ))}
          </div>
          <button onClick={toggle} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {isEncrypted && (
            <button onClick={lock} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Lock" title="Lock now">
              <Lock size={16} />
            </button>
          )}
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
