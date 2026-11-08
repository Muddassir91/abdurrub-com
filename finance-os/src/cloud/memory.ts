import type { CloudBackend, CloudUser, ImageMeta, RemoteWorkspace } from "./types";

/** In-memory backend for tests and for the browser smoke test. Behaves like Supabase without a network. */
export class MemoryCloud implements CloudBackend {
  readonly kind = "memory" as const;
  private user: CloudUser | null = null;
  private listeners = new Set<(u: CloudUser | null) => void>();
  private accounts = new Map<string, { id: string; password: string }>();
  private rows = new Map<string, RemoteWorkspace & { userId: string }>();
  private images = new Map<string, Uint8Array>();

  private static KEY = "finance-os:memory-cloud";

  constructor(initialUser: CloudUser | null = null) {
    this.user = initialUser;
    this.restore();
  }

  /** In the browser, state survives reloads via sessionStorage so sign-in flows can be tested end to end. */
  private restore() {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(MemoryCloud.KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as { user: CloudUser | null; accounts: [string, { id: string; password: string }][]; rows: [string, RemoteWorkspace & { userId: string }][]; images: [string, string][] };
      this.user = j.user;
      this.accounts = new Map(j.accounts);
      this.rows = new Map(j.rows);
      this.images = new Map(j.images.map(([k, v]) => [k, Uint8Array.from(atob(v), (c) => c.charCodeAt(0))]));
    } catch {
      /* ignore */
    }
  }

  private persist() {
    if (typeof window === "undefined") return;
    try {
      const images: [string, string][] = [...this.images.entries()].map(([k, v]) => [k, btoa(Array.from(v, (b) => String.fromCharCode(b)).join(""))]);
      sessionStorage.setItem(MemoryCloud.KEY, JSON.stringify({ user: this.user, accounts: [...this.accounts.entries()], rows: [...this.rows.entries()], images }));
    } catch {
      /* ignore */
    }
  }

  async getUser() {
    return this.user;
  }
  onAuthChange(cb: (u: CloudUser | null) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  private emit() {
    this.persist();
    for (const l of this.listeners) l(this.user);
  }
  async signUp(email: string, password: string) {
    if (this.accounts.has(email)) throw new Error("An account with this email already exists");
    const id = `user-${this.accounts.size + 1}`;
    this.accounts.set(email, { id, password });
    this.user = { id, email };
    this.emit();
    return { needsEmailConfirmation: false };
  }
  async signInWithPassword(email: string, password: string) {
    const a = this.accounts.get(email);
    if (!a || a.password !== password) throw new Error("Invalid email or password");
    this.user = { id: a.id, email };
    this.emit();
  }
  async sendMagicLink() {
    /* no-op in memory */
  }
  async sendPasswordReset() {
    /* no-op in memory */
  }
  async signOut() {
    this.user = null;
    this.emit();
  }
  private requireUser() {
    if (!this.user) throw new Error("Not signed in");
    return this.user;
  }
  async listWorkspaces() {
    const u = this.requireUser();
    return [...this.rows.values()].filter((r) => r.userId === u.id).map(({ userId, ...rest }) => {
      void userId;
      return rest;
    });
  }
  async upsertWorkspace(meta: Omit<RemoteWorkspace, "updatedAt">) {
    const u = this.requireUser();
    const existing = this.rows.get(meta.id);
    if (existing && existing.userId !== u.id) throw new Error("Forbidden");
    this.rows.set(meta.id, { ...meta, userId: u.id, updatedAt: new Date().toISOString() });
    this.persist();
  }
  async deleteWorkspace(id: string) {
    const u = this.requireUser();
    const existing = this.rows.get(id);
    if (existing && existing.userId !== u.id) throw new Error("Forbidden");
    this.rows.delete(id);
    this.images.delete(`${u.id}/${id}`);
    this.persist();
  }
  async downloadImage(id: string) {
    const u = this.requireUser();
    return this.images.get(`${u.id}/${id}`) ?? null;
  }
  async uploadImage(id: string, bytes: Uint8Array, meta: ImageMeta) {
    const u = this.requireUser();
    this.images.set(`${u.id}/${id}`, new Uint8Array(bytes));
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, version: meta.version, savedAt: meta.savedAt, encrypted: meta.encrypted, salt: meta.salt ?? null, iv: meta.iv ?? null, updatedAt: new Date().toISOString() });
    this.persist();
  }
}
