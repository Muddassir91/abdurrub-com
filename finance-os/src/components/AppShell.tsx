"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { LayoutDashboard, LineChart, ArrowLeftRight, Receipt, Users, CreditCard, Wallet, Landmark, PiggyBank, Scale, Rocket, SlidersHorizontal, Bell, CalendarCheck, Settings, Lock, Sun, Moon, Menu, X, ChevronLeft, ChevronRight, TrendingUp, Save, ChevronsUpDown, Plus, Check } from "lucide-react";
import { useFinance } from "@/store/FinanceProvider";
import { addMonths, monthLabel, currentMonthKey } from "@/lib/dates";
import { Modal } from "./ui/Modal";
import { WorkspaceForm } from "./WorkspaceForm";
import { Wordmark } from "./Logo";

const NAV = [
  { href: "/app/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/trends/", label: "Trends & progress", icon: LineChart },
  { href: "/app/transactions/", label: "Transactions", icon: ArrowLeftRight },
  { href: "/app/expenses/", label: "Business expenses", icon: Receipt },
  { href: "/app/clients/", label: "Clients & revenue", icon: Users },
  { href: "/app/whop/", label: "Payment processor", icon: CreditCard },
  { href: "/app/personal/", label: "Owner & personal", icon: Wallet },
  { href: "/app/accounts/", label: "Accounts & cash", icon: Landmark },
  { href: "/app/reserves/", label: "Profit & reserves", icon: PiggyBank },
  { href: "/app/tax/", label: "Tax & compliance", icon: Scale },
  { href: "/app/growth/", label: "Growth & hiring", icon: Rocket },
  { href: "/app/scenarios/", label: "Scenarios", icon: SlidersHorizontal },
  { href: "/app/forecast/", label: "Cash-flow forecast", icon: TrendingUp },
  { href: "/app/alerts/", label: "Alerts", icon: Bell },
  { href: "/app/month-end/", label: "Month-end & reports", icon: CalendarCheck },
  { href: "/app/settings/", label: "Settings", icon: Settings },
];

export type ThemePref = "system" | "light" | "dark";
const THEME_KEY = "finance-os:theme";

function readPref(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "dark" || t === "light" ? t : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePref) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = pref === "dark" || (pref === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
  return dark ? "dark" : "light";
}

/** Theme preference: system (follows the OS), light or dark. Shared by the top bar toggle and Settings → Appearance. */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  useEffect(() => {
    const p = readPref();
    setPrefState(p);
    setResolved(apply(p));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readPref() === "system") setResolved(apply("system"));
    };
    mq.addEventListener("change", onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) {
        const np = readPref();
        setPrefState(np);
        setResolved(apply(np));
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("finance-os:theme", onStorage as EventListener);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("finance-os:theme", onStorage as EventListener);
    };
  }, []);
  const setPref = (p: ThemePref) => {
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch {
      /* ignore */
    }
    setPrefState(p);
    setResolved(apply(p));
    window.dispatchEvent(new StorageEvent("finance-os:theme", { key: THEME_KEY }));
  };
  const toggle = () => setPref(resolved === "dark" ? "light" : "dark");
  return { pref, resolved, setPref, toggle };
}

function WorkspaceSwitcher({ onCreate }: { onCreate: () => void }) {
  const { workspaces, currentWorkspace, switchWorkspace, data, cloudUser, cloudStatus, cloudError, lastSyncedAt } = useFinance();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const initials = (currentWorkspace?.name ?? "FO")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="relative px-3 pt-3" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-2" aria-haspopup="listbox" aria-expanded={open} title="Switch workspace">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-bold text-accent-fg">{initials}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight text-fg">{currentWorkspace?.name ?? "CFoh!"}</div>
          <div className="truncate text-[11px] text-fg-faint">{data?.settings.businessName ?? "Workspace"}</div>
        </div>
        <ChevronsUpDown size={14} className="shrink-0 text-fg-faint" />
      </button>
      {open && (
        <div className="absolute left-3 right-3 top-full z-40 mt-1 rounded-xl border border-border bg-surface p-1 shadow-lg" role="listbox">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Workspaces</div>
          {workspaces.map((w) => (
            <button
              key={w.id}
              role="option"
              aria-selected={w.id === currentWorkspace?.id}
              onClick={() => {
                setOpen(false);
                void switchWorkspace(w.id);
              }}
              className={clsx("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2", w.id === currentWorkspace?.id ? "text-fg" : "text-fg-muted")}
            >
              <span className="flex-1 truncate">{w.name}</span>
              {w.id === currentWorkspace?.id && <Check size={14} className="text-accent" />}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-accent hover:bg-surface-2"
          >
            <Plus size={14} /> Add business or person
          </button>
          {cloudStatus !== "off" && (
            <>
              <div className="my-1 border-t border-border" />
              <Link href="/app/settings/?tab=account" onClick={() => setOpen(false)} className="block rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                <div className="truncate text-xs font-medium text-fg">{cloudUser ? cloudUser.email : "Not signed in"}</div>
                <div className="truncate text-[11px] text-fg-faint">{cloudStatus === "syncing" ? "Syncing…" : cloudStatus === "error" ? `Sync error: ${cloudError ?? ""}` : cloudUser ? (lastSyncedAt ? `Synced ${new Date(lastSyncedAt).toLocaleTimeString()}` : "Synced to your account") : "This device only · tap to sign in"}</div>
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const path = pathname.startsWith(base) ? pathname.slice(base.length) || "/" : pathname;
  const { month, setMonth, alerts, displayCurrency, setDisplayCurrency, isEncrypted, lock, saving, lastSavedAt, data, createWorkspace, cloudUser, cloudStatus } = useFinance();
  const { resolved, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const critical = alerts.filter((a) => a.level === "critical").length;
  const caution = alerts.filter((a) => a.level === "caution").length;
  const isClosed = data?.monthCloses.some((c) => c.month === month && c.status === "closed");
  const processorName = data?.processors[0]?.name ?? "Payment processor";

  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
      {NAV.map((item) => {
        const active = item.href === "/app/" ? path === "/app/" || path === "/app" : path.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors", active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg")}>
            <Icon size={16} className="shrink-0" />
            <span className="flex-1 truncate">{item.href === "/app/whop/" ? processorName : item.label}</span>
            {item.href === "/app/alerts/" && (critical > 0 || caution > 0) && <span className={clsx("rounded-full px-1.5 text-[10px] font-semibold", critical > 0 ? "bg-critical text-white" : "bg-caution text-white")}>{critical + caution}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <WorkspaceSwitcher onCreate={() => setCreating(true)} />
        {nav}
        <div className="border-t border-border px-4 py-3 text-[11px] text-fg-faint">
          <div className="mb-1.5"><Wordmark size="sm" className="text-fg-muted" /></div>
          <div className="flex items-center gap-1.5">
            <Save size={12} className={saving ? "animate-pulse text-accent" : ""} />
            {saving ? "Saving…" : lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : "Not saved yet"}
          </div>
          <div className="mt-1">{cloudUser ? (cloudStatus === "syncing" ? "Syncing to your account…" : cloudStatus === "error" ? "Cloud sync failed; data is safe on this device." : "Synced to your account.") : "Data lives in this browser only."}</div>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="flex w-64 flex-col border-r border-border bg-surface">
            <div className="flex items-center justify-between px-4 pt-3">
              <Wordmark size="sm" />
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-fg-muted hover:bg-surface-2" aria-label="Close navigation">
                <X size={16} />
              </button>
            </div>
            <WorkspaceSwitcher onCreate={() => { setOpen(false); setCreating(true); }} />
            {nav}
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setOpen(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
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
          <button onClick={toggle} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Toggle theme" title={`Theme: ${resolved}. Settings → Appearance for "follow system".`}>
            {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {isEncrypted && (
            <button onClick={lock} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Lock" title="Lock now">
              <Lock size={16} />
            </button>
          )}
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Add a business or person" description="Creates a separate workspace with its own database, settings and optional passphrase. Switch between workspaces from the sidebar." size="lg">
        <WorkspaceForm
          allowRetentionRulesTemplate={false}
          onCancel={() => setCreating(false)}
          onSubmit={async (input) => {
            await createWorkspace(input);
            setCreating(false);
          }}
        />
      </Modal>
    </div>
  );
}
