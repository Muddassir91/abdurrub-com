"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Database } from "sql.js";
import { openDatabase, exportImage, type Db } from "@/db/client";
import { loadImage, saveImage, loadMeta, clearStorage, WrongPassphraseError, type StoredMeta } from "@/db/persistence";
import { seedDatabase } from "@/db/seed";
import { loadEngineData } from "@/db/repo";
import type { EngineData, MonthSnapshot, Alert } from "@/engine/types";
import { buildSnapshot } from "@/engine/snapshot";
import { buildAlerts } from "@/engine/alerts";
import { currentMonthKey, todayKey } from "@/lib/dates";

export type Status = "loading" | "locked" | "ready" | "error";

export interface FinanceContextValue {
  status: Status;
  error: string | null;
  data: EngineData | null;
  month: string;
  setMonth: (m: string) => void;
  today: string;
  snapshot: MonthSnapshot | null;
  alerts: Alert[];
  snapshotFor: (month: string) => MonthSnapshot;
  /** Run a mutation against the database; data is reloaded and persisted afterwards. */
  mutate: <T>(fn: (db: Db, data: EngineData) => T) => T;
  unlock: (passphrase: string) => Promise<boolean>;
  setPassphrase: (passphrase: string | null) => Promise<void>;
  lock: () => void;
  isEncrypted: boolean;
  exportDatabase: () => Uint8Array;
  importDatabase: (bytes: Uint8Array) => Promise<void>;
  resetDatabase: () => Promise<void>;
  lastSavedAt: string | null;
  saving: boolean;
  displayCurrency: "USD" | "PKR";
  setDisplayCurrency: (c: "USD" | "PKR") => void;
}

const Ctx = createContext<FinanceContextValue | null>(null);

const PASS_SESSION_KEY = "finance-os:session-pass";

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EngineData | null>(null);
  const [month, setMonth] = useState<string>(currentMonthKey());
  const [meta, setMeta] = useState<StoredMeta | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [displayCurrency, setDisplayCurrencyState] = useState<"USD" | "PKR">("USD");
  const sqlRef = useRef<Database | null>(null);
  const dbRef = useRef<Db | null>(null);
  const passRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = todayKey();

  const setDisplayCurrency = useCallback((c: "USD" | "PKR") => {
    setDisplayCurrencyState(c);
    try {
      localStorage.setItem("finance-os:display-currency", c);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const c = localStorage.getItem("finance-os:display-currency");
      if (c === "PKR" || c === "USD") setDisplayCurrencyState(c);
    } catch {
      /* ignore */
    }
  }, []);

  const persistNow = useCallback(async () => {
    if (!sqlRef.current) return;
    setSaving(true);
    try {
      const bytes = exportImage(sqlRef.current);
      const m = await saveImage(bytes, passRef.current ?? undefined);
      setMeta(m);
      setLastSavedAt(m.savedAt);
    } catch (e) {
      console.error("Failed to persist database", e);
      setError("Could not save to browser storage. Export a backup now.");
    } finally {
      setSaving(false);
    }
  }, []);

  // Persist immediately after every mutation (the database is small, exporting
  // it costs a few milliseconds) and once more on tab hide as a safety net.
  const schedulePersist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void persistNow();
  }, [persistNow]);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void persistNow();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [persistNow]);

  const boot = useCallback(
    async (image: Uint8Array | undefined) => {
      const opened = await openDatabase(image);
      sqlRef.current = opened.sql;
      dbRef.current = opened.db;
      const seeded = seedDatabase(opened.db);
      setData(loadEngineData(opened.db));
      setStatus("ready");
      if (seeded || opened.isNew) await persistNow();
      else {
        const m = await loadMeta();
        if (m?.savedAt) setLastSavedAt(m.savedAt);
      }
    },
    [persistNow],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await loadMeta();
        if (cancelled) return;
        setMeta(m ?? null);
        if (m?.encrypted) {
          const sessionPass = sessionStorage.getItem(PASS_SESSION_KEY);
          if (sessionPass) {
            try {
              const image = await loadImage(sessionPass);
              passRef.current = sessionPass;
              await boot(image);
              return;
            } catch {
              sessionStorage.removeItem(PASS_SESSION_KEY);
            }
          }
          setStatus("locked");
          return;
        }
        const image = await loadImage();
        if (cancelled) return;
        await boot(image);
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boot]);

  const unlock = useCallback(
    async (passphrase: string) => {
      try {
        const image = await loadImage(passphrase);
        passRef.current = passphrase;
        sessionStorage.setItem(PASS_SESSION_KEY, passphrase);
        await boot(image);
        return true;
      } catch (e) {
        if (e instanceof WrongPassphraseError) return false;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
        return false;
      }
    },
    [boot],
  );

  const setPassphrase = useCallback(
    async (passphrase: string | null) => {
      passRef.current = passphrase;
      if (passphrase) sessionStorage.setItem(PASS_SESSION_KEY, passphrase);
      else sessionStorage.removeItem(PASS_SESSION_KEY);
      await persistNow();
    },
    [persistNow],
  );

  const lock = useCallback(() => {
    if (!passRef.current) return;
    sessionStorage.removeItem(PASS_SESSION_KEY);
    passRef.current = null;
    sqlRef.current?.close();
    sqlRef.current = null;
    dbRef.current = null;
    setData(null);
    setStatus("locked");
  }, []);

  const mutate = useCallback(
    <T,>(fn: (db: Db, data: EngineData) => T): T => {
      const db = dbRef.current;
      if (!db || !data) throw new Error("Database is not ready");
      const result = fn(db, data);
      setData(loadEngineData(db));
      schedulePersist();
      return result;
    },
    [data, schedulePersist],
  );

  const exportDatabase = useCallback(() => {
    if (!sqlRef.current) throw new Error("Database is not ready");
    return exportImage(sqlRef.current);
  }, []);

  const importDatabase = useCallback(
    async (bytes: Uint8Array) => {
      // Validate before replacing anything.
      const test = await openDatabase(bytes);
      loadEngineData(test.db);
      test.sql.close();
      sqlRef.current?.close();
      setStatus("loading");
      await boot(bytes);
      await persistNow();
    },
    [boot, persistNow],
  );

  const resetDatabase = useCallback(async () => {
    sqlRef.current?.close();
    sqlRef.current = null;
    dbRef.current = null;
    passRef.current = null;
    sessionStorage.removeItem(PASS_SESSION_KEY);
    await clearStorage();
    setStatus("loading");
    await boot(undefined);
  }, [boot]);

  const snapshotFor = useCallback(
    (m: string) => {
      if (!data) throw new Error("Data not loaded");
      return buildSnapshot(data, m, today);
    },
    [data, today],
  );

  const snapshot = useMemo(() => (data ? buildSnapshot(data, month, today) : null), [data, month, today]);
  const alerts = useMemo(() => (data && snapshot ? buildAlerts(data, snapshot, today) : []), [data, snapshot, today]);

  const value: FinanceContextValue = {
    status,
    error,
    data,
    month,
    setMonth,
    today,
    snapshot,
    alerts,
    snapshotFor,
    mutate,
    unlock,
    setPassphrase,
    lock,
    isEncrypted: !!meta?.encrypted,
    exportDatabase,
    importDatabase,
    resetDatabase,
    lastSavedAt,
    saving,
    displayCurrency,
    setDisplayCurrency,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFinance(): FinanceContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFinance must be used inside FinanceProvider");
  return v;
}

/** Convenience hook for pages: throws if data is not ready (pages are only rendered when ready). */
export function useReady() {
  const f = useFinance();
  if (!f.data || !f.snapshot) throw new Error("Finance data not ready");
  return { ...f, data: f.data, snapshot: f.snapshot };
}
