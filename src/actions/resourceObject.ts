/**
 * actions — connector-mediated resource object READ.
 *
 * Read a target object THROUGH midPoint's connector via a Groovy `executeScript` that
 * calls `ResourceObjectConverter` (the provisioning layer that uses the resource's
 * stored connector config but writes NO shadow — see clients/resourceObjectScript.ts).
 * So a target idweave has no native client for — any system midPoint connects to,
 * including a proprietary connector — can be asserted with ZERO side effect on midPoint
 * (no shadow), making it a sound oracle. v1 drives the suite's primary midPoint (the
 * injected `rest`); ARRANGE (create/set/delete) is a later increment.
 */
import type { MidpointRest } from "../clients/midpointRest.ts";
import type { ResourceSystemConfig } from "../scenario/suite.ts";
import {
  buildResourceReadScript,
  buildResourceListScript,
  buildResourceCreateScript,
  buildResourceModifyScript,
  buildResourceDeleteScript,
  ABSENT_MARKER,
  NOT_FOUND_MARKER,
} from "../clients/resourceObjectScript.ts";

const toArr = (v: string | string[]): string[] => (Array.isArray(v) ? v : [v]);
const normMap = (m: Record<string, string | string[]>): Record<string, string[]> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, toArr(v)]));

/** Resolve the resource system's target resource OID (from `oid`, else by `name`). */
export async function resolveResourceOid(rest: MidpointRest, cfg: ResourceSystemConfig): Promise<string> {
  if (cfg.oid) return cfg.oid;
  if (!cfg.name) throw new Error("resource system needs `name` or `oid`");
  const found = await rest.searchByName("resources", cfg.name);
  if (found.length === 0) throw new Error(`resource "${cfg.name}" not found`);
  return String(found[0]!.oid);
}

/**
 * Read the resource object whose identifier attribute equals `identifier` from the
 * target, through the connector (no shadow persisted). Returns its attributes as a
 * record (`{ attr: [values] }`), or null if no object matches. `version` selects the
 * version-correct script (the internal provisioning API differs per major).
 */
export async function readResourceObject(
  rest: MidpointRest,
  version: string,
  cfg: ResourceSystemConfig,
  identifier: string,
): Promise<Record<string, unknown> | null> {
  const resourceOid = await resolveResourceOid(rest, cfg);
  const xml = buildResourceReadScript({
    version,
    resourceOid,
    objectClass: cfg.objectClass,
    identifierAttr: cfg.identifierAttr ?? "name",
    identifier,
  });
  const out = await rest.executeScriptOutput(xml);
  const value = out[0];
  if (value === undefined || value === ABSENT_MARKER) return null;
  return JSON.parse(value) as Record<string, unknown>;
}

/**
 * List EVERY object of the resource system's object class on the target, through the
 * connector (no shadow). Each is its attribute record (`{ attr: [values] }`).
 */
export async function readAllResourceObjects(
  rest: MidpointRest,
  version: string,
  cfg: ResourceSystemConfig,
): Promise<Array<Record<string, unknown>>> {
  const resourceOid = await resolveResourceOid(rest, cfg);
  const xml = buildResourceListScript({ version, resourceOid, objectClass: cfg.objectClass });
  const out = await rest.executeScriptOutput(xml);
  const value = out[0];
  return value === undefined ? [] : (JSON.parse(value) as Array<Record<string, unknown>>);
}

/** Create an object ON THE TARGET through the connector (no shadow persisted). */
export async function createResourceObject(
  rest: MidpointRest,
  version: string,
  cfg: ResourceSystemConfig,
  attributes: Record<string, string | string[]>,
): Promise<void> {
  const resourceOid = await resolveResourceOid(rest, cfg);
  const xml = buildResourceCreateScript({ version, resourceOid, objectClass: cfg.objectClass, attributes: normMap(attributes) });
  const out = await rest.executeScriptOutput(xml);
  if (out[0] !== "CREATED") throw new Error(`create-resource-object failed: ${out[0] ?? "(no output)"}`);
}

/**
 * Replace attribute values on the target object addressed by `identifier` (an empty
 * array CLEARS the attribute) — through the connector, no shadow. Used by both
 * set-resource-object (values) and clear-resource-object (empty).
 */
export async function setResourceObjectAttrs(
  rest: MidpointRest,
  version: string,
  cfg: ResourceSystemConfig,
  identifier: string,
  replaces: Record<string, string[]>,
): Promise<void> {
  const resourceOid = await resolveResourceOid(rest, cfg);
  const xml = buildResourceModifyScript({
    version,
    resourceOid,
    objectClass: cfg.objectClass,
    identifierAttr: cfg.identifierAttr ?? "name",
    identifier,
    replaces,
  });
  const out = await rest.executeScriptOutput(xml);
  if (out[0] === NOT_FOUND_MARKER) throw new Error(`resource object "${identifier}" not found on the target`);
  if (out[0] !== "MODIFIED") throw new Error(`set/clear-resource-object failed: ${out[0] ?? "(no output)"}`);
}

/** Delete the target object addressed by `identifier` through the connector. NOT_FOUND is a no-op (idempotent). */
export async function deleteResourceObject(
  rest: MidpointRest,
  version: string,
  cfg: ResourceSystemConfig,
  identifier: string,
): Promise<void> {
  const resourceOid = await resolveResourceOid(rest, cfg);
  const xml = buildResourceDeleteScript({
    version,
    resourceOid,
    objectClass: cfg.objectClass,
    identifierAttr: cfg.identifierAttr ?? "name",
    identifier,
  });
  const out = await rest.executeScriptOutput(xml);
  if (out[0] !== "DELETED" && out[0] !== NOT_FOUND_MARKER) {
    throw new Error(`delete-resource-object failed: ${out[0] ?? "(no output)"}`);
  }
}
