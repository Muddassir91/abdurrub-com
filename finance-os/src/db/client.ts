import type { Database, SqlJsStatic } from "sql.js";
import { drizzle, type SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "./schema";
import { MIGRATIONS } from "./migrations";

export type Db = SQLJsDatabase<typeof schema>;

declare global {
  interface Window {
    initSqlJs?: (config?: { locateFile?: (file: string) => string }) => Promise<SqlJsStatic>;
  }
}

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

/** Load sql.js. In the browser the script is served from /public to avoid bundler issues; in Node (tests) we require it. */
export function loadSqlJs(): Promise<SqlJsStatic> {
  if (sqlJsPromise) return sqlJsPromise;
  sqlJsPromise = (async () => {
    if (typeof window === "undefined") {
      // Node / Vitest
      const mod = await import("sql.js");
      const init = (mod.default ?? mod) as unknown as (cfg?: object) => Promise<SqlJsStatic>;
      return init();
    }
    if (!window.initSqlJs) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = `${basePath}/sqljs/sql-wasm.js`;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load SQLite engine (sql-wasm.js)"));
        document.head.appendChild(s);
      });
    }
    if (!window.initSqlJs) throw new Error("SQLite engine did not initialise");
    return window.initSqlJs({ locateFile: (file: string) => `${basePath}/sqljs/${file}` });
  })();
  return sqlJsPromise;
}

export interface OpenedDatabase {
  sql: Database;
  db: Db;
  /** True when a brand-new database was created (needs seeding). */
  isNew: boolean;
}

export async function openDatabase(image?: Uint8Array): Promise<OpenedDatabase> {
  const SQL = await loadSqlJs();
  const sql = image ? new SQL.Database(image) : new SQL.Database();
  sql.run("PRAGMA foreign_keys = OFF;");
  const isNew = !image;
  runMigrations(sql);
  const db = drizzle(sql, { schema });
  return { sql, db, isNew };
}

export function runMigrations(sql: Database): string[] {
  sql.run("CREATE TABLE IF NOT EXISTS __migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
  const applied = new Set<string>();
  const res = sql.exec("SELECT tag FROM __migrations");
  if (res[0]) for (const row of res[0].values) applied.add(String(row[0]));
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.tag)) continue;
    for (const stmt of m.statements) sql.run(stmt);
    sql.run("INSERT INTO __migrations (tag, applied_at) VALUES (?, ?)", [m.tag, new Date().toISOString()]);
    ran.push(m.tag);
  }
  return ran;
}

export function exportImage(sql: Database): Uint8Array {
  return sql.export();
}
