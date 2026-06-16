/**
 * clients — SCIM 2.0 Service Provider client.
 *
 * The READ side (the assert target) fetches one resource by a SCIM filter
 * (`<filterAttr> eq "<id>"`); midPoint provisions OUTBOUND to a SCIM endpoint, so the
 * real end-state to verify lives in the Service Provider. The WRITE side lets idweave
 * DRIVE a SCIM endpoint directly (create/replace/delete) — the same arrange/CRUD role
 * the csv/ldap source adapters play, used by actions/scimSource.ts. Auth is EITHER a
 * bearer token OR HTTP Basic (see ScimSystemConfig); plain `fetch`, no dependency.
 */
import type { ScimSystemConfig } from "../scenario/suite.ts";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`env var ${name} is not set`);
  return v;
}

/** Authorization header from the configured credential (bearer token xor Basic). */
function authHeader(cfg: ScimSystemConfig): string {
  if (cfg.tokenEnv) return `Bearer ${requireEnv(cfg.tokenEnv)}`;
  if (cfg.username && cfg.passwordEnv) {
    return `Basic ${Buffer.from(`${cfg.username}:${requireEnv(cfg.passwordEnv)}`).toString("base64")}`;
  }
  throw new Error("SCIM system needs auth: set `tokenEnv` (bearer) or `username` + `passwordEnv` (Basic)");
}

/** Escape a value for a SCIM filter comparison string (a JSON string literal, RFC 7644). */
function escapeFilterValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Read the resource whose `filterAttr` (default `userName`) equals `identifier` from
 * a SCIM Service Provider. Returns the resource record, or null if absent. Throws on
 * duplicates (the filter is expected to be unique, like an account identifier).
 */
export async function readScimResource(
  cfg: ScimSystemConfig,
  identifier: string,
): Promise<Record<string, unknown> | null> {
  const resourceType = cfg.resourceType ?? "Users";
  const filterAttr = cfg.filterAttr ?? "userName";
  const filter = `${filterAttr} eq "${escapeFilterValue(identifier)}"`;
  const url = `${cfg.url.replace(/\/$/, "")}/${resourceType}?filter=${encodeURIComponent(filter)}`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader(cfg), Accept: "application/scim+json, application/json" },
  });
  if (!res.ok) throw new Error(`SCIM read failed (${res.status}) for ${filterAttr}="${identifier}" at ${cfg.url}`);
  const body = (await res.json()) as { Resources?: Array<Record<string, unknown>> };
  const resources = Array.isArray(body.Resources) ? body.Resources : [];
  if (resources.length === 0) return null;
  if (resources.length > 1) {
    throw new Error(`Expected at most one SCIM ${filterAttr}="${identifier}", found ${resources.length}`);
  }
  return resources[0]!;
}

/** The collection endpoint for a system's resource type (default Users). */
function resourceUrl(cfg: ScimSystemConfig): string {
  return `${cfg.url.replace(/\/$/, "")}/${cfg.resourceType ?? "Users"}`;
}

const SCIM_PATCH_OP = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

/** Common headers (auth + content negotiation) for a write request. */
function writeHeaders(cfg: ScimSystemConfig): Record<string, string> {
  return {
    Authorization: authHeader(cfg),
    "Content-Type": "application/scim+json",
    Accept: "application/scim+json, application/json",
  };
}

/** Every resource at the endpoint (paged through with startIndex/count). */
export async function listScimResources(cfg: ScimSystemConfig): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  const count = 100;
  for (let startIndex = 1; ; startIndex += count) {
    const url = `${resourceUrl(cfg)}?startIndex=${startIndex}&count=${count}`;
    const res = await fetch(url, { headers: { Authorization: authHeader(cfg), Accept: "application/scim+json, application/json" } });
    if (!res.ok) throw new Error(`SCIM list failed (${res.status}) at ${cfg.url}`);
    const body = (await res.json()) as { Resources?: Array<Record<string, unknown>> };
    const page = Array.isArray(body.Resources) ? body.Resources : [];
    out.push(...page);
    if (page.length < count) return out;
  }
}

/** Create a resource (POST). Throws on any non-2xx (incl. 409 on a duplicate). */
export async function createScimResource(cfg: ScimSystemConfig, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(resourceUrl(cfg), { method: "POST", headers: writeHeaders(cfg), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`SCIM create failed (${res.status}) at ${cfg.url}: ${await res.text().catch(() => "")}`);
}

/** Replace attributes of an existing resource by its server id (PATCH replace ops). */
export async function patchScimResource(
  cfg: ScimSystemConfig,
  id: string,
  operations: Array<{ op: string; path: string; value: unknown }>,
): Promise<void> {
  const body = { schemas: [SCIM_PATCH_OP], Operations: operations };
  const res = await fetch(`${resourceUrl(cfg)}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: writeHeaders(cfg),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SCIM patch failed (${res.status}) for id="${id}" at ${cfg.url}: ${await res.text().catch(() => "")}`);
}

/** Delete a resource by its server id. Idempotent: a 404 (already gone) is a no-op. */
export async function deleteScimResource(cfg: ScimSystemConfig, id: string): Promise<void> {
  const res = await fetch(`${resourceUrl(cfg)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: authHeader(cfg) },
  });
  if (!res.ok && res.status !== 404) throw new Error(`SCIM delete failed (${res.status}) for id="${id}" at ${cfg.url}`);
}
