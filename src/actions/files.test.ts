/**
 * Unit: host file IO — write/read round-trip, absent→null, path resolution.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { writeHostFile, readHostFile, resolveFilePath } from "./files.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "idw-files-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("host file IO", () => {
  it("writes then reads back content (creating nested dirs)", async () => {
    await writeHostFile(dir, "input/input-x.txt", "a\nb\n");
    expect(await readHostFile(dir, "input/input-x.txt")).toBe("a\nb\n");
  });

  it("returns null for an absent file", async () => {
    expect(await readHostFile(dir, "nope/missing.txt")).toBeNull();
  });

  it("resolveFilePath joins a relative path under the host dir, passes an absolute through", () => {
    expect(resolveFilePath(dir, "sub/f.txt")).toBe(join(dir, "sub/f.txt"));
    const abs = isAbsolute("/tmp/abs.txt") ? "/tmp/abs.txt" : join(dir, "abs.txt");
    expect(resolveFilePath(dir, abs)).toBe(abs);
  });
});
