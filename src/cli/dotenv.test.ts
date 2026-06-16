import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDotenv } from "./dotenv.ts";

function envFile(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "idw-env-")), ".env");
  writeFileSync(path, body);
  return path;
}

describe("loadDotenv", () => {
  const touched = ["IDW_T_A", "IDW_T_B", "IDW_T_QUOTED", "IDW_T_EXPORT", "IDW_T_WIN"];
  beforeEach(() => touched.forEach((k) => delete process.env[k]));
  afterEach(() => touched.forEach((k) => delete process.env[k]));

  it("returns 0 and sets nothing when the file is absent", () => {
    expect(loadDotenv(join(tmpdir(), "idw-no-such-file-.env"))).toBe(0);
  });

  it("loads plain KEY=VALUE pairs, skipping blanks and comments", () => {
    const applied = loadDotenv(envFile("# a comment\n\nIDW_T_A=1\nIDW_T_B = two \n"));
    expect(applied).toBe(2);
    expect(process.env.IDW_T_A).toBe("1");
    expect(process.env.IDW_T_B).toBe("two"); // trimmed
  });

  it("strips matching surrounding quotes and honors an 'export ' prefix", () => {
    loadDotenv(envFile(`IDW_T_QUOTED="a b c"\nexport IDW_T_EXPORT='x'\n`));
    expect(process.env.IDW_T_QUOTED).toBe("a b c");
    expect(process.env.IDW_T_EXPORT).toBe("x");
  });

  it("does not override an already-set variable (real env wins)", () => {
    process.env.IDW_T_WIN = "from-env";
    const applied = loadDotenv(envFile("IDW_T_WIN=from-file\nIDW_T_A=fresh\n"));
    expect(process.env.IDW_T_WIN).toBe("from-env");
    expect(process.env.IDW_T_A).toBe("fresh");
    expect(applied).toBe(1); // only the fresh one counted
  });
});
