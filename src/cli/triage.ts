/**
 * CLI command: offline AI-triage hook (by design — a hook, not a runtime
 * dependency).
 *
 * Reads the CTRF report, assembles a structured triage context for each failed
 * test (message + cross-system dump), and EITHER:
 *   - if ANTHROPIC_API_KEY is set: asks Claude for a concise root-cause summary,
 *   - otherwise: writes the assembled context to <reportsDir>/triage-input.json.
 *
 * Never runs on the test/runtime path — invoked manually (or a separate CI step)
 * after a run, so the deterministic check stays GenAI-free.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig } from "../config.ts";

interface CtrfTest {
  name: string;
  status: string;
  message?: string;
  trace?: string;
}

interface TriageItem {
  name: string;
  message: string;
  dumpDir: string | null;
  dump: Record<string, unknown>;
}

const TRIAGE_MODEL = process.env.TRIAGE_MODEL ?? "claude-sonnet-4-6";

/** Pull a dump directory path out of our concise failure message, if present. */
function dumpDirFromMessage(message: string): string | null {
  return message.match(/cross-system dump:\s*(\S+)/)?.[1] ?? null;
}

async function readDump(dir: string | null): Promise<Record<string, unknown>> {
  if (!dir) return {};
  const out: Record<string, unknown> = {};
  try {
    for (const file of await readdir(dir)) {
      if (file.endsWith(".json")) {
        out[file] = JSON.parse(await readFile(join(dir, file), "utf-8"));
      }
    }
  } catch {
    /* dump may have been cleaned — triage on the message alone */
  }
  return out;
}

function buildPrompt(items: TriageItem[]): string {
  return [
    "You are triaging failures of a midPoint deployment-config connected-test suite.",
    "These verify OUR configuration (inbound mappings, correlation, synchronization,",
    "policies) — not midPoint core. For each failed test, give: (1) the most likely",
    "root cause stated as a config/data hypothesis, (2) the single most informative",
    "next check, (3) confidence (low/med/high). Be concise. Do not invent fixes you",
    "cannot support from the evidence.",
    "",
    "Failed tests (JSON):",
    JSON.stringify(items, null, 2),
  ].join("\n");
}

async function summarizeWithClaude(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: TRIAGE_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export async function triage(ctrfPathArg?: string): Promise<void> {
  const reportsDir = loadConfig().reportsDir;
  const ctrfPath = resolve(process.cwd(), ctrfPathArg ?? join(reportsDir, "ctrf.json"));
  const ctrf = JSON.parse(await readFile(ctrfPath, "utf-8")) as {
    results?: { tests?: CtrfTest[] };
  };
  const failed = (ctrf.results?.tests ?? []).filter((t) => t.status === "failed");

  if (failed.length === 0) {
    console.log("No failed tests in CTRF report — nothing to triage.");
    return;
  }

  const items: TriageItem[] = [];
  for (const t of failed) {
    const message = t.message ?? t.trace ?? "";
    const dumpDir = dumpDirFromMessage(message);
    items.push({ name: t.name, message, dumpDir, dump: await readDump(dumpDir) });
  }

  const prompt = buildPrompt(items);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    const out = resolve(process.cwd(), join(reportsDir, "triage-input.json"));
    await writeFile(out, JSON.stringify({ model: TRIAGE_MODEL, items }, null, 2), "utf-8");
    console.log(
      `ANTHROPIC_API_KEY not set — wrote triage context for ${failed.length} failed test(s) to:\n  ${out}\n` +
        `Set ANTHROPIC_API_KEY to have Claude (${TRIAGE_MODEL}) summarize root causes.`,
    );
    return;
  }

  console.log(`Triaging ${failed.length} failed test(s) with ${TRIAGE_MODEL}...\n`);
  console.log(await summarizeWithClaude(prompt, apiKey));
}
