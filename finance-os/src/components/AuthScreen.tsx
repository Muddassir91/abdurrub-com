"use client";

import React, { useState } from "react";
import { clsx } from "clsx";
import { Mail, KeyRound, Smartphone } from "lucide-react";
import { useFinance } from "@/store/FinanceProvider";
import { Button, Callout } from "./ui/primitives";
import { Field, Input } from "./ui/forms";
import { LogoMark, Wordmark } from "./Logo";

type Mode = "signin" | "signup" | "magic" | "reset";

/** Sign in / sign up. An account makes your workspaces follow you across devices; it is optional. */
export function AuthScreen() {
  const { signIn, signUp, sendMagicLink, sendPasswordReset, continueWithoutAccount, workspaces } = useFinance();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email.trim(), password);
      else if (mode === "signup") {
        if (password.length < 8) throw new Error("Password must be at least 8 characters");
        const r = await signUp(email.trim(), password);
        if (r.needsEmailConfirmation) setNotice("Check your inbox: click the confirmation link, then sign in here.");
      } else if (mode === "magic") {
        await sendMagicLink(email.trim());
        setNotice("Check your inbox for a sign-in link.");
      } else {
        await sendPasswordReset(email.trim());
        setNotice("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const tabs: { value: Mode; label: string }[] = [
    { value: "signin", label: "Sign in" },
    { value: "signup", label: "Create account" },
    { value: "magic", label: "Email link" },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4 sm:p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <LogoMark size={40} />
          <Wordmark size="lg" />
        </div>
        <form onSubmit={submit} className="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <div className="mb-4 inline-flex w-full rounded-lg border border-border bg-surface-2 p-1" role="tablist">
            {tabs.map((t) => (
              <button key={t.value} type="button" role="tab" aria-selected={mode === t.value} onClick={() => { setMode(t.value); setError(null); setNotice(null); }} className={clsx("flex-1 rounded-md px-2 py-1.5 text-xs font-medium", mode === t.value ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}>
                {t.label}
              </button>
            ))}
          </div>
          <h1 className="text-base font-semibold text-fg">{mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : mode === "magic" ? "Sign in with an email link" : "Reset your password"}</h1>
          <p className="mt-1 text-xs text-fg-muted">Your workspaces are stored privately under your account and follow you across devices. Set a passphrase on a workspace and even we cannot read it.</p>
          <div className="mt-4 space-y-3">
            <Field label="Email" required>
              <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourbusiness.com" required />
            </Field>
            {(mode === "signin" || mode === "signup") && (
              <Field label="Password" required hint={mode === "signup" ? "At least 8 characters." : undefined}>
                <Input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
            )}
          </div>
          {error && <Callout tone="critical" className="mt-3">{error}</Callout>}
          {notice && <Callout tone="positive" className="mt-3">{notice}</Callout>}
          <Button type="submit" variant="primary" className="mt-4 w-full" loading={busy} disabled={!email || ((mode === "signin" || mode === "signup") && !password)}>
            {mode === "signin" ? <><KeyRound size={14} /> Sign in</> : mode === "signup" ? "Create account" : mode === "magic" ? <><Mail size={14} /> Send sign-in link</> : "Send reset link"}
          </Button>
          <div className="mt-3 flex items-center justify-between text-[11px] text-fg-faint">
            {mode === "signin" ? <button type="button" className="hover:text-fg" onClick={() => setMode("reset")}>Forgot password?</button> : <span />}
            <button type="button" className="hover:text-fg" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>{mode === "signup" ? "Already have an account? Sign in" : "New here? Create account"}</button>
          </div>
        </form>
        <button type="button" onClick={continueWithoutAccount} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong px-4 py-3 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg">
          <Smartphone size={14} /> Continue without an account on this device only{workspaces.length > 0 ? ` (${workspaces.length} local workspace${workspaces.length === 1 ? "" : "s"})` : ""}
        </button>
        <p className="mt-4 text-center text-[11px] text-fg-faint">Signing in later uploads this device&apos;s workspaces to your account automatically.</p>
      </div>
    </div>
  );
}
