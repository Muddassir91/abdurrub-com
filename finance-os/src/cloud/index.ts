import type { CloudBackend } from "./types";
import { MemoryCloud } from "./memory";
import { SupabaseCloud } from "./supabase";

/**
 * Picks the cloud backend for this build.
 *  - NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY -> Supabase
 *  - NEXT_PUBLIC_CLOUD=memory                                  -> in-memory (tests)
 *  - otherwise                                                  -> null: device-only mode
 * The anon key is a public, publishable key; privacy comes from row-level
 * security on the server, not from hiding the key.
 */
let cached: CloudBackend | null | undefined;

export function getCloud(): CloudBackend | null {
  if (cached !== undefined) return cached;
  let mode = process.env.NEXT_PUBLIC_CLOUD;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Test hook: the browser smoke test switches a production build to the in-memory backend.
  if (!mode && typeof window !== "undefined") {
    try {
      if (localStorage.getItem("finance-os:cloud") === "memory") mode = "memory";
    } catch {
      /* ignore */
    }
  }
  if (mode === "memory") cached = new MemoryCloud();
  else if (url && key) cached = new SupabaseCloud(url, key);
  else cached = null;
  return cached;
}

export function cloudConfigured(): boolean {
  return process.env.NEXT_PUBLIC_CLOUD === "memory" || !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
