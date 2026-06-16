/**
 * Expected-file helpers shared by every expect-* step: resolve where an `expected:`
 * path lives, and capture (write) it. Keeping both here means resolve and capture
 * always agree, and the capture-collision guard protects ALL expect kinds, not just
 * `expect`.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import type { RunContext } from "./types.ts";

/**
 * Resolve an `expected:` file path under the scenario dir. With
 * `cfg.expectedVersion` set, the version is inserted as a subdir
 * (`expected/<ver>/file.json`) so ONE scenario tree can carry per-major-version
 * expected; empty = flat (the default). Resolve and capture use this same rule.
 */
export function expectedPath(ctx: RunContext, rel: string): string {
  const v = ctx.cfg.expectedVersion;
  return v ? join(ctx.scenarioDir, dirname(rel), v, basename(rel)) : join(ctx.scenarioDir, rel);
}

/**
 * Write a captured expected file. The collision guard catches two expect steps
 * writing the SAME file with DIFFERENT content in one scenario — a shared expected
 * file can't represent two states, and last-write-wins would leave the other assert
 * to burn its whole poll timeout, so fail loudly at capture time (when the author
 * reviews) instead.
 */
export async function captureExpectedFile(ctx: RunContext, path: string, value: unknown): Promise<void> {
  const abs = resolve(path);
  const content = JSON.stringify(value, null, 2) + "\n";
  const seen = (ctx.state.capturedFiles ??= new Map<string, string>());
  const prior = seen.get(abs);
  if (prior !== undefined && prior !== content) {
    throw new Error(
      `capture collision: "${path}" was captured twice with DIFFERENT content in scenario ` +
        `"${ctx.scenarioId}". Two expect steps share one expected file but assert different states — give them ` +
        `distinct \`expected:\` paths (e.g. before.json for the gate vs after.json for the final assert).`,
    );
  }
  seen.set(abs, content);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf-8");
}
