import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The app is a fully client-side single-page application. Data lives in a
// SQLite database (sql.js / WebAssembly) inside the browser, so the whole app
// can be exported as static files and hosted next to the portfolio site under
// https://abdurrub.com/cfoh/
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/cfoh";

// Cloud accounts (Supabase). Values come from the environment or from
// cloud.config.json next to this file; the anon key is a publishable key.
interface CloudConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** URL of the assistant Worker on Cloudflare (see worker/). Empty = on-device commands only. */
  assistantUrl?: string;
}
let cloud: CloudConfig = {};
const cfgPath = join(process.cwd(), "cloud.config.json");
if (existsSync(cfgPath)) {
  try {
    cloud = JSON.parse(readFileSync(cfgPath, "utf8")) as CloudConfig;
  } catch {
    cloud = {};
  }
}
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? cloud.supabaseUrl ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? cloud.supabaseAnonKey ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
    NEXT_PUBLIC_CLOUD: process.env.NEXT_PUBLIC_CLOUD ?? "",
    NEXT_PUBLIC_ASSISTANT_URL: process.env.NEXT_PUBLIC_ASSISTANT_URL ?? cloud.assistantUrl ?? "",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
