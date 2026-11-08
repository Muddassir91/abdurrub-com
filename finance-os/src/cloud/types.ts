import type { SeedTemplate } from "@/db/persistence";

/**
 * Cloud accounts and sync.
 *
 * The finance engine and the SQLite database keep running in the browser.
 * The cloud layer only does two things: identify the user, and store each
 * workspace's SQLite image under that user so it follows them across devices.
 * Row-level security on the server means nobody else can read it; with a
 * passphrase set, the image is encrypted before it leaves the browser.
 */

export interface CloudUser {
  id: string;
  email: string | null;
}

export interface RemoteWorkspace {
  id: string;
  name: string;
  businessName: string;
  ownerName: string;
  template: SeedTemplate;
  /** Monotonic counter incremented on every local save; used to detect divergence. */
  version: number;
  savedAt: string | null;
  encrypted: boolean;
  salt: string | null;
  iv: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImageMeta {
  version: number;
  savedAt: string;
  encrypted: boolean;
  salt?: string | null;
  iv?: string | null;
}

export interface CloudBackend {
  readonly kind: "supabase" | "memory";
  getUser(): Promise<CloudUser | null>;
  onAuthChange(cb: (user: CloudUser | null) => void): () => void;
  signUp(email: string, password: string): Promise<{ needsEmailConfirmation: boolean }>;
  signInWithPassword(email: string, password: string): Promise<void>;
  sendMagicLink(email: string, redirectTo: string): Promise<void>;
  sendPasswordReset(email: string, redirectTo: string): Promise<void>;
  signOut(): Promise<void>;
  listWorkspaces(): Promise<RemoteWorkspace[]>;
  upsertWorkspace(meta: Omit<RemoteWorkspace, "updatedAt">): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
  downloadImage(id: string): Promise<Uint8Array | null>;
  uploadImage(id: string, bytes: Uint8Array, meta: ImageMeta): Promise<void>;
}

export class CloudNotConfiguredError extends Error {
  constructor() {
    super("Cloud accounts are not configured for this build");
    this.name = "CloudNotConfiguredError";
  }
}
