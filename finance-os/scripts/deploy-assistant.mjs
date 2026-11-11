// Bundles and deploys the assistant Worker to Cloudflare (Workers + Workers AI).
//
//   CLOUDFLARE_API_TOKEN=... node scripts/deploy-assistant.mjs
//   node scripts/deploy-assistant.mjs --bundle-only     writes .e2e/assistant.bundle.mjs
//
// Options (environment):
//   CLOUDFLARE_ACCOUNT_ID   account to deploy to (found automatically when the token sees one account)
//   ASSISTANT_NAME          Worker name (default cfoh-assistant)
//   ASSISTANT_MODELS        comma-separated Workers AI models, tried in order
//   ASSISTANT_ORIGINS       comma-separated sites allowed to call it (default https://abdurrub.com)
//
// The token needs: Account > Workers Scripts > Edit, and Account > Workers AI > Read.
// On success the Worker URL is written to cloud.config.json as "assistantUrl".
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct-fast"];

export function bundle(models = DEFAULT_MODELS) {
  const root = resolve(import.meta.dirname, "..");
  const src = readFileSync(resolve(root, "worker", "assistant.js"), "utf8");
  const prompt = readFileSync(resolve(root, "worker", "prompt.md"), "utf8").trim();
  return src.replace("__PROMPT__", JSON.stringify(prompt)).replace("__MODELS__", JSON.stringify(models));
}

async function main() {
  const models = (process.env.ASSISTANT_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const code = bundle(models.length ? models : DEFAULT_MODELS);
  if (process.argv.includes("--bundle-only")) {
    const out = resolve(process.cwd(), ".e2e", "assistant.bundle.mjs");
    mkdirSync(resolve(process.cwd(), ".e2e"), { recursive: true });
    writeFileSync(out, code);
    console.log(`bundled -> ${out} (${code.length} bytes)`);
    return;
  }

  if (process.env.HTTPS_PROXY) {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
  }
  const token = process.env.CLOUDFLARE_API_TOKEN ?? "proxy-injected";
  const api = async (path, init = {}) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 400)}`);
    return body.result;
  };

  let account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!account) {
    const accounts = await api("/accounts");
    if (accounts.length !== 1) throw new Error(`Set CLOUDFLARE_ACCOUNT_ID. Accounts visible to this token: ${accounts.map((a) => `${a.name} (${a.id})`).join(", ") || "none"}`);
    account = accounts[0].id;
    console.log(`account: ${accounts[0].name}`);
  }
  const name = process.env.ASSISTANT_NAME ?? "cfoh-assistant";
  const origins = process.env.ASSISTANT_ORIGINS ?? "https://abdurrub.com";

  const form = new FormData();
  form.set(
    "metadata",
    new Blob(
      [
        JSON.stringify({
          main_module: "assistant.js",
          compatibility_date: "2025-01-01",
          bindings: [
            { type: "ai", name: "AI" },
            { type: "plain_text", name: "ALLOWED_ORIGINS", text: origins },
          ],
        }),
      ],
      { type: "application/json" },
    ),
  );
  form.set("assistant.js", new Blob([code], { type: "application/javascript+module" }), "assistant.js");
  await api(`/accounts/${account}/workers/scripts/${name}`, { method: "PUT", body: form });
  console.log(`uploaded Worker "${name}"`);

  await api(`/accounts/${account}/workers/scripts/${name}/subdomain`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true, previews_enabled: false }) });
  const sub = await api(`/accounts/${account}/workers/subdomain`);
  const url = `https://${name}.${sub.subdomain}.workers.dev`;
  console.log(`live at ${url}`);

  const cfgPath = resolve(process.cwd(), "cloud.config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.assistantUrl = url;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`wrote assistantUrl to cloud.config.json. Rebuild the site to use it.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
}
