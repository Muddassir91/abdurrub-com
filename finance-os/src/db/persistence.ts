/**
 * IndexedDB persistence for the SQLite byte images, one per workspace, with
 * optional passphrase encryption (PBKDF2 -> AES-GCM via WebCrypto). Nothing
 * ever leaves the browser: the "deployment" is static files; your data stays
 * on your device.
 *
 * Layout inside the "kv" object store:
 *   workspaces                 -> WorkspaceRegistry
 *   sqlite-image:<workspaceId> -> Uint8Array (plain or AES-GCM ciphertext)
 *   meta:<workspaceId>         -> StoredMeta
 */

const DB_NAME = "finance-os";
const STORE = "kv";
const REGISTRY_KEY = "workspaces";
const LEGACY_DATA_KEY = "sqlite-image";
const LEGACY_META_KEY = "meta";
export const DEFAULT_WORKSPACE_ID = "retention-rules";

export interface StoredMeta {
  encrypted: boolean;
  salt?: string; // base64
  iv?: string; // base64
  savedAt: string;
  /** Monotonic save counter, used by cloud sync to detect divergence. */
  version: number;
  /** Local version last confirmed identical to the cloud copy (0 = never synced). */
  lastSyncedVersion?: number;
}

export type SeedTemplate = "retention_rules" | "blank";

export interface WorkspaceInfo {
  id: string;
  name: string;
  businessName: string;
  ownerName: string;
  template: SeedTemplate;
  createdAt: string;
  /** True once the workspace exists in the signed-in cloud account. */
  cloud?: boolean;
  /** Owning cloud user id, when known. */
  userId?: string | null;
}

export interface WorkspaceRegistry {
  list: WorkspaceInfo[];
  currentId: string | null;
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/** Write several keys in ONE transaction so a page unload cannot leave them half-written. */
async function idbPutMany(entries: [string, unknown][]): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const [k, v] of entries) store.put(v, k);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

const dataKey = (id: string) => `${LEGACY_DATA_KEY}:${id}`;
const metaKey = (id: string) => `${LEGACY_META_KEY}:${id}`;

/** Load the registry, migrating a pre-workspace single database into the default workspace. */
export async function loadRegistry(): Promise<WorkspaceRegistry> {
  const reg = await idbGet<WorkspaceRegistry>(REGISTRY_KEY);
  if (reg) return reg;
  const legacy = await idbGet<ArrayBuffer | Uint8Array>(LEGACY_DATA_KEY);
  if (legacy) {
    const legacyMeta = await idbGet<StoredMeta>(LEGACY_META_KEY);
    await idbPut(dataKey(DEFAULT_WORKSPACE_ID), legacy);
    if (legacyMeta) await idbPut(metaKey(DEFAULT_WORKSPACE_ID), legacyMeta);
    await idbDelete(LEGACY_DATA_KEY);
    await idbDelete(LEGACY_META_KEY);
    const migrated: WorkspaceRegistry = {
      list: [{ id: DEFAULT_WORKSPACE_ID, name: "Retention Rules", businessName: "Retention Rules", ownerName: "Muddassir Abdur Rub", template: "retention_rules", createdAt: new Date().toISOString() }],
      currentId: DEFAULT_WORKSPACE_ID,
    };
    await saveRegistry(migrated);
    return migrated;
  }
  return { list: [], currentId: null };
}

export async function saveRegistry(reg: WorkspaceRegistry): Promise<void> {
  await idbPut(REGISTRY_KEY, reg);
}

const b64 = {
  enc: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
  dec: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 310_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function loadMeta(workspaceId: string): Promise<StoredMeta | undefined> {
  return idbGet<StoredMeta>(metaKey(workspaceId));
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("Wrong passphrase");
    this.name = "WrongPassphraseError";
  }
}

/** Load a workspace's SQLite image; returns undefined when nothing has been saved yet. */
export async function loadImage(workspaceId: string, passphrase?: string): Promise<Uint8Array | undefined> {
  const meta = await loadMeta(workspaceId);
  const data = await idbGet<ArrayBuffer | Uint8Array>(dataKey(workspaceId));
  if (!data) return undefined;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!meta?.encrypted) return bytes;
  if (!passphrase) throw new WrongPassphraseError();
  try {
    const key = await deriveKey(passphrase, b64.dec(meta.salt!));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(meta.iv!) as BufferSource }, key, bytes as BufferSource);
    return new Uint8Array(plain);
  } catch {
    throw new WrongPassphraseError();
  }
}

export interface SaveOptions {
  /** Version to record; defaults to previous version + 1. */
  version?: number;
  /** Local version known to match the cloud; defaults to the previous value. */
  lastSyncedVersion?: number;
  /** Timestamp to record; defaults to now. */
  savedAt?: string;
}

/** Encrypt (optionally) and store a workspace image plus its metadata in one transaction. */
export async function saveImage(workspaceId: string, bytes: Uint8Array, passphrase?: string, opts: SaveOptions = {}): Promise<StoredMeta> {
  const prev = await loadMeta(workspaceId);
  const version = opts.version ?? (prev?.version ?? 0) + 1;
  const lastSyncedVersion = opts.lastSyncedVersion ?? prev?.lastSyncedVersion ?? 0;
  const savedAt = opts.savedAt ?? new Date().toISOString();
  const { payload, meta } = await encryptImage(bytes, passphrase, { version, lastSyncedVersion, savedAt });
  await idbPutMany([
    [dataKey(workspaceId), payload],
    [metaKey(workspaceId), meta],
  ]);
  return meta;
}

/** Produce the stored payload (plain or AES-GCM) and metadata without touching storage. Used for cloud uploads too. */
export async function encryptImage(bytes: Uint8Array, passphrase: string | undefined, base: { version: number; lastSyncedVersion: number; savedAt: string }): Promise<{ payload: Uint8Array; meta: StoredMeta }> {
  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, bytes as BufferSource);
    return { payload: new Uint8Array(cipher), meta: { encrypted: true, salt: b64.enc(salt), iv: b64.enc(iv), ...base } };
  }
  return { payload: bytes, meta: { encrypted: false, ...base } };
}

/** Decrypt a payload downloaded from the cloud using its metadata. */
export async function decryptImage(payload: Uint8Array, meta: { encrypted: boolean; salt?: string | null; iv?: string | null }, passphrase?: string): Promise<Uint8Array> {
  if (!meta.encrypted) return payload;
  if (!passphrase || !meta.salt || !meta.iv) throw new WrongPassphraseError();
  try {
    const key = await deriveKey(passphrase, b64.dec(meta.salt));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(meta.iv) as BufferSource }, key, payload as BufferSource);
    return new Uint8Array(plain);
  } catch {
    throw new WrongPassphraseError();
  }
}

/** Store an already-encoded payload + metadata (e.g. a cloud download) locally without re-encrypting. */
export async function storeRaw(workspaceId: string, payload: Uint8Array, meta: StoredMeta): Promise<void> {
  await idbPutMany([
    [dataKey(workspaceId), payload],
    [metaKey(workspaceId), meta],
  ]);
}

/** Read the stored payload exactly as persisted (encrypted or not) for upload. */
export async function loadRawImage(workspaceId: string): Promise<{ payload: Uint8Array; meta: StoredMeta } | null> {
  const meta = await loadMeta(workspaceId);
  const data = await idbGet<ArrayBuffer | Uint8Array>(dataKey(workspaceId));
  if (!data || !meta) return null;
  return { payload: data instanceof Uint8Array ? data : new Uint8Array(data), meta };
}

export async function updateMeta(workspaceId: string, patch: Partial<StoredMeta>): Promise<void> {
  const meta = await loadMeta(workspaceId);
  if (!meta) return;
  await idbPut(metaKey(workspaceId), { ...meta, ...patch });
}

export async function clearWorkspaceStorage(workspaceId: string): Promise<void> {
  await idbDelete(dataKey(workspaceId));
  await idbDelete(metaKey(workspaceId));
}
