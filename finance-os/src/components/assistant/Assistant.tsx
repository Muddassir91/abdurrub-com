"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { AlertCircle, ArrowUp, Check, Mic, RotateCcw, Sparkles, X } from "lucide-react";
import { useFinance, useReady } from "@/store/FinanceProvider";
import { useTheme } from "@/components/AppShell";
import { CONFIRM_FIRST, runAction, type ActionResult, type RawAction, type UiEffect } from "@/assistant/actions";
import { parseLocal } from "@/assistant/parser";
import { buildContext } from "@/assistant/context";
import { askModel, assistantUrl, ModelError, type ModelTurn } from "@/assistant/client";
import { answerLocal, modelUnavailable } from "@/assistant/answers";

/**
 * The assistant: type (or say) what happened or what you want changed, from
 * anywhere in the app. Everyday commands are understood on the device and
 * applied instantly; anything else goes to the model on Cloudflare, which
 * answers with actions the app validates and runs.
 */

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  results?: { ok: boolean; text: string }[];
  /** Actions the model proposed that need a yes first. */
  pending?: RawAction[];
  undoable?: boolean;
  via?: "device" | "model";
  failed?: boolean;
}

interface AssistantApi {
  messages: ChatMessage[];
  busy: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  /** Send a message. Resolves with the assistant's reply message. */
  ask: (text: string) => Promise<ChatMessage | null>;
  undo: () => Promise<ChatMessage | null>;
  confirm: (id: number, yes: boolean) => void;
  canUndo: boolean;
  modelConnected: boolean;
  /** Put text in the box for the person to finish or send. */
  prefill: (text: string) => void;
  draft: { text: string; n: number };
}

const Ctx = createContext<AssistantApi | null>(null);
export function useAssistant(): AssistantApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAssistant outside AssistantProvider");
  return v;
}

/** Examples. "fill" ones go into the box to be edited; the rest are safe to run on a tap. */
export const EXAMPLES: { text: string; fill?: boolean }[] = [
  { text: "Spent 20 on lunch", fill: true },
  { text: "Got paid 1,200 from ", fill: true },
  { text: "Paid myself 500", fill: true },
  { text: "Simple dashboard" },
  { text: "Review my setup" },
  { text: "How much is left for running costs?" },
  { text: "My tax is 1%", fill: true },
];

let nextId = 1;

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { data, snapshot, mutate, month, today, setMonth, setDisplayCurrency, exportDatabase, replaceDatabase, openSetup } = useReady();
  const router = useRouter();
  const { setPref } = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const undoRef = useRef<{ bytes: Uint8Array; label: string } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const historyRef = useRef<ModelTurn[]>([]);
  const [draft, setDraft] = useState({ text: "", n: 0 });
  const prefill = useCallback((text: string) => setDraft((d) => ({ text, n: d.n + 1 })), []);
  const modelConnected = useMemo(() => !!assistantUrl(), []);

  const push = useCallback((m: Omit<ChatMessage, "id">) => {
    const msg = { ...m, id: nextId++ };
    setMessages((xs) => [...xs.slice(-60), msg]);
    return msg;
  }, []);

  const applyEffect = useCallback(
    (e: UiEffect) => {
      if (e.kind === "navigate") router.push(e.href);
      else if (e.kind === "setup") {
        setOpen(false);
        openSetup(e.step);
      } else if (e.kind === "theme") setPref(e.theme);
      else if (e.kind === "month") setMonth(e.month);
      else if (e.kind === "currency") setDisplayCurrency(e.which === "home" ? "PKR" : "USD");
    },
    [router, openSetup, setPref, setMonth, setDisplayCurrency],
  );

  const undo = useCallback(async () => {
    const snap = undoRef.current;
    if (!snap) return push({ role: "assistant", text: "There is nothing to undo.", failed: true });
    undoRef.current = null;
    setCanUndo(false);
    await replaceDatabase(snap.bytes);
    setMessages((xs) => xs.map((m) => ({ ...m, undoable: false })));
    return push({ role: "assistant", text: "", results: [{ ok: true, text: `Undone: ${snap.label}` }], via: "device" });
  }, [replaceDatabase, push]);

  /** Run actions against the workspace in one save, then apply screen effects. */
  const execute = useCallback(
    async (actions: RawAction[], via: "device" | "model", reply = ""): Promise<ChatMessage> => {
      if (actions.some((a) => a.name === "undo")) return (await undo())!;
      let before: Uint8Array | null = null;
      try {
        before = exportDatabase();
      } catch {
        before = null;
      }
      let results: ActionResult[] = [];
      try {
        results = mutate((db) => actions.map((a) => runAction({ db, today, month }, a)));
      } catch (e) {
        results = [{ ok: false, text: e instanceof Error ? e.message : String(e) }];
      }
      const changed = results.some((r) => r.changed);
      if (changed && before) {
        undoRef.current = { bytes: before, label: results.filter((r) => r.changed).map((r) => r.text).join("; ").slice(0, 140) };
        setCanUndo(true);
        setMessages((xs) => xs.map((m) => ({ ...m, undoable: false })));
      }
      for (const r of results) if (r.ok && r.effect) applyEffect(r.effect);
      return push({ role: "assistant", text: reply, results: results.map((r) => ({ ok: r.ok, text: r.text })), undoable: changed && !!before, via, failed: results.every((r) => !r.ok) });
    },
    [exportDatabase, mutate, today, month, applyEffect, push, undo],
  );

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return null;
      push({ role: "user", text });
      const local = parseLocal(text, { subscriptions: data.recurringExpenses.filter((r) => r.status === "active").map((r) => r.name) });
      if (local) {
        const reply = await execute(local, "device");
        historyRef.current = [...historyRef.current, { role: "user" as const, content: text }, { role: "assistant" as const, content: (reply.results ?? []).map((r) => r.text).join(" ") }].slice(-8);
        return reply;
      }
      // Common questions about the person's own numbers are answered on the device.
      const known = answerLocal(text, data, snapshot, month, today);
      if (known) {
        historyRef.current = [...historyRef.current, { role: "user" as const, content: text }, { role: "assistant" as const, content: known }].slice(-8);
        return push({ role: "assistant", text: known, via: "device" });
      }
      if (!assistantUrl()) {
        return push({ role: "assistant", text: `I did not catch that. Try something like "spent 20 on lunch", "got paid 1,200", "paid myself 500", "my tax is 1%", "simple dashboard" or "review my setup".`, failed: true, via: "device" });
      }
      setBusy(true);
      try {
        const answer = await askModel(text, buildContext(data, snapshot, month, today), historyRef.current);
        const needYes = answer.actions.filter((a) => CONFIRM_FIRST.has(a.name));
        const direct = answer.actions.filter((a) => !CONFIRM_FIRST.has(a.name));
        let reply: ChatMessage;
        if (direct.length) reply = await execute(direct, "model", answer.reply);
        else reply = push({ role: "assistant", text: answer.reply || (needYes.length ? "" : "I am not sure what to do with that. Could you say it another way?"), via: "model" });
        if (needYes.length) reply = push({ role: "assistant", text: "Want me to go ahead?", pending: needYes, via: "model" });
        historyRef.current = [...historyRef.current, { role: "user" as const, content: text }, { role: "assistant" as const, content: [answer.reply, ...(reply.results ?? []).map((r) => r.text)].filter(Boolean).join(" ") || "Done." }].slice(-8);
        return reply;
      } catch (e) {
        return push({ role: "assistant", text: modelUnavailable(e instanceof ModelError ? e.reason : "error"), failed: true, via: "model" });
      } finally {
        setBusy(false);
      }
    },
    [busy, data, snapshot, month, today, execute, push],
  );

  const confirm = useCallback(
    (id: number, yes: boolean) => {
      const msg = messages.find((m) => m.id === id);
      if (!msg?.pending) return;
      setMessages((xs) => xs.map((m) => (m.id === id ? { ...m, pending: undefined, text: yes ? "" : "Left as it was." } : m)));
      if (yes) void execute(msg.pending, "model");
    },
    [messages, execute],
  );

  // "/" focuses the assistant from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && t && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const api: AssistantApi = { messages, busy, open, setOpen, ask, undo, confirm, canUndo, modelConnected, prefill, draft };
  return (
    <Ctx.Provider value={api}>
      {children}
      {open && <AssistantPanel />}
    </Ctx.Provider>
  );
}

/** The result of one assistant turn: confirmations, errors, and an Undo. */
export function AssistantReply({ m, compact }: { m: ChatMessage; compact?: boolean }) {
  const { undo, confirm } = useAssistant();
  return (
    <div className={clsx("space-y-1.5", compact ? "text-sm" : "text-sm")} data-assistant-reply>
      {m.text &&
        (m.failed || m.pending ? (
          <p className="whitespace-pre-wrap leading-relaxed text-fg-muted">{m.text}</p>
        ) : (
          <div className="flex items-start gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-fg">
            <Sparkles size={15} className="mt-0.5 shrink-0 text-accent" />
            <p className={clsx("min-w-0 flex-1 whitespace-pre-wrap leading-relaxed", compact && "text-[15px] font-medium")}>{m.text}</p>
          </div>
        ))}
      {m.results?.map((r, i) => (
        <div key={i} className={clsx("flex items-start gap-2 rounded-xl px-3 py-2", r.ok ? "bg-positive-soft text-fg" : "bg-caution-soft text-fg")}>
          {r.ok ? <Check size={15} className="mt-0.5 shrink-0 text-positive" /> : <AlertCircle size={15} className="mt-0.5 shrink-0 text-caution" />}
          <span className="min-w-0 flex-1">{r.text}</span>
        </div>
      ))}
      {m.pending && (
        <div className="rounded-xl border border-border bg-surface p-3">
          <ul className="mb-2 list-disc pl-4 text-xs text-fg-muted">
            {m.pending.map((a, i) => (
              <li key={i}>
                {a.name.replace(/_/g, " ")} {Object.values(a.args ?? {}).filter((v) => typeof v !== "object").join(" · ")}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" onClick={() => confirm(m.id, true)} className="h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-fg">
              Yes, do it
            </button>
            <button type="button" onClick={() => confirm(m.id, false)} className="h-9 rounded-lg border border-border px-3 text-sm font-medium text-fg-muted hover:bg-surface-2">
              No
            </button>
          </div>
        </div>
      )}
      {m.undoable && (
        <button type="button" onClick={() => void undo()} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
          <RotateCcw size={12} /> Undo
        </button>
      )}
    </div>
  );
}

type Recognition = { start: () => void; stop: () => void; onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; lang: string; interimResults: boolean };

/** Text box with send and (where the browser supports it) a microphone. */
export function Composer({ autoFocus, placeholder, onSent, large }: { autoFocus?: boolean; placeholder?: string; onSent?: (reply: ChatMessage | null) => void; large?: boolean }) {
  const { ask, busy, draft } = useAssistant();
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    setCanListen(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    if (draft.n === 0) return;
    setText(draft.text);
    inputRef.current?.focus();
  }, [draft]);

  const send = async (value = text) => {
    const v = value.trim();
    if (!v || busy) return;
    setText("");
    const reply = await ask(v);
    onSent?.(reply);
    inputRef.current?.focus();
  };

  const listen = () => {
    if (listening) return recRef.current?.stop();
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Impl = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Impl) return;
    const rec = new Impl();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript ?? "";
      if (said) void send(said);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className={clsx("flex items-center gap-2 rounded-2xl border-2 bg-surface pl-4 pr-2 transition-colors focus-within:border-accent", large ? "h-14 border-border shadow-card" : "h-12 border-border")}
    >
      <Sparkles size={18} className="shrink-0 text-accent" />
      <input ref={inputRef} autoFocus={autoFocus} value={text} onChange={(e) => setText(e.target.value)} placeholder={listening ? "Listening…" : (placeholder ?? "Tell me what happened, or ask anything")} aria-label="Ask CFoh!" className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-fg placeholder:text-fg-faint focus:outline-none" enterKeyHint="send" autoComplete="off" />
      {canListen && (
        <button type="button" onClick={listen} aria-label={listening ? "Stop listening" : "Speak"} className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", listening ? "animate-pulse bg-critical-soft text-critical" : "text-fg-muted hover:bg-surface-2 hover:text-fg")}>
          <Mic size={17} />
        </button>
      )}
      <button type="submit" disabled={!text.trim() || busy} aria-label="Send" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg disabled:opacity-40">
        {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ArrowUp size={17} />}
      </button>
    </form>
  );
}

function AssistantPanel() {
  const { messages, busy, setOpen, ask, modelConnected, prefill } = useAssistant();
  const { data } = useFinance();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setOpen]);
  const first = (data?.settings.ownerName || "").split(/\s+/)[0];
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Ask CFoh!" data-assistant-panel>
      <div className="hidden flex-1 bg-black/30 sm:block" onClick={() => setOpen(false)} />
      <div className="flex h-full w-full flex-col border-l border-border bg-bg shadow-2xl sm:w-[420px]">
        <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Sparkles size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-fg">Ask CFoh!</div>
            <div className="truncate text-[11px] text-fg-faint">Record money, change anything, or ask about your numbers</div>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-2" aria-label="Close CFoh!">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="pt-2">
              <p className="text-base font-semibold text-fg">{first ? `Hi ${first}.` : "Hi."} What happened, or what do you need?</p>
              <p className="mt-1 text-sm text-fg-muted">Say it the way you would tell a friend. I will update your numbers, settings or dashboard, and you can undo anything.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {EXAMPLES.map((e) => (
                  <button key={e.text} type="button" onClick={() => (e.fill ? prefill(e.text) : void ask(e.text))} className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-accent hover:text-accent">
                    {e.text.trim()}
                    {e.fill && e.text.endsWith(" ") ? "…" : ""}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-accent-fg">{m.text}</div>
              </div>
            ) : (
              <div key={m.id} className="max-w-[92%]">
                <AssistantReply m={m} />
              </div>
            ),
          )}
          {busy && (
            <div className="flex items-center gap-1.5 px-1 text-fg-faint" aria-label="Thinking">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-fg-faint" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="border-t border-border bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <Composer autoFocus />
          <p className="mt-2 px-1 text-[10px] leading-snug text-fg-faint">
            Everyday commands run on your device. {modelConnected ? "Other messages go to an AI model on Cloudflare with a summary of this month's numbers; nothing is stored there." : "The AI model is not connected, so only typed commands work."} Not financial or tax advice.
          </p>
        </div>
      </div>
    </div>
  );
}

/** The ask bar on Home: type or speak; the result appears right under it. */
export function AskBar() {
  const { messages, busy, setOpen, ask, prefill } = useAssistant();
  const tail = messages[messages.length - 1];
  const last = tail && tail.role === "assistant" ? tail : null;
  return (
    <div data-askbar>
      <Composer large placeholder={'Tell me what happened: "spent 20 on lunch", "got paid 1,200"… or ask anything'} />
      {busy && <div className="mt-2 px-2 text-xs text-fg-faint">Thinking…</div>}
      {!busy && last && (
        <div className="mt-2 pop-in" key={last.id}>
          <AssistantReply m={last} compact />
        </div>
      )}
      {!busy && !last && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {EXAMPLES.slice(0, 5).map((e) => (
            <button key={e.text} type="button" onClick={() => (e.fill ? prefill(e.text) : void ask(e.text))} className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-fg-muted hover:border-accent hover:text-accent">
              {e.text.trim()}
              {e.fill && e.text.endsWith(" ") ? "…" : ""}
            </button>
          ))}
          <button type="button" onClick={() => setOpen(true)} className="rounded-full px-2.5 py-1 text-[11px] font-medium text-accent hover:underline">
            More
          </button>
        </div>
      )}
    </div>
  );
}
