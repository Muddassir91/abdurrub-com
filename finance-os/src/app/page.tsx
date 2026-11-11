import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, X, PlayCircle } from "lucide-react";
import { LogoMark, Wordmark } from "@/components/Logo";
import { RotatingHeadline } from "@/components/marketing/RotatingHeadline";
import { DemoVideo } from "@/components/marketing/DemoVideo";
import { Reveal } from "@/components/marketing/Reveal";
import { Founder } from "@/components/marketing/Founder";
import { AuthForwarder } from "@/components/marketing/AuthForwarder";

export const metadata: Metadata = {
  title: "CFoh! · Make better financial decisions",
  description: "Track your finances, spending and profit without hiring a CFO. Every dollar collected gets a job: operating, owner pay, tax, profit, reserve and growth.",
  robots: { index: true, follow: true },
};


const OLD_WAY = [
  "One bank balance for everything, so every number looks spendable.",
  "Subscriptions stack up quietly; you find out at month end.",
  "Pay yourself whatever is left. Some months too much, some months nothing.",
  "Tax arrives as a surprise.",
  "Client revenue and your own revenue blur into one figure.",
  "A spreadsheet that breaks the moment work gets busy.",
  "No idea whether you can afford that hire or that tool.",
];

const NEW_WAY = ["Say what happened in plain words. It is recorded and every number updates.", "Every dollar collected gets a job the moment it lands.", "See what you can spend, pay yourself and save, today."];

const WHO = [
  { title: "Freelancers", body: "Irregular income, one account, and a tax bill you would rather see coming." },
  { title: "Solopreneurs", body: "You are the CEO, the delivery team and the finance department. Keep the last one simple." },
  { title: "Agency owners", body: "Retainers, revenue shares, processors holding funds, people to pay. Know your real margin." },
  { title: "Anyone trying to keep up with their spending", body: "If money disappears and you cannot say where, start here." },
];

const cta = "inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-base font-semibold text-accent-fg shadow-[0_10px_30px_-10px_var(--accent)] transition-transform hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0";
const ghost = "inline-flex h-12 items-center gap-2 rounded-xl border border-border-strong bg-surface px-6 text-base font-medium text-fg transition-transform hover:-translate-y-0.5 hover:bg-surface-2 active:translate-y-0";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <AuthForwarder />
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="CFoh! home">
            <LogoMark size={32} />
            <Wordmark size="md" />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a href="#demo" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-fg-muted hover:text-fg md:inline-block">
              Watch the demo
            </a>
            <Link href="/app/" className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted hover:text-fg">
              Sign in
            </Link>
            <Link href="/app/" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg shadow-sm transition-transform hover:-translate-y-0.5 hover:brightness-110">
              Start free <ArrowRight size={15} />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-[-14rem] h-[36rem] w-[70rem] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-5 pb-8 pt-14 text-center sm:px-8 sm:pt-20">
          <Reveal>
            <RotatingHeadline className="mx-auto max-w-4xl text-4xl leading-[1.08] sm:text-6xl" fixed="Make better financial decisions" phrases={["by tracking your spending.", "by tracking your cash flow.", "by tracking your profit.", "without hiring an accountant."]} />
          </Reveal>
          <Reveal delay={120}>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-fg-muted sm:text-xl">Track your finances, spending and profit without hiring a CFO.</p>
          </Reveal>
          <Reveal delay={220}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/app/" className={cta}>
                Start your free month <ArrowRight size={16} />
              </Link>
              <a href="#demo" className={ghost}>
                <PlayCircle size={18} /> Watch the demo
              </a>
            </div>
            <p className="mt-3 text-xs text-fg-faint">Free for 30 days. No card. Works on phone and laptop.</p>
          </Reveal>
        </div>
        {/* The product video */}
        <div id="demo" className="relative mx-auto max-w-5xl scroll-mt-24 px-5 pb-20 sm:px-8">
          <Reveal delay={320}>
            <DemoVideo />
          </Reveal>
        </div>
      </section>

      {/* Old way vs new way */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8">
          <Reveal>
            <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">Two ways to run the money.</h2>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <Reveal delay={80} className="rounded-3xl border border-border bg-bg p-7 transition-shadow hover:shadow-card">
              <div className="text-xs font-semibold uppercase tracking-wider text-fg-faint">The old way</div>
              <ul className="mt-5 space-y-3.5">
                {OLD_WAY.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-[15px] text-fg-muted">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-critical-soft text-critical">
                      <X size={12} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={200} className="relative rounded-3xl border border-accent/30 bg-accent-soft/60 p-7 transition-transform hover:-translate-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
                The <Wordmark size="sm" /> way
              </div>
              <ul className="mt-5 space-y-4">
                {NEW_WAY.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-[17px] font-medium text-fg">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
                      <Check size={13} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
              <Link href="/app/" className="mt-8 inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-fg hover:brightness-110">
                Switch to the new way <ArrowRight size={15} />
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Who it is for */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <Reveal>
          <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
            Who needs <Wordmark size="xl" className="align-baseline text-3xl sm:text-4xl" />
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {WHO.map((w, i) => (
            <Reveal key={w.title} delay={i * 90} className="group rounded-3xl border border-border bg-surface p-6 shadow-card transition-all hover:-translate-y-1 hover:border-accent/40 hover:shadow-[0_24px_50px_-24px_rgba(79,70,229,0.45)]">
              <div className="mb-4 h-1.5 w-10 rounded-full bg-accent/40 transition-all group-hover:w-16 group-hover:bg-accent" />
              <div className="text-lg font-semibold tracking-tight">{w.title}</div>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{w.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <Founder />

      <section className="mx-auto max-w-6xl px-5 py-20 text-center sm:px-8">
        <Reveal>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Give every dollar a job this month.</h2>
          <p className="mx-auto mt-3 max-w-xl text-fg-muted">Set up takes two minutes. Your first dashboard shows up the moment you record your first payment.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/app/" className={cta}>
              Start your free month <ArrowRight size={16} />
            </Link>
            <a href="#demo" className={ghost}>
              Watch the demo
            </a>
          </div>
          <p className="mt-3 text-xs text-fg-faint">Free for 30 days. Sign in to keep everything in sync across devices.</p>
        </Reveal>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-5 py-8 text-xs text-fg-faint sm:flex-row sm:items-center sm:px-8">
          <div className="flex items-center gap-2">
            <LogoMark size={22} />
            <span>CFoh! by Retention Rules</span>
          </div>
          <p className="max-w-xl">CFoh! is a financial planning and tracking tool. It does not provide tax, legal, accounting or investment advice. Figures are based on what you enter; confirm tax matters with a qualified professional.</p>
        </div>
      </footer>
    </div>
  );
}
