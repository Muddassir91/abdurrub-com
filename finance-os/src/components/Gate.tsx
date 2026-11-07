"use client";

import React, { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { useFinance } from "@/store/FinanceProvider";
import { AppShell } from "./AppShell";
import { Button } from "./ui/primitives";
import { Input } from "./ui/forms";

export function Gate({ children }: { children: React.ReactNode }) {
  const { status, error, unlock } = useFinance();
  const [pass, setPass] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-3 text-sm text-fg-muted">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Opening your finance database…
        </div>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <div className="max-w-md rounded-xl border border-critical/30 bg-surface p-6 text-sm">
          <div className="font-semibold text-critical">Could not start</div>
          <p className="mt-2 text-fg-muted">{error}</p>
          <p className="mt-3 text-xs text-fg-faint">Reload the page. If the problem persists, restore from a backup in a fresh browser profile.</p>
        </div>
      </div>
    );
  }
  if (status === "locked") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <form
          className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const ok = await unlock(pass);
            setBusy(false);
            setBad(!ok);
            if (!ok) setPass("");
          }}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Lock size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold text-fg">Finance OS is locked</div>
              <div className="text-xs text-fg-muted">Enter your passphrase to decrypt your data.</div>
            </div>
          </div>
          <Input className="mt-5" type="password" autoFocus placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} />
          {bad && <p className="mt-2 text-xs text-critical">Wrong passphrase. Try again.</p>}
          <Button type="submit" variant="primary" className="mt-4 w-full" loading={busy} disabled={!pass}>
            Unlock
          </Button>
          <p className="mt-4 flex items-start gap-1.5 text-[11px] text-fg-faint">
            <ShieldCheck size={12} className="mt-0.5 shrink-0" /> Encrypted with AES-256 in this browser. There is no recovery if the passphrase is lost; keep a backup export somewhere safe.
          </p>
        </form>
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}
