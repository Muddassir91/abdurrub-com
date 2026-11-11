// CFoh! assistant Worker (Cloudflare Workers + Workers AI, free tier).
//
// The app calls POST /chat with {message, context, history}. The Worker adds
// the fixed instructions (worker/prompt.md, inlined at deploy time), asks a
// Workers AI model for one JSON object {reply, actions}, and returns it.
// It stores nothing. The app validates and executes the actions itself.
//
// Deploy with: node scripts/deploy-assistant.mjs  (see README)

const SYSTEM = __PROMPT__;

const DEFAULT_MODELS = __MODELS__;
const LIMIT = { windowMs: 10 * 60 * 1000, max: 40 };
const hits = new Map(); // per-isolate, best effort

function allowedOrigin(origin, env) {
  if (!origin) return false;
  const list = (env.ALLOWED_ORIGINS || "https://abdurrub.com").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } });
}

function limited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > LIMIT.windowMs) {
    hits.set(ip, { start: now, n: 1 });
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > LIMIT.windowMs) hits.delete(k);
    return false;
  }
  rec.n += 1;
  return rec.n > LIMIT.max;
}

/** Pull the first JSON object out of whatever the model returned. */
function extract(out) {
  let v = out;
  if (v && typeof v === "object" && "response" in v) v = v.response;
  if (v && typeof v === "object" && Array.isArray(v.choices)) v = v.choices[0]?.message?.content;
  if (v && typeof v === "object") return v;
  if (typeof v !== "string") return null;
  const text = v.replace(/```(?:json)?/g, "").trim();
  const start = text.indexOf("{");
  if (start === -1) return { reply: text.slice(0, 600), actions: [] };
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const ok = allowedOrigin(origin, env);
    const cors = ok ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" } : {};
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: ok ? 204 : 403, headers: cors });
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "cfoh-assistant" }, 200, cors);
    if (request.method !== "POST" || url.pathname !== "/chat") return json({ error: "not found" }, 404, cors);
    if (!ok) return json({ error: "origin not allowed" }, 403, cors);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (limited(ip)) return json({ error: "rate limited" }, 429, cors);

    let body;
    try {
      const raw = await request.text();
      if (raw.length > 20000) return json({ error: "too large" }, 413, cors);
      body = JSON.parse(raw);
    } catch {
      return json({ error: "bad request" }, 400, cors);
    }
    const message = typeof body.message === "string" ? body.message.slice(0, 1000).trim() : "";
    if (!message) return json({ error: "empty message" }, 400, cors);
    const context = typeof body.context === "string" ? body.context.slice(0, 6500) : "";
    const history = (Array.isArray(body.history) ? body.history : [])
      .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
      .slice(-6)
      .map((h) => ({ role: h.role, content: h.content.slice(0, 600) }));

    const messages = [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: `CONTEXT\n${context}\n\nMessage: ${message}` }];
    const models = (env.MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
    let lastError = "no model";
    for (const model of models.length ? models : DEFAULT_MODELS) {
      try {
        let out;
        try {
          out = await env.AI.run(model, { messages, max_tokens: 600, temperature: 0.1, response_format: { type: "json_object" } });
        } catch (e) {
          // Some models reject response_format; ask again without it.
          if (!/response_format|json|schema|unsupported|invalid/i.test(String(e && e.message))) throw e;
          out = await env.AI.run(model, { messages, max_tokens: 600, temperature: 0.1 });
        }
        const parsed = extract(out);
        if (parsed && (typeof parsed.reply === "string" || Array.isArray(parsed.actions))) {
          return json({ reply: typeof parsed.reply === "string" ? parsed.reply.slice(0, 1200) : "", actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 8) : [], model }, 200, cors);
        }
        lastError = "unreadable answer";
      } catch (e) {
        lastError = String((e && e.message) || e).slice(0, 200);
        if (/quota|limit|neuron|capacity|4006|3036/i.test(lastError)) return json({ error: "daily allowance used", detail: lastError }, 429, cors);
      }
    }
    return json({ error: "model unavailable", detail: lastError }, 502, cors);
  },
};
