"use client";

import React, { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { useFinance } from "@/store/FinanceProvider";
import { AppShell } from "./AppShell";
import { Button } from "./ui/primitives";
import { Input } from "./ui/forms";
import { WorkspaceForm } from "./WorkspaceForm";
import { LogoMark, Wordmark } from "./Logo";
import { AuthScreen } from "./AuthScreen";

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-bg p-4 sm:p-6">{children}</div>;
}

export function Gate({ children }: { children: React.ReactNode }) {
  const { status, error, unlock, createWorkspace, workspaces, currentWorkspace, switchWorkspace } = useFinance();
  const [pass, setPass] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  if (status === "loading") {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-3 text-sm text-fg-muted">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Opening your finance database…
        </div>
      </Centered>
    );
  }
  if (status === "error") {
    return (
      <Centered>
        <div className="max-w-md rounded-xl border border-critical/30 bg-surface p-6 text-sm">
          <div className="font-semibold text-critical">Could not start</div>
          <p className="mt-2 text-fg-muted">{error}</p>
          <p className="mt-3 text-xs text-fg-faint">Reload the page. If the problem persists, restore from a backup in a fresh browser profile.</p>
        </div>
      </Centered>
    );
  }
  if (status === "auth") return <AuthScreen />;
  if (status === "setup") {
    return (
      <Centered>
        <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 shadow-card sm:p-8">
          <div className="flex items-center gap-3">
            <LogoMark size={40} />
            <div>
              <h1 className="text-lg font-semibold text-fg">Set up <Wordmark size="md" /></h1>
              <p className="text-sm text-fg-muted">Create your first workspace. One workspace per business or person; you can add more later from the sidebar.</p>
            </div>
          </div>
          <div className="mt-6">
            <WorkspaceForm onSubmit={createWorkspace} submitLabel="Create workspace and open" />
          </div>
          <p className="mt-5 text-[11px] text-fg-faint">No server, no account online. Everything you enter stays in this browser; use backups to move it elsewhere.</p>
        </div>
      </Centered>
    );
  }
  if (status === "locked") {
    return (
      <Centered>
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
              <div className="text-sm font-semibold text-fg">{currentWorkspace?.name ?? "Workspace"} is locked</div>
              <div className="text-xs text-fg-muted">Enter the passphrase for this workspace.</div>
            </div>
          </div>
          <Input className="mt-5" type="password" autoFocus placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} />
          {bad && <p className="mt-2 text-xs text-critical">Wrong passphrase. Try again.</p>}
          <Button type="submit" variant="primary" className="mt-4 w-full" loading={busy} disabled={!pass}>
            Unlock
          </Button>
          {workspaces.length > 1 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-1 text-[11px] font-medium text-fg-muted">Open a different workspace</div>
              <div className="flex flex-wrap gap-1.5">
                {workspaces
                  .filter((w) => w.id !== currentWorkspace?.id)
                  .map((w) => (
                    <button key={w.id} type="button" onClick={() => void switchWorkspace(w.id)} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-fg hover:bg-border">
                      {w.name}
                    </button>
                  ))}
              </div>
            </div>
          )}
          <p className="mt-4 flex items-start gap-1.5 text-[11px] text-fg-faint">
            <ShieldCheck size={12} className="mt-0.5 shrink-0" /> Encrypted with AES-256 in this browser. There is no recovery if the passphrase is lost; keep a backup export somewhere safe.
          </p>
        </form>
      </Centered>
    );
  }
  return <AppShell>{children}</AppShell>;
}
