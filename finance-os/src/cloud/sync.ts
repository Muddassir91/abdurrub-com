/**
 * Sync decisions between the local copy of a workspace and the cloud copy.
 *
 * Each save increments `version` and stamps `savedAt`. `lastSyncedVersion` is
 * the local version last known to match the cloud. From those three numbers
 * we decide what to do without ever silently discarding newer data.
 */
export interface LocalState {
  version: number;
  savedAt: string | null;
  lastSyncedVersion: number;
}

export interface RemoteState {
  version: number;
  savedAt: string | null;
}

export type SyncDecision =
  | { action: "none" }
  | { action: "upload" }
  | { action: "download" }
  /** Both sides changed since the last sync. `prefer` is the newer save; the other side is kept as a backup copy. */
  | { action: "conflict"; prefer: "local" | "remote" };

export function decideSync(local: LocalState | null, remote: RemoteState | null): SyncDecision {
  if (!local && !remote) return { action: "none" };
  if (local && !remote) return { action: "upload" };
  if (!local && remote) return { action: "download" };
  const l = local!;
  const r = remote!;
  const localChanged = l.version > l.lastSyncedVersion;
  const remoteChanged = r.version > l.lastSyncedVersion;
  if (!localChanged && !remoteChanged) return { action: "none" };
  if (localChanged && !remoteChanged) return { action: "upload" };
  if (!localChanged && remoteChanged) return { action: "download" };
  const lt = l.savedAt ? Date.parse(l.savedAt) : 0;
  const rt = r.savedAt ? Date.parse(r.savedAt) : 0;
  return { action: "conflict", prefer: lt >= rt ? "local" : "remote" };
}
