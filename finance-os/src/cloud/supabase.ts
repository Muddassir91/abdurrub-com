import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AccessStatus, CloudBackend, CloudUser, ImageMeta, Profile, RemoteWorkspace } from "./types";
import type { SeedTemplate } from "@/db/persistence";

/**
 * Supabase implementation.
 *   table   public.workspaces   one row per workspace, RLS: user_id = auth.uid()
 *   bucket  workspaces          <user_id>/<workspace_id>.sqlite, RLS by folder
 * See supabase/schema.sql for the exact SQL to run once in the Supabase dashboard.
 */

interface Row {
  id: string;
  user_id: string;
  name: string;
  business_name: string;
  owner_name: string;
  template: string;
  version: number;
  saved_at: string | null;
  encrypted: boolean;
  salt: string | null;
  iv: string | null;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  user_id: string;
  email: string | null;
  trial_ends_at: string;
  access_status: string;
  plan: string | null;
  notes: string | null;
  created_at: string;
  last_seen_at: string | null;
}

const BUCKET = "workspaces";

export class SupabaseCloud implements CloudBackend {
  readonly kind = "supabase" as const;
  private client: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }

  private toUser(u: { id: string; email?: string } | null | undefined): CloudUser | null {
    return u ? { id: u.id, email: u.email ?? null } : null;
  }

  async getUser() {
    const { data } = await this.client.auth.getSession();
    return this.toUser(data.session?.user);
  }

  onAuthChange(cb: (u: CloudUser | null) => void) {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => cb(this.toUser(session?.user)));
    return () => data.subscription.unsubscribe();
  }

  async signUp(email: string, password: string, redirectTo: string) {
    const { data, error } = await this.client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
    if (error) throw new Error(error.message);
    return { needsEmailConfirmation: !data.session };
  }

  async signInWithPassword(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }

  async sendMagicLink(email: string, redirectTo: string) {
    const { error } = await this.client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) throw new Error(error.message);
  }

  async signInWithOAuth(provider: "google", redirectTo: string) {
    const { error } = await this.client.auth.signInWithOAuth({ provider, options: { redirectTo, queryParams: { access_type: "offline", prompt: "select_account" } } });
    if (error) throw new Error(/not enabled|unsupported provider/i.test(error.message) ? "Google sign-in is not switched on yet for this app." : error.message);
  }

  async sendPasswordReset(email: string, redirectTo: string) {
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error(error.message);
  }

  async signOut() {
    await this.client.auth.signOut();
  }

  private toProfile(r: ProfileRow): Profile {
    return { userId: r.user_id, email: r.email, trialEndsAt: r.trial_ends_at, accessStatus: r.access_status as AccessStatus, plan: r.plan, notes: r.notes, createdAt: r.created_at, lastSeenAt: r.last_seen_at };
  }

  async touchProfile() {
    const { data, error } = await this.client.rpc("touch_profile");
    if (error) {
      // Access control not installed yet (function missing): treat as unrestricted.
      if (/function|does not exist|404|schema cache/i.test(error.message)) return null;
      throw new Error(error.message);
    }
    const row = (Array.isArray(data) ? data[0] : data) as ProfileRow | null;
    return row ? this.toProfile(row) : null;
  }

  async isAdmin() {
    const { data, error } = await this.client.rpc("is_admin");
    if (error) return false;
    return data === true;
  }

  async listProfiles() {
    const { data, error } = await this.client.from("profiles").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as ProfileRow[]).map((r) => this.toProfile(r));
  }

  async updateProfile(userId: string, patch: Partial<Pick<Profile, "trialEndsAt" | "accessStatus" | "plan" | "notes">>) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.trialEndsAt !== undefined) row.trial_ends_at = patch.trialEndsAt;
    if (patch.accessStatus !== undefined) row.access_status = patch.accessStatus;
    if (patch.plan !== undefined) row.plan = patch.plan;
    if (patch.notes !== undefined) row.notes = patch.notes;
    const { error } = await this.client.from("profiles").update(row).eq("user_id", userId);
    if (error) throw new Error(error.message);
  }

  private async userId() {
    const u = await this.getUser();
    if (!u) throw new Error("Not signed in");
    return u.id;
  }

  async listWorkspaces(): Promise<RemoteWorkspace[]> {
    const { data, error } = await this.client.from("workspaces").select("*").order("created_at");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      name: r.name,
      businessName: r.business_name,
      ownerName: r.owner_name,
      template: r.template as SeedTemplate,
      version: r.version,
      savedAt: r.saved_at,
      encrypted: r.encrypted,
      salt: r.salt,
      iv: r.iv,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async upsertWorkspace(meta: Omit<RemoteWorkspace, "updatedAt">) {
    const user_id = await this.userId();
    const { error } = await this.client.from("workspaces").upsert(
      {
        id: meta.id,
        user_id,
        name: meta.name,
        business_name: meta.businessName,
        owner_name: meta.ownerName,
        template: meta.template,
        version: meta.version,
        saved_at: meta.savedAt,
        encrypted: meta.encrypted,
        salt: meta.salt,
        iv: meta.iv,
        created_at: meta.createdAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);
  }

  async deleteWorkspace(id: string) {
    const uid = await this.userId();
    await this.client.storage.from(BUCKET).remove([`${uid}/${id}.sqlite`]);
    const { error } = await this.client.from("workspaces").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async downloadImage(id: string) {
    const uid = await this.userId();
    const { data, error } = await this.client.storage.from(BUCKET).download(`${uid}/${id}.sqlite`);
    if (error) {
      if (/not found|404|object not found/i.test(error.message)) return null;
      throw new Error(error.message);
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async uploadImage(id: string, bytes: Uint8Array, meta: ImageMeta) {
    const uid = await this.userId();
    const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
    const { error } = await this.client.storage.from(BUCKET).upload(`${uid}/${id}.sqlite`, blob, { upsert: true, contentType: "application/octet-stream" });
    if (error) throw new Error(error.message);
    const { error: e2 } = await this.client
      .from("workspaces")
      .update({ version: meta.version, saved_at: meta.savedAt, encrypted: meta.encrypted, salt: meta.salt ?? null, iv: meta.iv ?? null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (e2) throw new Error(e2.message);
  }
}
