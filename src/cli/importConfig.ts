/**
 * CLI command: import our midPoint config objects via REST.
 *
 * Idempotent (fixed OIDs + overwrite). Offline orchestration — the outer
 * orchestrator (make/CI) calls it once after the stack is ready, OUTSIDE the
 * test runtime path.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig } from "../config.ts";
import { MidpointRest } from "../clients/midpointRest.ts";

/** Map a config XML root element to its REST collection + extract the oid. */
function parseObject(xml: string): { type: string; oid: string } {
  // Strip XML comments first: a leading <!-- … --> that mentions element names
  // (e.g. documenting a schema difference) must not be mistaken for the root
  // element or carry a stray oid.
  const body = xml.replace(/<!--[\s\S]*?-->/g, "");
  const root = body.match(/<([a-zA-Z][\w-]*)[\s>]/);
  const rootEl = root?.[1];
  const oid = body.match(/\boid="([0-9a-fA-F-]{36})"/)?.[1];
  if (!rootEl || !oid) {
    throw new Error(`Could not determine root element / oid from config XML`);
  }
  const TYPES: Record<string, string> = {
    resource: "resources",
    role: "roles",
    org: "orgs",
    task: "tasks",
    objectTemplate: "objectTemplates",
    archetype: "archetypes",
    systemConfiguration: "systemConfigurations",
  };
  const type = TYPES[rootEl];
  if (!type) throw new Error(`Unsupported config root element <${rootEl}>`);
  return { type, oid };
}

export async function importConfig(dirArg?: string): Promise<void> {
  const cfg = loadConfig();
  const rest = new MidpointRest(cfg.midpoint);
  const dir = resolve(process.cwd(), dirArg ?? cfg.configDir);

  const files = (await readdir(dir)).filter((f) => f.endsWith(".xml")).sort();
  if (files.length === 0) {
    console.log(`No config XML found in ${dir}`);
    return;
  }
  for (const file of files) {
    const xml = await readFile(join(dir, file), "utf-8");
    // A bulk-action / scripting object (root <executeScript>) isn't a plain
    // object — execute it via the RPC endpoint instead of a collection PUT. It's
    // expected to be idempotent (e.g. a systemConfiguration delta), so re-running
    // `import-config` is safe. midPoint's own post-init importer runs these at boot.
    const body = xml.replace(/<!--[\s\S]*?-->/g, "");
    if (/<(?:\w+:)?executeScript[\s>]/.test(body)) {
      await rest.executeScriptXml(xml);
      console.log(`executed ${file} (rpc/executeScript)`);
      continue;
    }
    const { type, oid } = parseObject(xml);
    await rest.putObjectXml(type, oid, xml);
    console.log(`imported ${file} -> ${type}/${oid}`);
  }
}
