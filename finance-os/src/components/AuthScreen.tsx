"use client";

import React, { useState } from "react";
import { clsx } from "clsx";
import { ArrowRight, CheckCircle2, Loader2, Smartphone } from "lucide-react";
import { useFinance } from "@/store/FinanceProvider";
import { LogoMark, Wordmark } from "./Logo";

type Mode = "signin" | "signup" | "magic" | "reset";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10 7.1-17z" />
      <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.5-5.8c-2.1 1.4-4.8 2.3-8.1 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

const field = "h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-[15px] text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15";

/** Sign in / create account. Accounts make workspaces follow you across devices; they are optional. */
export function AuthScreen() {
  const { signIn, signUp, sendMagicLink, sendPasswordReset, signInWithGoogle, continueWithoutAccount, workspaces } = useFinance();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"form" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy("form");
    try {
      if (mode === "signin") await signIn(email.trim(), password);
      else if (mode === "signup") {
        if (password.length < 8) throw new Error("Use at least 8 characters for your password.");
        const r = await signUp(email.trim(), password);
        if (r.needsEmailConfirmation) setNotice(`We sent a confirmation link to ${email.trim()}. Click it, then sign in here.`);
      } else if (mode === "magic") {
        await sendMagicLink(email.trim());
        setNotice(`A sign-in link is on its way to ${email.trim()}.`);
      } else {
        await sendPasswordReset(email.trim());
        setNotice("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    setError(null);
    setBusy("google");
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const title = mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : mode === "magic" ? "Sign in with a link" : "Reset your password";
  const subtitle = mode === "signin" ? "Sign in to open your workspaces." : mode === "signup" ? "Free. Your numbers stay private to you." : mode === "magic" ? "No password needed. We email you a one-time link." : "We email you a link to choose a new password.";

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Brand panel */}
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[#1c1a4f] p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-accent/50 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full bg-[#2dd4bf]/25 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <LogoMark size={40} />
          <Wordmark size="lg" className="text-white [&>span:last-child]:text-[#c7c2ff]" />
        </div>
        <div className="relative max-w-lg">
          <h2 className="text-[2.75rem] font-semibold leading-[1.1] tracking-tight">Make better financial decisions.</h2>
          <p className="mt-5 text-lg leading-relaxed text-white/70">Track your finances, spending and profit without hiring a CFO.</p>
        </div>
        <div className="relative" />
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark size={36} />
            <Wordmark size="lg" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p>

          {(mode === "signin" || mode === "signup") && (
            <>
              <button type="button" onClick={google} disabled={busy !== null} className="mt-7 flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-border-strong bg-surface text-[15px] font-medium text-fg shadow-sm transition-colors hover:bg-surface-2 disabled:opacity-60">
                {busy === "google" ? <Loader2 size={18} className="animate-spin" /> : <GoogleIcon />}
                Continue with Google
              </button>
              <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-fg-faint">
                <span className="h-px flex-1 bg-border" />
                or with email
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={submit} className={clsx("space-y-3", mode !== "signin" && mode !== "signup" && "mt-7")}>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-fg-muted">Email</span>
              <input className={field} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourbusiness.com" required />
            </label>
            {(mode === "signin" || mode === "signup") && (
              <label className="block">
                <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-fg-muted">
                  Password
                  {mode === "signin" && (
                    <button type="button" className="font-medium text-accent hover:underline" onClick={() => switchMode("reset")}>
                      Forgot password?
                    </button>
                  )}
                </span>
                <input className={field} type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} required minLength={mode === "signup" ? 8 : undefined} />
              </label>
            )}
            {error && <div className="rounded-xl border border-critical/30 bg-critical-soft px-3.5 py-2.5 text-sm text-critical">{error}</div>}
            {notice && (
              <div className="flex items-start gap-2 rounded-xl border border-positive/30 bg-positive-soft px-3.5 py-2.5 text-sm text-fg">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-positive" /> {notice}
              </div>
            )}
            <button type="submit" disabled={busy !== null || !email || ((mode === "signin" || mode === "signup") && !password)} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-accent-fg shadow-sm transition hover:brightness-110 disabled:opacity-50">
              {busy === "form" ? <Loader2 size={18} className="animate-spin" /> : null}
              {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : mode === "magic" ? "Email me a sign-in link" : "Send reset link"}
              {busy !== "form" && <ArrowRight size={16} />}
            </button>
          </form>

          <div className="mt-5 space-y-2 text-center text-sm text-fg-muted">
            {mode === "signin" && (
              <>
                <p>
                  New to CFoh!?{" "}
                  <button type="button" className="font-medium text-accent hover:underline" onClick={() => switchMode("signup")}>
                    Create an account
                  </button>
                </p>
                <p>
                  <button type="button" className="text-fg-faint hover:text-fg" onClick={() => switchMode("magic")}>
                    Prefer a sign-in link by email?
                  </button>
                </p>
              </>
            )}
            {mode === "signup" && (
              <p>
                Already have an account?{" "}
                <button type="button" className="font-medium text-accent hover:underline" onClick={() => switchMode("signin")}>
                  Sign in
                </button>
              </p>
            )}
            {(mode === "magic" || mode === "reset") && (
              <p>
                <button type="button" className="font-medium text-accent hover:underline" onClick={() => switchMode("signin")}>
                  Back to sign in
                </button>
              </p>
            )}
          </div>

          <div className="mt-8 border-t border-border pt-5">
            <button type="button" onClick={continueWithoutAccount} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg">
              <Smartphone size={15} /> Continue without an account on this device only{workspaces.length > 0 ? ` (${workspaces.length} saved here)` : ""}
            </button>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-fg-faint">
              By continuing you agree this is a financial planning tool, not tax or legal advice. Sign in later and anything saved on this device joins your account.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
