/**
 * verify — a focus's LIVE projections (shadows) check.
 *
 * Reads which resources a midPoint user is currently provisioned on — the set of
 * its NON-dead shadows, each as {resource, kind, intent} (the resource by NAME,
 * not oid). So a scenario can assert WHAT got provisioned (e.g. a client-cert
 * user gains the cert resource's shadow) without touching volatile per-shadow
 * data (oid, dn, the cert's random fingerprint). Dead shadows are excluded: only
 * live links count as "provisioned".
 */
import type { MidpointRest, MidpointObject } from "../clients/midpointRest.ts";

export interface ProjectionRef {
  resource: string;
  kind: string;
  intent: string;
}

function asArray<T>(v: unknown): T[] {
  return v == null ? [] : Array.isArray(v) ? (v as T[]) : [v as T];
}

/** A midPoint polystring is `"x"` or `{ orig, norm }` in REST JSON. */
function polyName(name: unknown): string {
  if (name && typeof name === "object" && "orig" in (name as Record<string, unknown>)) {
    return String((name as { orig: unknown }).orig);
  }
  return String(name ?? "");
}

/**
 * The user's live projections as a sorted (order-insensitive) set of
 * {resource, kind, intent}. Returns null if the focus is absent.
 */
export async function readLiveProjections(rest: MidpointRest, focusName: string): Promise<ProjectionRef[] | null> {
  const [user] = await rest.searchByName("users", focusName);
  if (!user) return null;
  const links = asArray<{ oid?: string }>(user.linkRef);
  const resourceNames = new Map<string, string>();
  const out: ProjectionRef[] = [];
  for (const link of links) {
    const oid = link?.oid;
    if (!oid) continue;
    const shadow = await rest.getShadow(oid);
    if (!shadow || shadow.dead === true || shadow.dead === "true") continue; // live only
    const roid = (shadow.resourceRef as { oid?: string } | undefined)?.oid;
    let rname = roid ? resourceNames.get(roid) : undefined;
    if (rname === undefined) {
      const res: MidpointObject | null = roid ? await rest.getObject("resources", roid) : null;
      rname = res ? polyName(res.name) : (roid ?? "?");
      if (roid) resourceNames.set(roid, rname);
    }
    out.push({ resource: rname, kind: String(shadow.kind ?? "account"), intent: String(shadow.intent ?? "default") });
  }
  out.sort((a, b) => `${a.resource}|${a.kind}|${a.intent}`.localeCompare(`${b.resource}|${b.kind}|${b.intent}`));
  return out;
}
