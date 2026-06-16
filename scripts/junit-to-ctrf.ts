/**
 * vitest has no CTRF reporter, but emits JUnit (--reporter=junit). This converts
 * that JUnit XML into the same CTRF JSON shape the harness already consumes
 * (results.{tool,summary,tests}), closing the only reporter gap.
 * Usage: tsx scripts/junit-to-ctrf.ts <junit.xml> <ctrf.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) throw new Error("usage: junit-to-ctrf <junit.xml> <ctrf.json>");

const xml = readFileSync(inPath, "utf-8");
const attr = (s: string, k: string): string => new RegExp(`${k}="([^"]*)"`).exec(s)?.[1] ?? "";

// Each <testcase .../> (self-closing) or <testcase ...>...</testcase> (failure body).
const tests = [...xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)].map((m) => {
  const a = m[1]!;
  const failed = /<failure\b/.test(m[3] ?? "") || attr(a, "failures") === "1";
  return {
    name: attr(a, "name"),
    duration: Math.round(parseFloat(attr(a, "time") || "0") * 1000),
    status: failed ? "failed" : "passed",
    filePath: attr(a, "file"),
  };
});

const passed = tests.filter((t) => t.status === "passed").length;
const ctrf = {
  results: {
    tool: { name: "vitest" },
    summary: {
      tests: tests.length,
      passed,
      failed: tests.length - passed,
      pending: 0,
      skipped: 0,
      other: 0,
      start: 0,
      stop: 0,
    },
    tests,
  },
};
writeFileSync(outPath, JSON.stringify(ctrf, null, 2));
console.log(`wrote ${outPath}: ${tests.length} tests, ${passed} passed`);
