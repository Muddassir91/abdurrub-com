"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Database } from "sql.js";
import { openDatabase, exportImage, type Db } from "@/db/client";
import { loadImage, saveImage, loadMeta, loadRegistry, saveRegistry, clearWorkspaceStorage, WrongPassphraseError, type StoredMeta, type WorkspaceInfo, type WorkspaceRegistry, type SeedTemplate } from "@/db/persistence";
import { seedDatabase, type SeedOptions } from "@/db/seed";
import { loadEngineData } from "@/db/repo";
import type { EngineData, MonthSnapshot, Alert } from "@/engine/types";
import { buildSnapshot } from "@/engine/snapshot";
import { buildAlerts } from "@/engine/alerts";
import { currentMonthKey, todayKey } from "@/lib/dates";
import { uid } from "@/lib/ids";

/**
 * status
 *  loading  opening storage / a workspace
 *  setup    no workspace exists yet: show the sign-up screen
 *  locked   the current workspace is encrypted and needs its passphrase
 *  ready    data loaded
 *  error    unrecoverable
 */
export type Status = "loading" | "setup" | "locked" | "ready" | "error";

export interface CreateWorkspaceInput {
  name: string;
  businessName: string;
  ownerName: string;
  template: SeedTemplate;
  passphrase?: string;
  baseCurrency?: string;
  householdCurrency?: string;
}

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
  // Workspaces (one per business or person; each is its own database)
  workspaces: WorkspaceInfo[];
  currentWorkspace: WorkspaceInfo | null;
  createWorkspace: (input: CreateWorkspaceInput) => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
  renameWorkspace: (id: string, name: string, businessName?: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
}

const Ctx = createContext<FinanceContextValue | null>(null);

const passKey = (id: string) => `finance-os:session-pass:${id}`;

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EngineData | null>(null);
  const [month, setMonth] = useState<string>(currentMonthKey());
  const [meta, setMeta] = useState<StoredMeta | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [displayCurrency, setDisplayCurrencyState] = useState<"USD" | "PKR">("USD");
  const [registry, setRegistry] = useState<WorkspaceRegistry>({ list: [], currentId: null });
  const sqlRef = useRef<Database | null>(null);
  const dbRef = useRef<Db | null>(null);
  const passRef = useRef<string | null>(null);
  const wsRef = useRef<string | null>(null);
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
    if (!sqlRef.current || !wsRef.current) return;
    setSaving(true);
    try {
      const bytes = exportImage(sqlRef.current);
      const m = await saveImage(wsRef.current, bytes, passRef.current ?? undefined);
      setMeta(m);
      setLastSavedAt(m.savedAt);
    } catch (e) {
      console.error("Failed to persist database", e);
      setError("Could not save to browser storage. Export a backup now.");
    } finally {
      setSaving(false);
    }
  }, []);

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

  const closeCurrent = useCallback(() => {
    try {
      sqlRef.current?.close();
    } catch {
      /* already closed */
    }
    sqlRef.current = null;
    dbRef.current = null;
    setData(null);
  }, []);

  /** Open a workspace's database (creating + seeding when it has no image yet). */
  const boot = useCallback(
    async (workspaceId: string, image: Uint8Array | undefined, seed?: SeedOptions) => {
      closeCurrent();
      wsRef.current = workspaceId;
      const opened = await openDatabase(image);
      sqlRef.current = opened.sql;
      dbRef.current = opened.db;
      const seeded = seedDatabase(opened.db, seed);
      setData(loadEngineData(opened.db));
      setMonth(currentMonthKey());
      setStatus("ready");
      if (seeded || opened.isNew) await persistNow();
      else {
        const m = await loadMeta(workspaceId);
        setMeta(m ?? null);
        if (m?.savedAt) setLastSavedAt(m.savedAt);
      }
    },
    [closeCurrent, persistNow],
  );

  /** Load a workspace, handling the locked state. */
  const open = useCallback(
    async (ws: WorkspaceInfo, seed?: SeedOptions) => {
      setStatus("loading");
      const m = await loadMeta(ws.id);
      setMeta(m ?? null);
      if (m?.encrypted) {
        const sessionPass = sessionStorage.getItem(passKey(ws.id));
        if (sessionPass) {
          try {
            const image = await loadImage(ws.id, sessionPass);
            passRef.current = sessionPass;
            await boot(ws.id, image);
            return;
          } catch {
            sessionStorage.removeItem(passKey(ws.id));
          }
        }
        closeCurrent();
        wsRef.current = ws.id;
        passRef.current = null;
        setStatus("locked");
        return;
      }
      passRef.current = null;
      const image = await loadImage(ws.id);
      await boot(ws.id, image, seed ?? { template: ws.template, businessName: ws.businessName, ownerName: ws.ownerName });
    },
    [boot, closeCurrent],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reg = await loadRegistry();
        if (cancelled) return;
        setRegistry(reg);
        const current = reg.list.find((w) => w.id === reg.currentId) ?? reg.list[0];
        if (!current) {
          setStatus("setup");
          return;
        }
        await open(current);
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Save first, then update state: the UI must never show a workspace the
  // registry on disk does not yet know about (a reload would lose it).
  const updateRegistry = useCallback(async (next: WorkspaceRegistry) => {
    await saveRegistry(next);
    setRegistry(next);
  }, []);

  const createWorkspace = useCallback(
    async (input: CreateWorkspaceInput) => {
      const ws: WorkspaceInfo = { id: uid(), name: input.name.trim(), businessName: input.businessName.trim(), ownerName: input.ownerName.trim(), template: input.template, createdAt: new Date().toISOString() };
      const next: WorkspaceRegistry = { list: [...registry.list, ws], currentId: ws.id };
      await updateRegistry(next);
      passRef.current = input.passphrase || null;
      if (input.passphrase) sessionStorage.setItem(passKey(ws.id), input.passphrase);
      setStatus("loading");
      await boot(ws.id, undefined, { template: ws.template, businessName: ws.businessName, ownerName: ws.ownerName, baseCurrency: input.baseCurrency, householdCurrency: input.householdCurrency });
    },
    [registry, updateRegistry, boot],
  );

  const switchWorkspace = useCallback(
    async (id: string) => {
      const ws = registry.list.find((w) => w.id === id);
      if (!ws || id === wsRef.current) return;
      await persistNow();
      await updateRegistry({ ...registry, currentId: id });
      await open(ws);
    },
    [registry, updateRegistry, open, persistNow],
  );

  const renameWorkspace = useCallback(
    async (id: string, name: string, businessName?: string) => {
      await updateRegistry({ ...registry, list: registry.list.map((w) => (w.id === id ? { ...w, name: name.trim() || w.name, businessName: businessName?.trim() || w.businessName } : w)) });
    },
    [registry, updateRegistry],
  );

  const deleteWorkspace = useCallback(
    async (id: string) => {
      const remaining = registry.list.filter((w) => w.id !== id);
      await clearWorkspaceStorage(id);
      sessionStorage.removeItem(passKey(id));
      if (id === wsRef.current) {
        closeCurrent();
        wsRef.current = null;
        passRef.current = null;
      }
      const next: WorkspaceRegistry = { list: remaining, currentId: id === registry.currentId ? (remaining[0]?.id ?? null) : registry.currentId };
      await updateRegistry(next);
      if (id === registry.currentId) {
        const target = remaining.find((w) => w.id === next.currentId);
        if (target) await open(target);
        else setStatus("setup");
      }
    },
    [registry, updateRegistry, closeCurrent, open],
  );

  const unlock = useCallback(
    async (passphrase: string) => {
      const id = wsRef.current;
      if (!id) return false;
      try {
        const image = await loadImage(id, passphrase);
        passRef.current = passphrase;
        sessionStorage.setItem(passKey(id), passphrase);
        await boot(id, image);
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
      const id = wsRef.current;
      if (!id) return;
      passRef.current = passphrase;
      if (passphrase) sessionStorage.setItem(passKey(id), passphrase);
      else sessionStorage.removeItem(passKey(id));
      await persistNow();
    },
    [persistNow],
  );

  const lock = useCallback(() => {
    const id = wsRef.current;
    if (!passRef.current || !id) return;
    sessionStorage.removeItem(passKey(id));
    passRef.current = null;
    closeCurrent();
    setStatus("locked");
  }, [closeCurrent]);

  const mutate = useCallback(
    <T,>(fn: (db: Db, data: EngineData) => T): T => {
      const db = dbRef.current;
      if (!db || !data) throw new Error("Database is not ready");
      const result = fn(db, data);
      setData(loadEngineData(db));
      void persistNow();
      return result;
    },
    [data, persistNow],
  );

  const exportDatabase = useCallback(() => {
    if (!sqlRef.current) throw new Error("Database is not ready");
    return exportImage(sqlRef.current);
  }, []);

  const importDatabase = useCallback(
    async (bytes: Uint8Array) => {
      const id = wsRef.current;
      if (!id) throw new Error("No workspace open");
      const test = await openDatabase(bytes);
      loadEngineData(test.db);
      test.sql.close();
      setStatus("loading");
      await boot(id, bytes);
      await persistNow();
    },
    [boot, persistNow],
  );

  const resetDatabase = useCallback(async () => {
    const id = wsRef.current;
    if (!id) return;
    const ws = registry.list.find((w) => w.id === id);
    closeCurrent();
    passRef.current = null;
    sessionStorage.removeItem(passKey(id));
    await clearWorkspaceStorage(id);
    setStatus("loading");
    await boot(id, undefined, ws ? { template: ws.template, businessName: ws.businessName, ownerName: ws.ownerName } : undefined);
  }, [boot, closeCurrent, registry.list]);

  const snapshotFor = useCallback(
    (m: string) => {
      if (!data) throw new Error("Data not loaded");
      return buildSnapshot(data, m, today);
    },
    [data, today],
  );

  const snapshot = useMemo(() => (data ? buildSnapshot(data, month, today) : null), [data, month, today]);
  const alerts = useMemo(() => (data && snapshot ? buildAlerts(data, snapshot, today) : []), [data, snapshot, today]);
  const currentWorkspace = registry.list.find((w) => w.id === registry.currentId) ?? null;

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
    workspaces: registry.list,
    currentWorkspace,
    createWorkspace,
    switchWorkspace,
    renameWorkspace,
    deleteWorkspace,
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
