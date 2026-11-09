"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Home, LineChart, ArrowLeftRight, ShieldCheck, Receipt, Users, CreditCard, Wallet, Landmark, PiggyBank, Scale, Rocket, SlidersHorizontal, Bell, CalendarCheck, Settings, Lock, Sun, Moon, Menu, X, ChevronLeft, ChevronRight, TrendingUp, Save, ChevronsUpDown, Plus, Check, ChevronDown, type LucideIcon } from "lucide-react";
import { useFinance } from "@/store/FinanceProvider";
import { addMonths, monthLabel, currentMonthKey } from "@/lib/dates";
import { Modal } from "./ui/Modal";
import { WorkspaceForm } from "./WorkspaceForm";
import { Wordmark } from "./Logo";
import { QuickAddProvider, QuickAddButton } from "./QuickAdd";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** The four things people use every day. Everything else lives under "More tools". */
const PRIMARY: NavItem[] = [
  { href: "/app/", label: "Home", icon: Home },
  { href: "/app/transactions/", label: "Activity", icon: ArrowLeftRight },
  { href: "/app/trends/", label: "Trends", icon: LineChart },
  { href: "/app/settings/", label: "Settings", icon: Settings },
];

const MORE: NavItem[] = [
  { href: "/app/expenses/", label: "Tools & overhead", icon: Receipt },
  { href: "/app/personal/", label: "Your pay & home", icon: Wallet },
  { href: "/app/reserves/", label: "Profit & cushion", icon: PiggyBank },
  { href: "/app/tax/", label: "Tax", icon: Scale },
  { href: "/app/clients/", label: "Clients", icon: Users },
  { href: "/app/whop/", label: "Payment processor", icon: CreditCard },
  { href: "/app/accounts/", label: "Accounts", icon: Landmark },
  { href: "/app/alerts/", label: "Alerts", icon: Bell },
  { href: "/app/month-end/", label: "Month-end", icon: CalendarCheck },
  { href: "/app/forecast/", label: "Forecast", icon: TrendingUp },
  { href: "/app/scenarios/", label: "Scenarios", icon: SlidersHorizontal },
  { href: "/app/growth/", label: "Growth & hiring", icon: Rocket },
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
  const { month, setMonth, alerts, displayCurrency, setDisplayCurrency, isEncrypted, lock, saving, lastSavedAt, data, createWorkspace, cloudUser, cloudStatus, access } = useFinance();
  const { resolved, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const isActive = (href: string) => (href === "/app/" ? path === "/app/" || path === "/app" : path.startsWith(href));
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (MORE.some((m) => isActive(m.href))) setMoreOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  const attention = alerts.filter((a) => a.level !== "info").length;
  const isClosed = data?.monthCloses.some((c) => c.month === month && c.status === "closed");
  const processorName = data?.processors[0]?.name ?? "Payment processor";
  const baseCur = data?.settings.baseCurrency ?? "USD";
  const homeCur = data?.settings.householdCurrency ?? "PKR";

  const primary = access?.isAdmin ? [...PRIMARY, { href: "/app/admin/", label: "Accounts & trials", icon: ShieldCheck }] : PRIMARY;
  const trialDays = access?.profile?.accessStatus === "trial" ? access.daysLeft : null;

  const link = (item: NavItem, small = false) => {
    const active = isActive(item.href);
    const Icon = item.icon;
    return (
      <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 font-medium transition-colors", small ? "py-1.5 text-xs" : "py-2 text-[13px]", active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg")}>
        <Icon size={small ? 14 : 16} className="shrink-0" />
        <span className="flex-1 truncate">{item.href === "/app/whop/" ? processorName : item.label}</span>
        {item.href === "/app/alerts/" && attention > 0 && <span className="rounded-full bg-caution px-1.5 text-[10px] font-semibold text-white">{attention}</span>}
      </Link>
    );
  };

  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
      {primary.map((item) => link(item))}
      <button type="button" onClick={() => setMoreOpen((v) => !v)} className="mt-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-faint hover:text-fg" aria-expanded={moreOpen}>
        <ChevronDown size={12} className={clsx("transition-transform", moreOpen ? "" : "-rotate-90")} /> More tools
        {attention > 0 && !moreOpen && <span className="ml-auto rounded-full bg-caution px-1.5 text-[10px] font-semibold text-white">{attention}</span>}
      </button>
      {moreOpen && <div className="space-y-0.5 pl-1">{MORE.map((item) => link(item, true))}</div>}
    </nav>
  );

  return (
    <QuickAddProvider>
      <div className="flex min-h-screen bg-bg">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:overflow-y-auto">
          <WorkspaceSwitcher onCreate={() => setCreating(true)} />
          <div className="px-3 pt-2">
            <QuickAddButton className="h-11 w-full" label="Add money in or out" />
          </div>
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
            {trialDays !== null && !access?.isAdmin && (
              <Link href="/app/settings/?tab=account" className={clsx("hidden rounded-md px-2 py-1 text-[11px] font-medium sm:inline", trialDays <= 7 ? "bg-caution-soft text-caution" : "bg-accent-soft text-accent")} title="Your free month">
                {trialDays} day{trialDays === 1 ? "" : "s"} left in your free month
              </Link>
            )}
            {baseCur !== homeCur && (
              <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-0.5 text-xs" title="Show amounts in">
                {([["USD", baseCur], ["PKR", homeCur]] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setDisplayCurrency(key)} className={clsx("rounded-md px-2 py-1 font-medium", displayCurrency === key ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <button onClick={toggle} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Toggle theme" title={`Theme: ${resolved}. Settings → Appearance for "follow system".`}>
              {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {isEncrypted && (
              <button onClick={lock} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Lock" title="Lock now">
                <Lock size={16} />
              </button>
            )}
          </header>
          <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 overflow-x-hidden px-4 py-6 pb-28 sm:px-6 lg:pb-8">{children}</main>
        </div>

        {/* Mobile: bottom tabs with the add button in the middle. */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Main">
          <div className="mx-auto grid max-w-lg grid-cols-5 items-end px-2">
            {[PRIMARY[0], PRIMARY[1]].map((item) => (
              <TabLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
            <div className="flex justify-center pb-2">
              <QuickAddButton className="-mt-5 h-14 w-14" label="" />
            </div>
            {[PRIMARY[2], PRIMARY[3]].map((item) => (
              <TabLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </div>
        </nav>

        <Modal open={creating} onClose={() => setCreating(false)} title="Add a business or person" description="Creates a separate workspace with its own numbers and settings. You will answer the setup questions for it next." size="lg">
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
    </QuickAddProvider>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} className={clsx("flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium", active ? "text-accent" : "text-fg-muted")} aria-current={active ? "page" : undefined}>
      <Icon size={20} />
      {item.label}
    </Link>
  );
}
