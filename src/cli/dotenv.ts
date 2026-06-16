/**
 * Minimal .env loader for the CLI. The library reads configuration from the
 * process environment (by design: env from the environment, never hardcoded);
 * this is a CLI-only convenience so a consuming project can keep its midPoint
 * endpoint and credentials in a local .env instead of its shell profile.
 *
 * Already-set environment variables WIN over the file (so `MIDPOINT_USER=x idw
 * run` and CI-exported env override .env, matching standard dotenv semantics).
 * No interpolation, no quoting tricks, no dependency.
 */
import { existsSync, readFileSync } from "node:fs";

/**
 * Load `KEY=VALUE` pairs from `path` into process.env without overriding vars
 * that are already set. Returns the count applied (0 if the file is absent).
 */
export function loadDotenv(path = ".env"): number {
  if (!existsSync(path)) return 0;
  let applied = 0;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue; // real env wins over the file
    let value = body.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    applied++;
  }
  return applied;
}
