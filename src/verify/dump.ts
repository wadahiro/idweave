/**
 * verify — cross-system state dump emitted on failure.
 *
 * When a check fails, capture the relevant state across systems (focus user,
 * its projection shadows, and the driving task) into a directory so a human or
 * an offline triage tool can see exactly what the running system looked like. This is a
 * diagnostic; it never participates in the pass/fail decision.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MidpointRest, MidpointObject } from "../clients/midpointRest.ts";

export interface DumpContext {
  /** Scenario label, used in the dump directory name. */
  scenario: string;
  /** Focus user name(s) whose cross-system state should be captured. */
  userNames: string[];
  /** Driving task oid, if any. */
  taskOid?: string;
}

function asArray(value: unknown): MidpointObject[] {
  if (Array.isArray(value)) return value as MidpointObject[];
  if (value && typeof value === "object") return [value as MidpointObject];
  return [];
}

async function writeJson(dir: string, file: string, data: unknown): Promise<void> {
  await writeFile(join(dir, file), JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Capture cross-system state into `<dumpDir>/<scenario>-<stamp>/` and return
 * the directory path. `stamp` is supplied by the caller for determinism.
 */
export async function dumpCrossSystem(
  rest: MidpointRest,
  ctx: DumpContext,
  dumpDir: string,
  stamp: string,
): Promise<string> {
  const dir = resolve(process.cwd(), dumpDir, `${ctx.scenario}-${stamp}`);
  await mkdir(dir, { recursive: true });

  for (const name of ctx.userNames) {
    const users = await rest.searchByName("users", name);
    await writeJson(dir, `user.${name}.json`, users);
    // Linked projection shadows.
    for (const user of users) {
      for (const link of asArray((user as Record<string, unknown>)["linkRef"])) {
        const shadowOid = (link as Record<string, unknown>)["oid"];
        if (typeof shadowOid === "string") {
          const shadow = await rest.getShadow(shadowOid).catch(() => null);
          await writeJson(dir, `shadow.${name}.${shadowOid}.json`, shadow);
        }
      }
    }
  }

  if (ctx.taskOid) {
    const task = await rest.getTask(ctx.taskOid, true).catch(() => null);
    await writeJson(dir, `task.${ctx.taskOid}.json`, task);
  }

  return dir;
}
