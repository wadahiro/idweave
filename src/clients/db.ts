/**
 * clients — SQL database client (read-only, for assertions).
 *
 * A `db` target's row IS the external end-state the check asserts (e.g. an
 * external-service mock's backing table: "active / expired / delivered"). knex is
 * the one dialect-agnostic layer; the underlying driver is chosen by the URL SCHEME
 * (postgres:// -> pg, the bundled default; mysql:// -> mysql2, etc., installed by
 * the consuming project). Only the password is a secret, injected from the env var
 * the suite names — never put it in the URL.
 */
import knex, { type Knex } from "knex";
import type { DbSystemConfig } from "../scenario/suite.ts";

/** URL scheme -> knex client id. pg is the bundled default; others are optional deps. */
const DIALECT: Record<string, string> = {
  "postgres:": "pg",
  "postgresql:": "pg",
  "mysql:": "mysql2",
  "mariadb:": "mysql2",
  "sqlite:": "better-sqlite3",
  "sqlite3:": "better-sqlite3",
  "sqlserver:": "mssql",
  "mssql:": "mssql",
};

/** Build the knex config from a db system: dialect from the URL scheme, password from env. */
export function knexConfig(system: DbSystemConfig): Knex.Config {
  const u = new URL(system.url);
  const client = DIALECT[u.protocol];
  if (!client) throw new Error(`unsupported db url scheme "${u.protocol}" (use postgres|mysql|sqlite|sqlserver)`);
  const password = process.env[system.passwordEnv];
  if (password === undefined || password === "") {
    throw new Error(`db password env "${system.passwordEnv}" is not set`);
  }
  return {
    client,
    connection: {
      host: u.hostname,
      port: u.port ? Number(u.port) : undefined,
      user: decodeURIComponent(u.username),
      password,
      database: u.pathname.replace(/^\//, ""),
    },
    pool: { min: 0, max: 1 },
  };
}

/** Normalize a driver's raw result into an array of row objects (pg: {rows}, mysql2: [rows]). */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const r = result as { rows?: unknown[] } | unknown[];
  if (r && typeof r === "object" && "rows" in r && Array.isArray(r.rows)) return r.rows as Array<Record<string, unknown>>;
  if (Array.isArray(r)) return (Array.isArray(r[0]) ? r[0] : r) as Array<Record<string, unknown>>;
  return [];
}

/**
 * Run the system's parameterized SELECT binding `:id` = identifier and return the
 * FIRST row (or null if none). A fresh connection per call (assertions are sparse;
 * a pooled long-lived connection isn't worth it) — always destroyed.
 */
export async function queryRow(
  system: DbSystemConfig,
  identifier: string,
): Promise<Record<string, unknown> | null> {
  const db = knex(knexConfig(system));
  try {
    const result = await db.raw(system.query, { id: identifier });
    const rows = rowsOf(result);
    return rows.length ? rows[0]! : null;
  } finally {
    await db.destroy();
  }
}

/**
 * Run the system's parameterized UPDATE (the `db-mutate` write path), binding
 * `:id` = the linking value and `:value` = the new value. Returns the affected row
 * count where the driver reports it (pg: `rowCount`; mysql2: `affectedRows`),
 * else -1. A fresh connection per call — always destroyed. Throws if the system has
 * no `update` SQL (a mutate against a read-only system is a scenario error).
 */
export async function execUpdate(
  system: DbSystemConfig,
  bindings: { id: string; value: string },
): Promise<number> {
  if (!system.update) throw new Error("db-mutate: db system has no `update` SQL");
  const db = knex(knexConfig(system));
  try {
    const result = (await db.raw(system.update, bindings)) as
      | { rowCount?: number }
      | [{ affectedRows?: number }]
      | unknown;
    if (result && typeof result === "object" && "rowCount" in result && typeof result.rowCount === "number") {
      return result.rowCount;
    }
    if (Array.isArray(result) && result[0] && typeof (result[0] as { affectedRows?: number }).affectedRows === "number") {
      return (result[0] as { affectedRows: number }).affectedRows;
    }
    return -1;
  } finally {
    await db.destroy();
  }
}
