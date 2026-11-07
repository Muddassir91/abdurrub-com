"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { clsx } from "clsx";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

const Ctx = createContext<{ push: (t: Omit<ToastItem, "id">) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === "error" ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={clsx("pointer-events-auto flex items-start gap-2 rounded-lg border bg-surface px-3 py-2.5 text-sm shadow-lg", t.tone === "success" && "border-positive/40", t.tone === "error" && "border-critical/40", t.tone === "info" && "border-border")}>
            {t.tone === "success" ? <CheckCircle2 size={16} className="mt-0.5 text-positive" /> : t.tone === "error" ? <AlertTriangle size={16} className="mt-0.5 text-critical" /> : <Info size={16} className="mt-0.5 text-info" />}
            <div className="flex-1">
              <div className="font-medium text-fg">{t.title}</div>
              {t.body && <div className="mt-0.5 text-xs text-fg-muted">{t.body}</div>}
            </div>
            <button onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} className="text-fg-faint hover:text-fg">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return {
    success: (title: string, body?: string) => c.push({ tone: "success", title, body }),
    error: (title: string, body?: string) => c.push({ tone: "error", title, body }),
    info: (title: string, body?: string) => c.push({ tone: "info", title, body }),
  };
}

/** Wrap a mutation so errors surface as toasts instead of crashing the page. */
export function useSafeAction() {
  const toast = useToast();
  return useCallback(
    <T,>(fn: () => T, successMessage?: string): T | undefined => {
      try {
        const r = fn();
        if (successMessage) toast.success(successMessage);
        return r;
      } catch (e) {
        toast.error("Action failed", e instanceof Error ? e.message : String(e));
        return undefined;
      }
    },
    [toast],
  );
}
