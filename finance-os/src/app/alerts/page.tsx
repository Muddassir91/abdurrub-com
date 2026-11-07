"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ShieldAlert, AlertTriangle, Info, BellOff, ArrowRight } from "lucide-react";
import { useReady } from "@/store/FinanceProvider";
import { useToast } from "@/components/ui/toast";
import { PageHeader, Badge, Button, Callout, Tabs, levelTone } from "@/components/ui/primitives";
import { snoozeAlert, clearSnoozes } from "@/db/repo";
import { addDays } from "@/lib/dates";
import type { AlertLevel } from "@/lib/constants";

export default function AlertsPage() {
  const { alerts, data, mutate, today } = useReady();
  const toast = useToast();
  const [level, setLevel] = useState<"all" | AlertLevel>("all");
  const shown = level === "all" ? alerts : alerts.filter((a) => a.level === level);
  const counts = { critical: alerts.filter((a) => a.level === "critical").length, caution: alerts.filter((a) => a.level === "caution").length, info: alerts.filter((a) => a.level === "info").length };
  const activeSnoozes = data.snoozes.filter((s) => s.snoozedUntil >= today);

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Every alert explains what happened, why it matters, the financial impact and the action to take. Thresholds carry tolerances so ordinary fluctuations stay quiet."
        actions={
          activeSnoozes.length > 0 && (
            <Button
              onClick={() => {
                mutate((db) => clearSnoozes(db));
                toast.info("Snoozed alerts restored");
              }}
            >
              <BellOff size={14} /> Clear {activeSnoozes.length} snooze{activeSnoozes.length === 1 ? "" : "s"}
            </Button>
          )
        }
      />
      <Tabs
        className="mb-4"
        value={level}
        onChange={setLevel}
        tabs={[
          { value: "all", label: "All", count: alerts.length },
          { value: "critical", label: "Critical", count: counts.critical },
          { value: "caution", label: "Caution", count: counts.caution },
          { value: "info", label: "Informational", count: counts.info },
        ]}
      />
      {shown.length === 0 ? (
        <Callout tone="positive" title="Nothing needs attention">
          {alerts.length === 0 ? "All budgets, reserves and deadlines are inside their thresholds for the selected month." : "No alerts at this level."}
        </Callout>
      ) : (
        <div className="space-y-3">
          {shown.map((a) => (
            <article key={a.key} className="rounded-xl border border-border bg-surface p-4 shadow-card">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 rounded-lg p-1.5 ${a.level === "critical" ? "bg-critical-soft text-critical" : a.level === "caution" ? "bg-caution-soft text-caution" : "bg-info-soft text-info"}`}>{a.level === "critical" ? <ShieldAlert size={16} /> : a.level === "caution" ? <AlertTriangle size={16} /> : <Info size={16} />}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-fg">{a.title}</h3>
                    <Badge tone={levelTone[a.level]}>{a.level}</Badge>
                  </div>
                  <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-fg-muted">What happened</dt>
                      <dd className="text-fg">{a.what}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-fg-muted">Why it matters</dt>
                      <dd className="text-fg">{a.why}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-fg-muted">Financial impact</dt>
                      <dd className="text-fg">{a.impact}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-fg-muted">What to do</dt>
                      <dd className="text-fg">{a.action}</dd>
                    </div>
                  </dl>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {a.href && (
                    <Link href={a.href} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                      Open <ArrowRight size={12} />
                    </Link>
                  )}
                  <button
                    className="text-[11px] text-fg-faint hover:text-fg"
                    onClick={() => {
                      mutate((db) => snoozeAlert(db, a.key, addDays(today, 7)));
                      toast.info("Snoozed for 7 days");
                    }}
                  >
                    Snooze 7 days
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
