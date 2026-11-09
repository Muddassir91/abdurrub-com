"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, RefreshCw, Search } from "lucide-react";
import type { Profile } from "@/cloud/types";
import { useFinance } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { PageHeader, Stat, Badge, Button, Callout } from "@/components/ui/primitives";
import { Input, Select } from "@/components/ui/forms";
import { Table, type Column } from "@/components/ui/Table";
import { dateLabel } from "@/lib/dates";

function daysLeft(p: Profile): number {
  return Math.ceil((Date.parse(p.trialEndsAt) - Date.now()) / 86400000);
}

function statusOf(p: Profile): { label: string; tone: "positive" | "caution" | "critical" | "neutral" | "accent" } {
  if (p.accessStatus === "blocked") return { label: "blocked", tone: "critical" };
  if (p.accessStatus === "active") return { label: "active", tone: "positive" };
  const d = daysLeft(p);
  if (d <= 0) return { label: "trial ended", tone: "critical" };
  if (d <= 7) return { label: `trial · ${d}d left`, tone: "caution" };
  return { label: `trial · ${d}d left`, tone: "accent" };
}

/** Owner-only: every account, its trial, and switches to extend or pause access. */
export default function AdminPage() {
  const { access, cloudStatus, adminListProfiles, adminUpdateProfile } = useFinance();
  const toast = useToast();
  const [rows, setRows] = useState<Profile[]>([]);
  const [now, setNow] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "trial" | "ending" | "ended" | "active" | "blocked">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminListProfiles());
      setNow(Date.now());
    } catch (e) {
      toast.error("Could not load accounts", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [adminListProfiles, toast]);

  useEffect(() => {
    if (access?.isAdmin) void load();
  }, [access?.isAdmin, load]);

  const update = async (p: Profile, patch: Partial<Pick<Profile, "trialEndsAt" | "accessStatus" | "plan" | "notes">>, msg: string) => {
    try {
      await adminUpdateProfile(p.userId, patch);
      setRows((rs) => rs.map((r) => (r.userId === p.userId ? { ...r, ...patch } : r)));
      toast.success(msg);
    } catch (e) {
      toast.error("Update failed", e instanceof Error ? e.message : String(e));
    }
  };

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((p) => {
      if (s && !(p.email ?? "").toLowerCase().includes(s)) return false;
      const d = daysLeft(p);
      switch (filter) {
        case "trial":
          return p.accessStatus === "trial" && d > 0;
        case "ending":
          return p.accessStatus === "trial" && d > 0 && d <= 7;
        case "ended":
          return p.accessStatus === "trial" && d <= 0;
        case "active":
          return p.accessStatus === "active";
        case "blocked":
          return p.accessStatus === "blocked";
        default:
          return true;
      }
    });
  }, [rows, q, filter]);

  if (cloudStatus === "off") return <Callout tone="neutral">Accounts are not enabled in this build.</Callout>;
  if (!access?.isAdmin)
    return (
      <Callout tone="caution" title="Admin only">
        This page is only available to the CFoh! owner account.
      </Callout>
    );

  const counts = {
    total: rows.length,
    trial: rows.filter((p) => p.accessStatus === "trial" && daysLeft(p) > 0).length,
    ending: rows.filter((p) => p.accessStatus === "trial" && daysLeft(p) > 0 && daysLeft(p) <= 7).length,
    ended: rows.filter((p) => p.accessStatus === "trial" && daysLeft(p) <= 0).length,
    active: rows.filter((p) => p.accessStatus === "active").length,
    activeWeek: rows.filter((p) => p.lastSeenAt && now - Date.parse(p.lastSeenAt) < 7 * 86400000).length,
  };

  const cols: Column<Profile>[] = [
    { key: "email", header: "Account", render: (p) => <div><div className="font-medium">{p.email ?? p.userId}</div><div className="text-[11px] text-fg-faint">joined {dateLabel(p.createdAt.slice(0, 10))}{p.lastSeenAt ? ` · seen ${dateLabel(p.lastSeenAt.slice(0, 10))}` : " · never signed in"}</div></div> },
    { key: "status", header: "Status", render: (p) => { const s = statusOf(p); return <Badge tone={s.tone}>{s.label}</Badge>; } },
    { key: "trial", header: "Trial ends", render: (p) => <span className="text-fg-muted">{dateLabel(p.trialEndsAt.slice(0, 10))}</span> },
    { key: "plan", header: "Plan", render: (p) => <Input className="h-8 w-28 text-xs" defaultValue={p.plan ?? ""} placeholder="e.g. founding" onBlur={(e) => e.target.value !== (p.plan ?? "") && void update(p, { plan: e.target.value || null }, "Plan saved")} /> },
    { key: "notes", header: "Notes", render: (p) => <Input className="h-8 w-44 text-xs" defaultValue={p.notes ?? ""} placeholder="who, where from" onBlur={(e) => e.target.value !== (p.notes ?? "") && void update(p, { notes: e.target.value || null }, "Note saved")} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (p) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" onClick={() => void update(p, { trialEndsAt: new Date(Math.max(Date.now(), Date.parse(p.trialEndsAt)) + 30 * 86400000).toISOString(), accessStatus: "trial" }, "Extended by 30 days")}>+30 days</Button>
          {p.accessStatus !== "active" && <Button size="sm" onClick={() => void update(p, { accessStatus: "active" }, "Access set to active")}>Set active</Button>}
          {p.accessStatus !== "blocked" ? <Button size="sm" variant="danger" onClick={() => void update(p, { accessStatus: "blocked" }, "Access paused")}>Pause</Button> : <Button size="sm" onClick={() => void update(p, { accessStatus: "trial" }, "Access restored")}>Restore</Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Accounts & trials" description="Every CFoh! account, its 30-day trial and access switch. Only you can see this page. Blocking an account keeps its data; it only closes the door." actions={<Button onClick={() => void load()} loading={loading}><RefreshCw size={14} /> Refresh</Button>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Accounts" value={counts.total} />
        <Stat label="On trial" value={counts.trial} />
        <Stat label="Ending in 7 days" value={counts.ending} tone={counts.ending ? "caution" : "neutral"} />
        <Stat label="Trial ended" value={counts.ended} tone={counts.ended ? "critical" : "neutral"} />
        <Stat label="Active (paid or comped)" value={counts.active} tone="positive" />
        <Stat label="Seen this week" value={counts.activeWeek} />
      </div>
      <div className="my-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-fg-faint" />
          <Input className="w-64 pl-8" placeholder="Search email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="w-44" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All</option>
          <option value="trial">On trial</option>
          <option value="ending">Ending within 7 days</option>
          <option value="ended">Trial ended</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
        </Select>
        <span className="ml-auto flex items-center gap-1 text-xs text-fg-faint"><ShieldCheck size={12} /> Changes apply the next time the person opens CFoh!.</span>
      </div>
      <Table columns={cols} rows={shown} rowKey={(p) => p.userId} empty="No accounts yet. Share the homepage link and they will appear here as people sign up." />
      <p className="mt-4 text-xs text-fg-faint">Export for Bento or any email tool: the same list is in Supabase under Table editor → profiles (email, trial_ends_at, access_status, last_seen_at).</p>
    </>
  );
}
