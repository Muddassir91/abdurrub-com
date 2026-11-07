/**
 * IndexedDB persistence for the SQLite byte image, with optional passphrase
 * encryption (PBKDF2 -> AES-GCM via WebCrypto). Nothing ever leaves the
 * browser: the "deployment" is just static files, your data stays on your device.
 */

const DB_NAME = "finance-os";
const STORE = "kv";
const DATA_KEY = "sqlite-image";
const META_KEY = "meta";

export interface StoredMeta {
  encrypted: boolean;
  salt?: string; // base64
  iv?: string; // base64
  savedAt: string;
  version: number;
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

export async function loadMeta(): Promise<StoredMeta | undefined> {
  return idbGet<StoredMeta>(META_KEY);
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("Wrong passphrase");
    this.name = "WrongPassphraseError";
  }
}

/** Load the stored SQLite image; returns undefined when nothing has been saved yet. */
export async function loadImage(passphrase?: string): Promise<Uint8Array | undefined> {
  const meta = await loadMeta();
  const data = await idbGet<ArrayBuffer | Uint8Array>(DATA_KEY);
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

export async function saveImage(bytes: Uint8Array, passphrase?: string): Promise<StoredMeta> {
  let meta: StoredMeta;
  let payload: Uint8Array = bytes;
  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, bytes as BufferSource);
    payload = new Uint8Array(cipher);
    meta = { encrypted: true, salt: b64.enc(salt), iv: b64.enc(iv), savedAt: new Date().toISOString(), version: 1 };
  } else {
    meta = { encrypted: false, savedAt: new Date().toISOString(), version: 1 };
  }
  await idbPut(DATA_KEY, payload);
  await idbPut(META_KEY, meta);
  return meta;
}

export async function clearStorage(): Promise<void> {
  await idbDelete(DATA_KEY);
  await idbDelete(META_KEY);
}
