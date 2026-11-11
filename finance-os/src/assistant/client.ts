import { ACTION_NAMES, type RawAction } from "./actions";

/**
 * Calls the assistant Worker (Cloudflare Workers AI). Only used when the
 * on-device parser does not understand a message. The Worker returns
 * {reply, actions}; actions are validated again before anything runs.
 */
export const ASSISTANT_URL = (process.env.NEXT_PUBLIC_ASSISTANT_URL ?? "").replace(/\/+$/, "");

export interface ModelTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ModelAnswer {
  reply: string;
  actions: RawAction[];
  model?: string;
}

/** Where the assistant lives. The browser test points this at a local stand-in. */
export function assistantUrl(): string {
  if (typeof window !== "undefined") {
    try {
      const override = localStorage.getItem("finance-os:assistant-url");
      if (override !== null) return override.replace(/\/+$/, "");
    } catch {
      /* ignore */
    }
  }
  return ASSISTANT_URL;
}

/** Keep only well-formed actions with known names. */
export function cleanActions(raw: unknown): RawAction[] {
  if (!Array.isArray(raw)) return [];
  const names = new Set<string>(ACTION_NAMES);
  const out: RawAction[] = [];
  for (const x of raw.slice(0, 8)) {
    if (!x || typeof x !== "object") continue;
    const name = String((x as { name?: unknown }).name ?? (x as { action?: unknown }).action ?? (x as { tool?: unknown }).tool ?? "");
    if (!names.has(name)) continue;
    const args = (x as { args?: unknown; arguments?: unknown }).args ?? (x as { arguments?: unknown }).arguments;
    out.push({ name, args: args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {} });
  }
  return out;
}

export async function askModel(message: string, context: string, history: ModelTurn[], signal?: AbortSignal): Promise<ModelAnswer> {
  const url = assistantUrl();
  if (!url) throw new Error("The assistant model is not connected.");
  const res = await fetch(`${url}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: message.slice(0, 1000), context, history: history.slice(-6).map((h) => ({ role: h.role, content: h.content.slice(0, 600) })) }),
    signal,
  });
  if (res.status === 429) throw new Error("The assistant has answered a lot today and is resting. Typed commands like \"spent 20 on lunch\" still work.");
  if (!res.ok) throw new Error("The assistant could not answer just now. Typed commands like \"spent 20 on lunch\" still work.");
  const body = (await res.json()) as { reply?: unknown; actions?: unknown; model?: unknown };
  return { reply: typeof body.reply === "string" ? body.reply.trim() : "", actions: cleanActions(body.actions), model: typeof body.model === "string" ? body.model : undefined };
}
