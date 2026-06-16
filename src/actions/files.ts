/**
 * actions — host file IO for deployment task-driven scenarios. Some operational tasks
 * read an INPUT file (e.g. a list of user IDs) from a host-mounted dir and write a
 * result OUTPUT file there. The harness writes the input as a precondition and reads
 * the output to assert. Paths resolve against the configured files host dir (the
 * deployment's mounted volume), or may be absolute. NOT for CSV source/target files
 * (those are the csv system); this is for arbitrary task IO.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

/** Resolve a step `path` against the files host dir (absolute path passes through). */
export function resolveFilePath(hostDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(hostDir, path);
}

/** Write `content` to the host file at `path` (relative to `hostDir`), creating dirs. */
export async function writeHostFile(hostDir: string, path: string, content: string): Promise<void> {
  const abs = resolveFilePath(hostDir, path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

/** Read the host file at `path` (relative to `hostDir`) as UTF-8, or null if absent. */
export async function readHostFile(hostDir: string, path: string): Promise<string | null> {
  const abs = resolveFilePath(hostDir, path);
  try {
    return await readFile(abs, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
