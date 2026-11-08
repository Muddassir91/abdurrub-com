"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Database } from "sql.js";
import { openDatabase, exportImage, type Db } from "@/db/client";
import { loadImage, saveImage, loadMeta, loadRegistry, saveRegistry, clearWorkspaceStorage, loadRawImage, storeRaw, updateMeta, decryptImage, WrongPassphraseError, type StoredMeta, type WorkspaceInfo, type WorkspaceRegistry, type SeedTemplate } from "@/db/persistence";
import { seedDatabase, type SeedOptions } from "@/db/seed";
import { loadEngineData } from "@/db/repo";
import type { EngineData, MonthSnapshot, Alert } from "@/engine/types";
import { buildSnapshot } from "@/engine/snapshot";
import { buildAlerts } from "@/engine/alerts";
import { currentMonthKey, todayKey } from "@/lib/dates";
import { uid } from "@/lib/ids";
import { getCloud } from "@/cloud";
import { decideSync } from "@/cloud/sync";
import type { CloudBackend, CloudUser, RemoteWorkspace } from "@/cloud/types";

/**
 * status
 *  loading  opening storage / a workspace
 *  auth     cloud accounts are available and nobody is signed in: show sign-in
 *  setup    no workspace exists yet: show the create-workspace screen
 *  locked   the current workspace is encrypted and needs its passphrase
 *  ready    data loaded
 *  error    unrecoverable
 */
export type Status = "loading" | "auth" | "setup" | "locked" | "ready" | "error";
export type CloudStatus = "off" | "signed_out" | "idle" | "syncing" | "error";

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
  // Workspaces
  workspaces: WorkspaceInfo[];
  currentWorkspace: WorkspaceInfo | null;
  createWorkspace: (input: CreateWorkspaceInput) => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
  renameWorkspace: (id: string, name: string, businessName?: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  // Cloud accounts
  cloudAvailable: boolean;
  cloudUser: CloudUser | null;
  cloudStatus: CloudStatus;
  cloudError: string | null;
  lastSyncedAt: string | null;
  signUp: (email: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  sendMagicLink: (email: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: (removeLocalData: boolean) => Promise<void>;
  continueWithoutAccount: () => void;
  syncNow: () => Promise<void>;
}

const Ctx = createContext<FinanceContextValue | null>(null);

const passKey = (id: string) => `finance-os:session-pass:${id}`;
const DEVICE_ONLY_KEY = "finance-os:device-only";

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
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>("off");
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const sqlRef = useRef<Database | null>(null);
  const dbRef = useRef<Db | null>(null);
  const passRef = useRef<string | null>(null);
  const wsRef = useRef<string | null>(null);
  const cloudRef = useRef<CloudBackend | null>(null);
  const userRef = useRef<CloudUser | null>(null);
  const registryRef = useRef<WorkspaceRegistry>({ list: [], currentId: null });
  const uploadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = todayKey();

  useEffect(() => {
    registryRef.current = registry;
  }, [registry]);
  useEffect(() => {
    userRef.current = cloudUser;
  }, [cloudUser]);

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

  // ------------------------------------------------------------------ registry helpers

  const updateRegistry = useCallback(async (next: WorkspaceRegistry) => {
    await saveRegistry(next);
    registryRef.current = next;
    setRegistry(next);
  }, []);

  const patchWorkspace = useCallback(
    async (id: string, patch: Partial<WorkspaceInfo>) => {
      const reg = registryRef.current;
      await updateRegistry({ ...reg, list: reg.list.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
    },
    [updateRegistry],
  );

  // ------------------------------------------------------------------ cloud upload

  /** Upload the stored (possibly encrypted) image of a workspace to the signed-in account. */
  const uploadWorkspace = useCallback(
    async (id: string) => {
      const cloud = cloudRef.current;
      const user = userRef.current;
      if (!cloud || !user) return;
      const ws = registryRef.current.list.find((w) => w.id === id);
      const raw = await loadRawImage(id);
      if (!ws || !raw) return;
      setCloudStatus("syncing");
      try {
        await cloud.upsertWorkspace({ id: ws.id, name: ws.name, businessName: ws.businessName, ownerName: ws.ownerName, template: ws.template, version: raw.meta.version, savedAt: raw.meta.savedAt, encrypted: raw.meta.encrypted, salt: raw.meta.salt ?? null, iv: raw.meta.iv ?? null, createdAt: ws.createdAt });
        await cloud.uploadImage(ws.id, raw.payload, { version: raw.meta.version, savedAt: raw.meta.savedAt, encrypted: raw.meta.encrypted, salt: raw.meta.salt, iv: raw.meta.iv });
        await updateMeta(id, { lastSyncedVersion: raw.meta.version });
        if (!ws.cloud || ws.userId !== user.id) await patchWorkspace(id, { cloud: true, userId: user.id });
        setLastSyncedAt(new Date().toISOString());
        setCloudStatus("idle");
        setCloudError(null);
      } catch (e) {
        console.error("Cloud upload failed", e);
        setCloudStatus("error");
        setCloudError(e instanceof Error ? e.message : String(e));
      }
    },
    [patchWorkspace],
  );

  const scheduleUpload = useCallback(
    (id: string) => {
      if (!cloudRef.current || !userRef.current) return;
      if (uploadTimer.current) clearTimeout(uploadTimer.current);
      uploadTimer.current = setTimeout(() => void uploadWorkspace(id), 1200);
    },
    [uploadWorkspace],
  );

  // ------------------------------------------------------------------ local persistence

  const persistNow = useCallback(async () => {
    if (!sqlRef.current || !wsRef.current) return;
    const id = wsRef.current;
    setSaving(true);
    try {
      const bytes = exportImage(sqlRef.current);
      const m = await saveImage(id, bytes, passRef.current ?? undefined);
      setMeta(m);
      setLastSavedAt(m.savedAt);
      scheduleUpload(id);
    } catch (e) {
      console.error("Failed to persist database", e);
      setError("Could not save to browser storage. Export a backup now.");
    } finally {
      setSaving(false);
    }
  }, [scheduleUpload]);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") {
        void persistNow();
        if (uploadTimer.current && wsRef.current) {
          clearTimeout(uploadTimer.current);
          void uploadWorkspace(wsRef.current);
        }
      }
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [persistNow, uploadWorkspace]);

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

  // ------------------------------------------------------------------ cloud download / reconcile

  /** Bring the local copy of a cloud workspace up to date before opening it. */
  const pullWorkspace = useCallback(
    async (ws: WorkspaceInfo, remote: RemoteWorkspace | undefined) => {
      const cloud = cloudRef.current;
      if (!cloud || !userRef.current || !remote) return;
      const local = await loadMeta(ws.id);
      const decision = decideSync(local ? { version: local.version, savedAt: local.savedAt, lastSyncedVersion: local.lastSyncedVersion ?? 0 } : null, { version: remote.version, savedAt: remote.savedAt });
      if (decision.action === "none") return;
      if (decision.action === "upload" || (decision.action === "conflict" && decision.prefer === "local")) {
        await uploadWorkspace(ws.id);
        return;
      }
      // download, or conflict preferring remote
      setCloudStatus("syncing");
      try {
        if (decision.action === "conflict") {
          // Keep this device's version as a separate local workspace so nothing is lost.
          const raw = await loadRawImage(ws.id);
          if (raw) {
            const copyId = uid();
            await storeRaw(copyId, raw.payload, { ...raw.meta, lastSyncedVersion: 0 });
            const reg = registryRef.current;
            await updateRegistry({ ...reg, list: [...reg.list, { ...ws, id: copyId, name: `${ws.name} (copy from this device)`, cloud: false, userId: null, createdAt: new Date().toISOString() }] });
          }
        }
        const payload = await cloud.downloadImage(ws.id);
        if (payload) {
          await storeRaw(ws.id, payload, { encrypted: remote.encrypted, salt: remote.salt ?? undefined, iv: remote.iv ?? undefined, savedAt: remote.savedAt ?? new Date().toISOString(), version: remote.version, lastSyncedVersion: remote.version });
        }
        setLastSyncedAt(new Date().toISOString());
        setCloudStatus("idle");
        setCloudError(null);
      } catch (e) {
        console.error("Cloud download failed", e);
        setCloudStatus("error");
        setCloudError(e instanceof Error ? e.message : String(e));
      }
    },
    [uploadWorkspace, updateRegistry],
  );

  /** Merge the account's remote workspace list into the local registry, uploading local-only ones. */
  const reconcileWithCloud = useCallback(async (): Promise<RemoteWorkspace[]> => {
    const cloud = cloudRef.current;
    const user = userRef.current;
    if (!cloud || !user) return [];
    setCloudStatus("syncing");
    try {
      const remote = await cloud.listWorkspaces();
      const reg = registryRef.current;
      const list = [...reg.list];
      for (const r of remote) {
        const i = list.findIndex((w) => w.id === r.id);
        const info: WorkspaceInfo = { id: r.id, name: r.name, businessName: r.businessName, ownerName: r.ownerName, template: r.template, createdAt: r.createdAt, cloud: true, userId: user.id };
        if (i === -1) list.push(info);
        else list[i] = { ...list[i], ...info };
      }
      await updateRegistry({ ...reg, list });
      // Local-only workspaces (never uploaded, or created while signed out) join the account.
      for (const w of list) {
        if (!remote.some((r) => r.id === w.id) && (!w.userId || w.userId === user.id)) {
          const raw = await loadRawImage(w.id);
          if (raw) await uploadWorkspace(w.id);
        }
      }
      setCloudStatus("idle");
      setCloudError(null);
      return remote;
    } catch (e) {
      console.error("Cloud sync failed", e);
      setCloudStatus("error");
      setCloudError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }, [updateRegistry, uploadWorkspace]);

  /** Load a workspace, handling the locked state. */
  const open = useCallback(
    async (ws: WorkspaceInfo, remote?: RemoteWorkspace, seed?: SeedOptions) => {
      setStatus("loading");
      if (ws.cloud && userRef.current) await pullWorkspace(ws, remote);
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
    [boot, closeCurrent, pullWorkspace],
  );

  /** Workspaces visible to the current session: the account's, plus local-only ones. */
  const visibleWorkspaces = useCallback((reg: WorkspaceRegistry, user: CloudUser | null) => reg.list.filter((w) => !w.userId || !user || w.userId === user.id), []);

  /** Entry point after auth state is known: open the current workspace or show setup. */
  const enter = useCallback(async () => {
    let remote: RemoteWorkspace[] = [];
    if (cloudRef.current && userRef.current) remote = await reconcileWithCloud();
    const reg = registryRef.current;
    const visible = visibleWorkspaces(reg, userRef.current);
    const current = visible.find((w) => w.id === reg.currentId) ?? visible[0];
    if (!current) {
      closeCurrent();
      setStatus("setup");
      return;
    }
    if (reg.currentId !== current.id) await updateRegistry({ ...reg, currentId: current.id });
    await open(
      current,
      remote.find((r) => r.id === current.id),
    );
  }, [reconcileWithCloud, visibleWorkspaces, closeCurrent, updateRegistry, open]);

  // ------------------------------------------------------------------ startup

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const reg = await loadRegistry();
        if (cancelled) return;
        registryRef.current = reg;
        setRegistry(reg);
        const cloud = getCloud();
        cloudRef.current = cloud;
        if (cloud) {
          const user = await cloud.getUser();
          userRef.current = user;
          setCloudUser(user);
          setCloudStatus(user ? "idle" : "signed_out");
          unsub = cloud.onAuthChange((u) => {
            const changed = (u?.id ?? null) !== (userRef.current?.id ?? null);
            userRef.current = u;
            setCloudUser(u);
            setCloudStatus(u ? "idle" : "signed_out");
            if (changed && u) void enter();
          });
          const deviceOnly = localStorage.getItem(DEVICE_ONLY_KEY) === "1";
          if (!user && !deviceOnly) {
            setStatus("auth");
            return;
          }
        }
        await enter();
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [enter]);

  // ------------------------------------------------------------------ auth actions

  const signUp = useCallback(async (email: string, password: string) => {
    const cloud = cloudRef.current;
    if (!cloud) throw new Error("Accounts are not available in this build");
    const r = await cloud.signUp(email, password);
    if (!r.needsEmailConfirmation) {
      userRef.current = await cloud.getUser();
      setCloudUser(userRef.current);
      await enter();
    }
    return r;
  }, [enter]);

  const signIn = useCallback(async (email: string, password: string) => {
    const cloud = cloudRef.current;
    if (!cloud) throw new Error("Accounts are not available in this build");
    await cloud.signInWithPassword(email, password);
    userRef.current = await cloud.getUser();
    setCloudUser(userRef.current);
    localStorage.removeItem(DEVICE_ONLY_KEY);
    await enter();
  }, [enter]);

  const redirectTo = () => `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
  const sendMagicLink = useCallback(async (email: string) => {
    const cloud = cloudRef.current;
    if (!cloud) throw new Error("Accounts are not available in this build");
    await cloud.sendMagicLink(email, redirectTo());
  }, []);
  const sendPasswordReset = useCallback(async (email: string) => {
    const cloud = cloudRef.current;
    if (!cloud) throw new Error("Accounts are not available in this build");
    await cloud.sendPasswordReset(email, redirectTo());
  }, []);

  const signOut = useCallback(
    async (removeLocalData: boolean) => {
      const cloud = cloudRef.current;
      if (uploadTimer.current && wsRef.current) {
        clearTimeout(uploadTimer.current);
        await uploadWorkspace(wsRef.current);
      }
      const user = userRef.current;
      if (removeLocalData && user) {
        const reg = registryRef.current;
        const mine = reg.list.filter((w) => w.userId === user.id);
        for (const w of mine) {
          await clearWorkspaceStorage(w.id);
          sessionStorage.removeItem(passKey(w.id));
        }
        const rest = reg.list.filter((w) => w.userId !== user.id);
        await updateRegistry({ list: rest, currentId: rest[0]?.id ?? null });
      }
      closeCurrent();
      wsRef.current = null;
      passRef.current = null;
      if (cloud) await cloud.signOut();
      userRef.current = null;
      setCloudUser(null);
      setCloudStatus("signed_out");
      localStorage.removeItem(DEVICE_ONLY_KEY);
      setStatus("auth");
    },
    [closeCurrent, updateRegistry, uploadWorkspace],
  );

  const continueWithoutAccount = useCallback(() => {
    localStorage.setItem(DEVICE_ONLY_KEY, "1");
    void enter();
  }, [enter]);

  const syncNow = useCallback(async () => {
    if (!cloudRef.current || !userRef.current) return;
    await reconcileWithCloud();
    if (wsRef.current) await uploadWorkspace(wsRef.current);
  }, [reconcileWithCloud, uploadWorkspace]);

  // ------------------------------------------------------------------ workspace actions

  const createWorkspace = useCallback(
    async (input: CreateWorkspaceInput) => {
      const user = userRef.current;
      const ws: WorkspaceInfo = { id: uid(), name: input.name.trim(), businessName: input.businessName.trim(), ownerName: input.ownerName.trim(), template: input.template, createdAt: new Date().toISOString(), cloud: !!user, userId: user?.id ?? null };
      const reg = registryRef.current;
      await updateRegistry({ list: [...reg.list, ws], currentId: ws.id });
      passRef.current = input.passphrase || null;
      if (input.passphrase) sessionStorage.setItem(passKey(ws.id), input.passphrase);
      setStatus("loading");
      await boot(ws.id, undefined, { template: ws.template, businessName: ws.businessName, ownerName: ws.ownerName, baseCurrency: input.baseCurrency, householdCurrency: input.householdCurrency });
      if (user) await uploadWorkspace(ws.id);
    },
    [updateRegistry, boot, uploadWorkspace],
  );

  const switchWorkspace = useCallback(
    async (id: string) => {
      const reg = registryRef.current;
      const ws = reg.list.find((w) => w.id === id);
      if (!ws || id === wsRef.current) return;
      await persistNow();
      if (uploadTimer.current && wsRef.current) {
        clearTimeout(uploadTimer.current);
        await uploadWorkspace(wsRef.current);
      }
      await updateRegistry({ ...reg, currentId: id });
      let remote: RemoteWorkspace | undefined;
      if (ws.cloud && cloudRef.current && userRef.current) {
        try {
          remote = (await cloudRef.current.listWorkspaces()).find((r) => r.id === id);
        } catch {
          remote = undefined;
        }
      }
      await open(ws, remote);
    },
    [updateRegistry, open, persistNow, uploadWorkspace],
  );

  const renameWorkspace = useCallback(
    async (id: string, name: string, businessName?: string) => {
      await patchWorkspace(id, { name: name.trim() || undefined, businessName: businessName?.trim() || undefined });
      const ws = registryRef.current.list.find((w) => w.id === id);
      if (ws?.cloud && cloudRef.current && userRef.current) {
        const raw = await loadRawImage(id);
        await cloudRef.current.upsertWorkspace({ id: ws.id, name: ws.name, businessName: ws.businessName, ownerName: ws.ownerName, template: ws.template, version: raw?.meta.version ?? 0, savedAt: raw?.meta.savedAt ?? null, encrypted: raw?.meta.encrypted ?? false, salt: raw?.meta.salt ?? null, iv: raw?.meta.iv ?? null, createdAt: ws.createdAt });
      }
    },
    [patchWorkspace],
  );

  const deleteWorkspace = useCallback(
    async (id: string) => {
      const reg = registryRef.current;
      const ws = reg.list.find((w) => w.id === id);
      const remaining = reg.list.filter((w) => w.id !== id);
      await clearWorkspaceStorage(id);
      sessionStorage.removeItem(passKey(id));
      if (ws?.cloud && cloudRef.current && userRef.current) {
        try {
          await cloudRef.current.deleteWorkspace(id);
        } catch (e) {
          console.error("Cloud delete failed", e);
        }
      }
      if (id === wsRef.current) {
        closeCurrent();
        wsRef.current = null;
        passRef.current = null;
      }
      const visible = visibleWorkspaces({ list: remaining, currentId: null }, userRef.current);
      const next: WorkspaceRegistry = { list: remaining, currentId: id === reg.currentId ? (visible[0]?.id ?? null) : reg.currentId };
      await updateRegistry(next);
      if (id === reg.currentId) {
        const target = remaining.find((w) => w.id === next.currentId);
        if (target) await open(target);
        else setStatus("setup");
      }
    },
    [updateRegistry, closeCurrent, open, visibleWorkspaces],
  );

  // ------------------------------------------------------------------ lock / data

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
    const ws = registryRef.current.list.find((w) => w.id === id);
    closeCurrent();
    passRef.current = null;
    sessionStorage.removeItem(passKey(id));
    await clearWorkspaceStorage(id);
    setStatus("loading");
    await boot(id, undefined, ws ? { template: ws.template, businessName: ws.businessName, ownerName: ws.ownerName } : undefined);
  }, [boot, closeCurrent]);

  const snapshotFor = useCallback(
    (m: string) => {
      if (!data) throw new Error("Data not loaded");
      return buildSnapshot(data, m, today);
    },
    [data, today],
  );

  const snapshot = useMemo(() => (data ? buildSnapshot(data, month, today) : null), [data, month, today]);
  const alerts = useMemo(() => (data && snapshot ? buildAlerts(data, snapshot, today) : []), [data, snapshot, today]);
  const workspaces = useMemo(() => visibleWorkspaces(registry, cloudUser), [registry, cloudUser, visibleWorkspaces]);
  const currentWorkspace = workspaces.find((w) => w.id === registry.currentId) ?? null;
  void decryptImage;

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
    workspaces,
    currentWorkspace,
    createWorkspace,
    switchWorkspace,
    renameWorkspace,
    deleteWorkspace,
    cloudAvailable: cloudStatus !== "off",
    cloudUser,
    cloudStatus,
    cloudError,
    lastSyncedAt,
    signUp,
    signIn,
    sendMagicLink,
    sendPasswordReset,
    signOut,
    continueWithoutAccount,
    syncNow,
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
