"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import { useFinance } from "@/store/FinanceProvider";
import { LogoMark, Wordmark } from "@/components/Logo";
import { formatMoney, type CurrencyCode } from "@/lib/money";
import { applyOnboarding } from "@/onboarding/apply";
import { emptyAnswers, GOALS, isPersonal, PAYMENT_METHODS, PERSONAS, RESERVE_OPTIONS, SUBSCRIPTION_PRESETS, suggestSplit, splitTotal, TAX_OPTIONS, type Goal, type OnboardingAnswers, type PayCadence, type Steadiness, type ClientCount, type Persona } from "@/onboarding/model";
import { AmountList, BigMoney, BigText, ChipMulti, ChoiceGrid, CurrencyPicker, HouseholdList, PercentPicker, SplitEditor } from "./inputs";

/**
 * The setup questionnaire: one question per screen, a progress bar, answers
 * saved as you go. At the end the workspace is written and the dashboard opens.
 *
 *  mode "create"    no workspace yet: the answers create and configure one
 *  mode "configure" the current workspace has not been set up yet
 */

export type Chapter = { id: string; label: string };
export const CHAPTERS: Chapter[] = [
  { id: "you", label: "About you" },
  { id: "in", label: "Money coming in" },
  { id: "out", label: "Money going out" },
  { id: "goals", label: "Your goals" },
];

export interface StepCtx {
  a: OnboardingAnswers;
  set: (patch: Partial<OnboardingAnswers>) => void;
  next: () => void;
}

export interface Step {
  id: string;
  chapter: string;
  title: (a: OnboardingAnswers) => string;
  subtitle?: (a: OnboardingAnswers) => string;
  when?: (a: OnboardingAnswers) => boolean;
  /** Optional steps show a "Skip" button. */
  optional?: boolean;
  /** Single-choice screens continue automatically. */
  auto?: boolean;
  valid?: (a: OnboardingAnswers) => boolean;
  render: (ctx: StepCtx) => React.ReactNode;
}

const money = (v: number, c: CurrencyCode) => formatMoney(v, c, { decimals: 0 });
const first = (name: string) => name.trim().split(/\s+/)[0] || "there";

export const STEPS: Step[] = [
  {
    id: "name",
    chapter: "you",
    title: () => "First things first. What should we call you?",
    subtitle: () => "Just your first name is fine.",
    valid: (a) => a.name.trim().length > 0,
    render: ({ a, set }) => <BigText value={a.name} onChange={(v) => set({ name: v })} placeholder="Your name" />,
  },
  {
    id: "persona",
    chapter: "you",
    title: (a) => `Nice to meet you, ${first(a.name)}. Which of these sounds most like you?`,
    auto: true,
    render: ({ a, set, next }) => (
      <ChoiceGrid
        options={PERSONAS.map((p) => ({ value: p.value, label: p.label, body: p.body, emoji: p.emoji }))}
        value={a.persona}
        onChange={(v: Persona) => {
          set({ persona: v });
          next();
        }}
      />
    ),
  },
  {
    id: "business",
    chapter: "you",
    title: () => "What is your business called?",
    subtitle: () => "You can change it later. It only shows up in your own dashboard.",
    when: (a) => !isPersonal(a),
    valid: (a) => a.businessName.trim().length > 0,
    render: ({ a, set }) => <BigText value={a.businessName} onChange={(v) => set({ businessName: v })} placeholder="e.g. Ayesha Design Studio" />,
  },
  {
    id: "currency",
    chapter: "you",
    title: (a) => (isPersonal(a) ? "Which currency do you earn in?" : "Which currency does the business earn in?"),
    subtitle: () => "Everything is counted in this currency.",
    auto: true,
    render: ({ a, set, next }) => (
      <CurrencyPicker
        value={a.baseCurrency}
        onChange={(v: CurrencyCode) => {
          set({ baseCurrency: v, householdCurrency: a.householdCurrency === a.baseCurrency ? v : a.householdCurrency });
          next();
        }}
      />
    ),
  },
  {
    id: "homeCurrency",
    chapter: "you",
    title: () => "And which currency do you spend at home in?",
    subtitle: () => "Pick the same one if you live where you earn.",
    auto: true,
    render: ({ a, set, next }) => (
      <CurrencyPicker
        value={a.householdCurrency}
        onChange={(v: CurrencyCode) => {
          set({ householdCurrency: v, fxRate: v === a.baseCurrency ? "1" : a.fxRate === "1" ? (v === "PKR" && a.baseCurrency === "USD" ? "280" : "") : a.fxRate });
          next();
        }}
      />
    ),
  },
  {
    id: "fx",
    chapter: "you",
    title: (a) => `Roughly how many ${a.householdCurrency} do you get for 1 ${a.baseCurrency}?`,
    subtitle: () => "A rough number is fine. You can update it any time in Settings.",
    when: (a) => a.householdCurrency !== a.baseCurrency,
    valid: (a) => Number(a.fxRate) > 0,
    render: ({ a, set }) => <BigText value={a.fxRate} onChange={(v) => /^[0-9]*\.?[0-9]*$/.test(v) && set({ fxRate: v })} placeholder="e.g. 280" inputMode="decimal" />,
  },
  {
    id: "country",
    chapter: "you",
    title: (a) => (isPersonal(a) ? "Where do you live?" : "Where do you live and pay your taxes?"),
    subtitle: () => "Country is enough. It labels your tax notes; nothing here is tax advice.",
    optional: true,
    render: ({ a, set }) => <BigText value={a.country} onChange={(v) => set({ country: v })} placeholder="e.g. Pakistan, United States, UAE" />,
  },
  {
    id: "registration",
    chapter: "you",
    title: () => "Is the business registered somewhere else?",
    subtitle: () => "For example a US LLC owned from Pakistan, where the US side files nil returns and tax is paid at home.",
    when: (a) => !isPersonal(a),
    auto: true,
    render: ({ a, set, next }) => (
      <ChoiceGrid
        columns={1}
        options={[
          { value: "home", label: "No, registered where I live", emoji: "🏠" },
          { value: "abroad", label: "Yes, registered in another country", body: "I file there, but I pay my taxes at home.", emoji: "🌍" },
        ]}
        value={a.registration}
        onChange={(v: "home" | "abroad") => {
          set({ registration: v });
          next();
        }}
      />
    ),
  },
  {
    id: "registrationCountry",
    chapter: "you",
    title: () => "Where is the business registered?",
    subtitle: () => "This only labels the entity and adds a reminder for the annual filing there.",
    when: (a) => !isPersonal(a) && a.registration === "abroad",
    valid: (a) => a.registrationCountry.trim().length > 0,
    render: ({ a, set }) => <BigText value={a.registrationCountry} onChange={(v) => set({ registrationCountry: v })} placeholder="e.g. United States (Wyoming LLC), United Kingdom, Estonia" />,
  },
  {
    id: "income",
    chapter: "in",
    title: () => "In a typical month, how much comes in before any costs?",
    subtitle: (a) => `Your best guess in ${a.baseCurrency}. This becomes the bar you fill up each month.`,
    optional: true,
    render: ({ a, set }) => <BigMoney value={a.monthlyIncomeMinor} onChange={(v) => set({ monthlyIncomeMinor: v })} currency={a.baseCurrency} />,
  },
  {
    id: "steadiness",
    chapter: "in",
    title: () => "How steady is that income?",
    auto: true,
    render: ({ a, set, next }) => (
      <ChoiceGrid
        columns={1}
        options={[
          { value: "steady", label: "About the same every month", emoji: "📏" },
          { value: "varies", label: "It moves around a bit", emoji: "〰️" },
          { value: "swings", label: "Feast or famine", emoji: "🎢" },
        ]}
        value={a.steadiness}
        onChange={(v: Steadiness) => {
          set({ steadiness: v });
          next();
        }}
      />
    ),
  },
  {
    id: "payments",
    chapter: "in",
    title: () => "How does the money usually reach you?",
    subtitle: () => "Pick all that apply.",
    optional: true,
    render: ({ a, set }) => <ChipMulti options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} value={a.paymentMethods} onChange={(v) => set({ paymentMethods: v })} />,
  },
  {
    id: "clients",
    chapter: "in",
    title: () => "How many clients or customers pay you in a typical month?",
    when: (a) => !isPersonal(a),
    auto: true,
    render: ({ a, set, next }) => (
      <ChoiceGrid
        options={[
          { value: "1", label: "Just one", body: "One client is most of the income." },
          { value: "2-5", label: "2 to 5" },
          { value: "6-20", label: "6 to 20" },
          { value: "20+", label: "More than 20" },
        ]}
        value={a.clientCount}
        onChange={(v: ClientCount) => {
          set({ clientCount: v });
          next();
        }}
      />
    ),
  },
  {
    id: "businessCash",
    chapter: "in",
    title: (a) => (isPersonal(a) ? "How much is in the account your income lands in right now?" : "How much is in the business account right now?"),
    subtitle: () => "Today's balance. Skip it if you would rather fill it in later.",
    optional: true,
    render: ({ a, set }) => <BigMoney value={a.businessCashMinor} onChange={(v) => set({ businessCashMinor: v })} currency={a.baseCurrency} />,
  },
  {
    id: "taxSaved",
    chapter: "in",
    title: () => "Is any money already set aside for tax?",
    optional: true,
    render: ({ a, set }) => <BigMoney value={a.taxSavedMinor} onChange={(v) => set({ taxSavedMinor: v })} currency={a.baseCurrency} />,
  },
  {
    id: "reserveSaved",
    chapter: "in",
    title: () => "Any savings kept as a cushion for slow months?",
    optional: true,
    render: ({ a, set }) => <BigMoney value={a.reserveSavedMinor} onChange={(v) => set({ reserveSavedMinor: v })} currency={a.baseCurrency} />,
  },
  {
    id: "subscriptions",
    chapter: "out",
    title: (a) => (isPersonal(a) ? "Which subscriptions do you pay for every month?" : "Which tools and subscriptions does the business pay for every month?"),
    subtitle: () => "Tap the ones you have, then add the amount. Add your own too.",
    optional: true,
    render: ({ a, set }) => <AmountList items={a.subscriptions} onChange={(v) => set({ subscriptions: v })} currency={a.baseCurrency} presets={SUBSCRIPTION_PRESETS} namePlaceholder="Tool or subscription" addLabel="Add your own" />,
  },
  {
    id: "otherCosts",
    chapter: "out",
    title: () => "Any other regular business costs?",
    subtitle: () => "Contractors, an office, ads, an accountant. Anything that repeats.",
    when: (a) => !isPersonal(a),
    optional: true,
    render: ({ a, set }) => <AmountList items={a.otherCosts} onChange={(v) => set({ otherCosts: v })} currency={a.baseCurrency} presets={[{ name: "Contractors" }, { name: "Office or co-working" }, { name: "Accountant" }, { name: "Insurance" }]} namePlaceholder="Cost" addLabel="Add a cost" frequencies />,
  },
  {
    id: "household",
    chapter: "out",
    title: () => "How much do you need at home every month?",
    subtitle: (a) => `The essentials, in ${a.householdCurrency}. Leave anything that does not apply at zero.`,
    optional: true,
    render: ({ a, set }) => <HouseholdList items={a.household} onChange={(v) => set({ household: v })} currency={a.householdCurrency} />,
  },
  {
    id: "personalCash",
    chapter: "out",
    title: () => "How much is in your personal spending account right now?",
    optional: true,
    render: ({ a, set }) => <BigMoney value={a.personalCashMinor} onChange={(v) => set({ personalCashMinor: v })} currency={a.householdCurrency} />,
  },
  {
    id: "cadence",
    chapter: "out",
    title: () => "How often do you pay yourself?",
    when: (a) => !isPersonal(a),
    auto: true,
    render: ({ a, set, next }) => (
      <ChoiceGrid
        options={[
          { value: "weekly", label: "Every week" },
          { value: "biweekly", label: "Twice a month" },
          { value: "monthly", label: "Once a month" },
          { value: "whenever", label: "Whenever there is money", body: "That is what we are here to change." },
        ]}
        value={a.payCadence}
        onChange={(v: PayCadence) => {
          set({ payCadence: v });
          next();
        }}
      />
    ),
  },
  {
    id: "goals",
    chapter: "goals",
    title: () => "What do you want most from CFoh!?",
    subtitle: () => "Pick as many as you like. Your dashboard leads with these.",
    valid: (a) => a.goals.length > 0,
    render: ({ a, set }) => <ChipMulti options={GOALS.map((g) => ({ value: g.value, label: g.label, emoji: g.emoji }))} value={a.goals} onChange={(v: Goal[]) => set({ goals: v })} />,
  },
  {
    id: "tax",
    chapter: "goals",
    title: (a) => (a.registration === "abroad" && !isPersonal(a) ? `What share of your income goes to tax at home${a.country.trim() ? ` in ${a.country.trim()}` : ""}?` : "What share of your income goes to tax where you live?"),
    subtitle: (a) => `Type any number: your estimate, or your accountant's. ${a.registration === "abroad" && !isPersonal(a) ? "Nil filings where the business is registered do not count here. " : ""}CFoh! sets this share aside as money comes in; it does not calculate your tax.`,
    valid: (a) => a.taxPct >= 0 && a.taxPct <= 60,
    render: ({ a, set }) => <PercentPicker value={a.taxPct} onChange={(v) => set({ taxPct: v })} presets={TAX_OPTIONS} />,
  },
  {
    id: "reserve",
    chapter: "goals",
    title: () => "How many months of costs would you like saved as a cushion?",
    auto: true,
    render: ({ a, set, next }) => (
      <ChoiceGrid
        columns={3}
        options={RESERVE_OPTIONS.map((m) => ({ value: String(m), label: `${m} month${m > 1 ? "s" : ""}`, body: m === 1 ? "A start." : m === 3 ? "Most people's target." : "Sleep-well territory." }))}
        value={String(a.reserveMonths)}
        onChange={(v) => {
          set({ reserveMonths: Number(v) });
          next();
        }}
      />
    ),
  },
  {
    id: "split",
    chapter: "goals",
    title: () => "Here is your split. Every unit that comes in gets a job.",
    subtitle: (a) => `Built from your answers${a.monthlyIncomeMinor > 0 ? `, shown on a typical ${money(a.monthlyIncomeMinor, a.baseCurrency)} month` : ""}. Nudge anything you like; it must add up to 100%.`,
    valid: (a) => splitTotal(a.split) === 100,
    render: ({ a, set }) => <SplitEditor value={a.split} onChange={(v) => set({ split: v })} incomeMinor={a.monthlyIncomeMinor} currency={a.baseCurrency} personal={isPersonal(a)} />,
  },
];

const draftKey = (mode: string, id: string | null) => `finance-os:onboarding:${mode}:${id ?? "new"}`;

/** Auto-advancing screens can fire twice on a double tap; ignore a second advance within a third of a second. */
let lastAdvanceAt = 0;

export function Onboarding({ mode }: { mode: "create" | "configure" }) {
  const { createWorkspace, mutate, currentWorkspace, cloudUser, signOut, data } = useFinance();
  const wsId = mode === "configure" ? (currentWorkspace?.id ?? null) : null;
  const key = draftKey(mode, wsId);

  const [state, setState] = useState<{ a: OnboardingAnswers; i: number; touchedSplit: boolean }>(() => {
    const base = emptyAnswers();
    if (mode === "configure" && data) {
      base.businessName = data.settings.businessName === "My business" ? "" : data.settings.businessName;
      base.name = data.settings.ownerName === "Owner" ? "" : data.settings.ownerName;
      base.baseCurrency = data.settings.baseCurrency as CurrencyCode;
      base.householdCurrency = data.settings.householdCurrency as CurrencyCode;
      base.fxRate = base.baseCurrency === base.householdCurrency ? "1" : data.settings.defaultFxRatePkrPerUsd;
    }
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const d = JSON.parse(raw) as { a: OnboardingAnswers; i: number; touchedSplit?: boolean };
        return { a: { ...base, ...d.a }, i: d.i ?? 0, touchedSplit: !!d.touchedSplit };
      }
    } catch {
      /* ignore */
    }
    return { a: base, i: 0, touchedSplit: false };
  });
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [phase, setPhase] = useState<"questions" | "building" | "error">("questions");
  const [error, setError] = useState<string | null>(null);

  const steps = useMemo(() => STEPS.filter((s) => !s.when || s.when(state.a)), [state.a]);
  const i = Math.min(state.i, steps.length - 1);
  const step = steps[i];
  const a = state.a;

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [key, state]);

  const set = useCallback((patch: Partial<OnboardingAnswers>) => {
    setState((s) => ({ ...s, a: { ...s.a, ...patch }, touchedSplit: s.touchedSplit || "split" in patch }));
  }, []);

  const finish = useCallback(
    async (final: OnboardingAnswers) => {
      setPhase("building");
      const started = Date.now();
      try {
        const answers: OnboardingAnswers = { ...final, completedAt: new Date().toISOString() };
        const wait = new Promise((r) => setTimeout(r, Math.max(0, 2600 - (Date.now() - started))));
        if (mode === "create") {
          const businessName = answers.businessName.trim() || (isPersonal(answers) ? `${first(answers.name)}'s money` : "My business");
          await wait;
          await createWorkspace({ name: businessName, businessName, ownerName: answers.name.trim(), template: "blank", baseCurrency: answers.baseCurrency, householdCurrency: answers.householdCurrency, afterSeed: (db) => applyOnboarding(db, answers) });
        } else {
          await wait;
          mutate((db) => applyOnboarding(db, answers));
        }
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    },
    [mode, createWorkspace, mutate, key],
  );

  const goTo = useCallback(
    (n: number, d: "fwd" | "back") => {
      setDir(d);
      setState((s) => ({ ...s, i: n }));
      window.scrollTo({ top: 0 });
    },
    [],
  );

  const next = useCallback(() => {
    const now = Date.now();
    if (now - lastAdvanceAt < 350) return;
    lastAdvanceAt = now;
    setState((s) => {
      const visible = STEPS.filter((st) => !st.when || st.when(s.a));
      const cur = Math.min(s.i, visible.length - 1);
      const nextIdx = cur + 1;
      // Entering the split screen: propose a split from everything answered so far (unless they already adjusted it).
      let a2 = s.a;
      if (visible[nextIdx]?.id === "split" && !s.touchedSplit) a2 = { ...s.a, split: suggestSplit(s.a) };
      if (nextIdx >= visible.length) {
        void finish(a2);
        return { ...s, a: a2 };
      }
      return { ...s, a: a2, i: nextIdx };
    });
    setDir("fwd");
    window.scrollTo({ top: 0 });
  }, [finish]);

  const back = () => i > 0 && goTo(i - 1, "back");
  const valid = step.valid ? step.valid(a) : true;
  const chapterIdx = CHAPTERS.findIndex((c) => c.id === step.chapter);
  const progress = ((i + 1) / (steps.length + 1)) * 100;
  const isLast = i === steps.length - 1;

  if (phase === "building" || phase === "error") return <Building name={first(a.name)} error={phase === "error" ? error : null} onRetry={() => setPhase("questions")} />;

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-bg text-fg" data-onboarding>
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4">
          <button type="button" onClick={back} disabled={i === 0} className="flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2 disabled:opacity-0" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
              <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <LogoMark size={22} />
            <span className="hidden sm:inline">
              <Wordmark size="sm" />
            </span>
          </div>
          {mode === "create" && cloudUser && (
            <button type="button" onClick={() => void signOut(false)} className="text-[11px] font-medium text-fg-faint hover:text-fg">
              Sign out
            </button>
          )}
        </div>
      </header>

      <form
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-32 pt-8 sm:pt-12"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) next();
        }}
      >
        <div key={step.id} className={dir === "fwd" ? "step-in" : "step-back"} data-step={step.id}>
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-accent">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft text-[10px]">{chapterIdx + 1}</span>
            {CHAPTERS[chapterIdx]?.label} · {i + 1} of {steps.length}
          </div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-fg sm:text-3xl">{step.title(a)}</h1>
          {step.subtitle && <p className="mt-2 text-sm text-fg-muted sm:text-base">{step.subtitle(a)}</p>}
          <div className="mt-6 sm:mt-8">{step.render({ a, set, next })}</div>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
            {step.optional && !step.auto && (
              <button type="button" onClick={next} className="h-12 rounded-xl px-4 text-sm font-medium text-fg-muted hover:bg-surface-2 hover:text-fg">
                Skip for now
              </button>
            )}
            <div className="flex-1" />
            {!step.auto && (
              <button type="submit" disabled={!valid} className={clsx("inline-flex h-12 items-center gap-2 rounded-xl px-6 text-base font-semibold shadow-[0_10px_30px_-10px_var(--accent)] transition-transform active:scale-[0.98] disabled:opacity-40 disabled:shadow-none", "bg-accent text-accent-fg hover:brightness-110")}>
                {isLast ? (
                  <>
                    <Sparkles size={16} /> Build my dashboard
                  </>
                ) : (
                  <>
                    Continue <ArrowRight size={16} />
                  </>
                )}
              </button>
            )}
            {step.auto && <span className="text-xs text-fg-faint">Tap an option to continue</span>}
          </div>
        </div>
      </form>
    </div>
  );
}

const BUILD_LINES = ["Setting up your split", "Filing your running costs", "Preparing your home budget", "Drawing your dashboard"];

function Building({ name, error, onRetry }: { name: string; error: string | null; onRetry: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (error) return;
    const t = setInterval(() => setN((x) => Math.min(BUILD_LINES.length, x + 1)), 600);
    return () => clearInterval(t);
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm text-center pop-in">
        <div className="mx-auto flex w-fit items-center gap-2">
          <LogoMark size={36} />
          <Wordmark size="md" />
        </div>
        {error ? (
          <>
            <h1 className="mt-6 text-xl font-semibold text-fg">Something went wrong</h1>
            <p className="mt-2 text-sm text-critical">{error}</p>
            <button type="button" onClick={onRetry} className="mt-5 h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-fg">
              Go back and try again
            </button>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-xl font-semibold text-fg">Building your dashboard, {name}…</h1>
            <ul className="mt-6 space-y-2.5 text-left">
              {BUILD_LINES.map((l, idx) => (
                <li key={l} className={clsx("flex items-center gap-3 text-sm transition-opacity", idx < n ? "text-fg" : "text-fg-faint opacity-60")}>
                  <span className={clsx("flex h-6 w-6 items-center justify-center rounded-full border", idx < n ? "border-positive bg-positive-soft text-positive" : "border-border")}>{idx < n ? <Check size={13} /> : <span className="h-2 w-2 animate-pulse rounded-full bg-fg-faint" />}</span>
                  {l}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
