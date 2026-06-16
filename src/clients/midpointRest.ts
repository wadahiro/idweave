/**
 * clients — midPoint REST protocol adapter (a plain module, no test logic).
 *
 * Thin wrappers over the midPoint REST API: object CRUD/search, task reads,
 * resource connection test, and import-from-resource. Higher layers compose
 * these into domain verbs (actions) and oracles (verify).
 */
import type { MidpointConfig } from "../config.ts";

/** A midPoint object as returned by REST (loosely typed; verify normalizes it). */
export type MidpointObject = Record<string, unknown>;

export class MidpointRestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "MidpointRestError";
  }
}

export class MidpointRest {
  private readonly base: string;
  private readonly authHeader: string;

  constructor(cfg: MidpointConfig) {
    this.base = `${cfg.baseUrl.replace(/\/$/, "")}/ws/rest`;
    this.authHeader =
      "Basic " + Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64");
  }

  private async request(
    method: string,
    path: string,
    opts: { body?: string; contentType?: string; accept?: string; redirect?: "manual" | "follow" } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: opts.accept ?? "application/json",
    };
    if (opts.contentType) headers["Content-Type"] = opts.contentType;
    return fetch(`${this.base}${path}`, {
      method,
      headers,
      body: opts.body,
      redirect: opts.redirect ?? "follow",
    });
  }

  private async json(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.request(method, path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      contentType: body === undefined ? undefined : "application/json",
    });
    const text = await res.text();
    if (!res.ok) {
      throw new MidpointRestError(`${method} ${path} -> ${res.status}`, res.status, text);
    }
    return text ? JSON.parse(text) : undefined;
  }

  // --- reads ---------------------------------------------------------------

  /**
   * Retry a READ on a transient 5xx / network error. 4.0 (and 4.4) intermittently
   * 500 on a list/search (the Wicket SearchPanel NPE) and occasionally on a task
   * GET; reads are idempotent, so retrying is safe — mutations are NOT wrapped. A
   * 4xx is a real answer (e.g. 404) and is not retried.
   */
  private async retryRead<T>(what: string, fn: () => Promise<T>): Promise<T> {
    let last: unknown;
    for (let i = 0; i < 4; i++) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof MidpointRestError && e.status < 500) throw e;
        last = e;
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
    throw last instanceof Error ? last : new Error(`read failed after retries: ${what}`);
  }

  /** GET an object by type+oid, returning the inner object (or null on 404). */
  async getObject(type: string, oid: string, raw = false): Promise<MidpointObject | null> {
    return this.retryRead(`GET /${type}/${oid}`, async () => {
      const res = await this.request("GET", `/${type}/${oid}${raw ? "?options=raw" : ""}`);
      if (res.status === 404) return null;
      const text = await res.text();
      if (!res.ok) {
        throw new MidpointRestError(`GET /${type}/${oid} -> ${res.status}`, res.status, text);
      }
      return unwrapSingle(JSON.parse(text));
    });
  }

  getUser(oid: string): Promise<MidpointObject | null> {
    return this.getObject("users", oid);
  }

  getShadow(oid: string): Promise<MidpointObject | null> {
    return this.getObject("shadows", oid);
  }

  getTask(oid: string, raw = true): Promise<MidpointObject | null> {
    return this.getObject("tasks", oid, raw);
  }

  /** Search objects of a type by a single property equality. */
  async searchByName(type: string, name: string): Promise<MidpointObject[]> {
    const query = { query: { filter: { equal: { path: "name", value: name } } } };
    const result = await this.retryRead(`POST /${type}/search`, () => this.json("POST", `/${type}/search`, query));
    return unwrapList(result);
  }

  /**
   * Raw search for every shadow whose name (the resource object's DN/identifier)
   * CONTAINS `value`. Finds orphan/tombstone shadows BY IDENTIFIER — including ones
   * no focus linkRef references anymore — so a reset can purge them before the next
   * reconciliation (the focus-scoped cleanup in cleanup.ts cannot reach an unlinked
   * shadow). Raw, so it returns repository tombstones too.
   */
  async searchShadowsByNameSubstring(value: string): Promise<MidpointObject[]> {
    const query = { query: { filter: { substring: { path: "name", value, anchorStart: false } } } };
    const result = await this.retryRead("POST /shadows/search?options=raw", () =>
      this.json("POST", "/shadows/search?options=raw", query));
    return unwrapList(result);
  }

  /** List all objects of a type (single page; raise `maxSize` if a type can exceed it). */
  async listObjects(type: string, maxSize = 5000): Promise<MidpointObject[]> {
    const query = { query: { paging: { maxSize } } };
    const result = await this.retryRead(`POST /${type}/search`, () => this.json("POST", `/${type}/search`, query));
    return unwrapList(result);
  }

  // --- writes / actions ----------------------------------------------------

  /** Add-or-replace an object from raw XML at a fixed oid (idempotent import). */
  async putObjectXml(type: string, oid: string, xml: string): Promise<void> {
    const res = await this.request("PUT", `/${type}/${oid}?options=overwrite`, {
      body: xml,
      contentType: "application/xml",
    });
    const text = await res.text();
    if (!res.ok) {
      throw new MidpointRestError(`PUT /${type}/${oid} -> ${res.status}`, res.status, text);
    }
  }

  /**
   * Create a NEW object (POST /{type}); returns its generated oid (from the
   * `Location` header). `payload` is the JSON body midPoint expects — the object
   * wrapped under its singular key, e.g. `{ org: { name, subtype, assignment } }`.
   * Unlike `putObjectXml` (fixed-oid overwrite), this lets midPoint allocate the
   * oid and run the full model add (object template, auto-assignment, etc.).
   */
  async addObject(type: string, payload: MidpointObject): Promise<string> {
    const res = await this.request("POST", `/${type}`, {
      body: JSON.stringify(payload),
      contentType: "application/json",
      redirect: "manual",
    });
    if (!res.ok && res.status !== 201) {
      const text = await res.text();
      throw new MidpointRestError(`POST /${type} -> ${res.status}`, res.status, text);
    }
    const loc = res.headers.get("location");
    const oid = loc?.split(`/${type}/`)[1]?.split(/[?#]/)[0];
    if (!oid) {
      throw new MidpointRestError(`add ${type} did not return an oid (Location: ${loc})`, res.status, loc ?? "");
    }
    return oid;
  }

  /**
   * Execute a bulk-action / scripting object (root `<executeScript>`) via the RPC
   * endpoint. Used for config that isn't a plain object PUT — e.g. an idempotent
   * systemConfiguration delta. A 200 with a fatal_error operation result still
   * means the script failed, so check the body too.
   */
  async executeScriptXml(xml: string): Promise<void> {
    const res = await this.request("POST", `/rpc/executeScript`, {
      body: xml,
      contentType: "application/xml",
    });
    const text = await res.text();
    if (!res.ok || /fatal_error/i.test(text)) {
      throw new MidpointRestError(`executeScript -> ${res.status}`, res.status, text);
    }
  }

  /**
   * Execute a bulk-action script and RETURN its pipeline output — the values the
   * Groovy `return`ed, as strings (the `dataOutput.item[].value.@value`). A script that
   * returns a JSON string yields one string to JSON-parse; a List<String> yields one
   * per item. Used by the connector-mediated `resource` target to read/CRUD a target
   * object through midPoint without persisting a shadow (the script calls the
   * provisioning ResourceObjectConverter and returns the result as JSON). Throws on a
   * fatal/partial error status (parsing the error body defensively — midPoint may emit
   * raw control chars in a stack-trace message).
   */
  async executeScriptOutput(xml: string): Promise<string[]> {
    const res = await this.request("POST", `/rpc/executeScript`, { body: xml, contentType: "application/xml" });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new MidpointRestError(`executeScript -> ${res.status} (unparseable response)`, res.status, text.slice(0, 2000));
    }
    const obj = (parsed as { object?: Record<string, unknown> })?.object ?? {};
    const status = (obj.result as { status?: string } | undefined)?.status;
    if (!res.ok || (status && /fatal_error|partial_error/i.test(status))) {
      const msg = (obj.result as { message?: string } | undefined)?.message ?? "";
      throw new MidpointRestError(`executeScript -> ${res.status} ${status ?? ""}: ${msg}`, res.status, text.slice(0, 2000));
    }
    const items = (obj.output as { dataOutput?: { item?: unknown } } | undefined)?.dataOutput?.item;
    const arr = Array.isArray(items) ? items : items != null ? [items] : [];
    // The item value is `{ @type, @value }` (4.4/4.8/4.10) or a plain string (4.0).
    return arr
      .map((it) => {
        const v = (it as { value?: unknown })?.value;
        return typeof v === "string" ? v : (v as { "@value"?: unknown } | undefined)?.["@value"];
      })
      .filter((v): v is string => v != null)
      .map(String);
  }

  /**
   * Delete an object. `raw` deletes only the repository object (no
   * provisioning / no operation-policy enforcement) — used by test reset so a
   * protected source shadow can be cleared without writing back to the source.
   */
  async deleteObject(type: string, oid: string, raw = false): Promise<void> {
    const res = await this.request("DELETE", `/${type}/${oid}${raw ? "?options=raw" : ""}`);
    if (res.status === 404) return;
    if (!res.ok) {
      const text = await res.text();
      throw new MidpointRestError(`DELETE /${type}/${oid} -> ${res.status}`, res.status, text);
    }
  }

  /**
   * Modify an object via REST (PATCH with an ObjectModificationType). Runs the
   * model (provisioning included), unlike a raw repo write.
   *
   * `raw` adds `?options=raw`: a direct repository write that SKIPS model
   * processing — no recompute, no outbound provisioning, and operational/protected
   * items (e.g. metadata timestamps, a shadow's naming attribute) become writable.
   * Time-control preconditions use it to seed a past date WITHOUT the write itself
   * recomputing the effect, so the scanner task under test is what actually acts.
   */
  async modifyObject(
    type: string,
    oid: string,
    itemDelta: Array<{ modificationType: string; path: string; value?: unknown }>,
    opts: { raw?: boolean } = {},
  ): Promise<void> {
    const res = await this.request("PATCH", `/${type}/${oid}${opts.raw ? "?options=raw" : ""}`, {
      body: JSON.stringify({ objectModification: { itemDelta } }),
      contentType: "application/json",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new MidpointRestError(`PATCH /${type}/${oid} -> ${res.status}`, res.status, text);
    }
  }

  /** Run a resource connection test; returns the operation-result status. */
  async testResource(oid: string): Promise<string> {
    const result = (await this.json("POST", `/resources/${oid}/test`)) as MidpointObject;
    return topStatus(result);
  }

  /**
   * Trigger an import-from-resource for the given object class. midPoint
   * answers 303 with the created task in the Location header; we return its oid.
   */
  async importFromResource(oid: string, objectClass: string): Promise<string> {
    const res = await this.request("POST", `/resources/${oid}/import/${objectClass}`, {
      redirect: "manual",
    });
    if (res.status !== 303 && res.status !== 200 && res.status !== 201 && res.status !== 202) {
      const text = await res.text();
      throw new MidpointRestError(
        `import ${oid}/${objectClass} -> ${res.status}`,
        res.status,
        text,
      );
    }
    const loc = res.headers.get("location");
    const taskOid = loc?.split("/tasks/")[1]?.split(/[?#]/)[0];
    if (!taskOid) {
      throw new MidpointRestError(
        `import did not return a task oid (Location: ${loc})`,
        res.status,
        loc ?? "",
      );
    }
    return taskOid;
  }

  /** Run a registered task now (POST /tasks/{oid}/run). */
  async runTask(oid: string): Promise<void> {
    const res = await this.request("POST", `/tasks/${oid}/run`);
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new MidpointRestError(`run task ${oid} -> ${res.status}`, res.status, text);
    }
  }

  /** Resume a suspended task (POST /tasks/{oid}/resume) — makes it run. */
  async resumeTask(oid: string): Promise<void> {
    const res = await this.request("POST", `/tasks/${oid}/resume`);
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new MidpointRestError(`resume task ${oid} -> ${res.status}`, res.status, text);
    }
  }

  /**
   * Suspend a task (POST /tasks/{oid}/suspend) — parks a recurring scanner so it
   * does NOT auto-fire while a time-control scenario rewinds its lastScanTimestamp
   * and seeds a past date. A later runRegisteredTask resumes it (which runs it).
   */
  async suspendTask(oid: string): Promise<void> {
    const res = await this.request("POST", `/tasks/${oid}/suspend`);
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new MidpointRestError(`suspend task ${oid} -> ${res.status}`, res.status, text);
    }
  }
}

// --- response shape helpers -------------------------------------------------

/** GET returns `{ "<type>": { ...object } }`; unwrap to the object. */
function unwrapSingle(payload: unknown): MidpointObject {
  if (payload && typeof payload === "object") {
    // midPoint 4.0 wraps a single object as {"@ns": "...", "<type>": {...}};
    // 4.4+ omits the "@ns" sibling. Ignore "@ns" so the type wrapper is still
    // recognized as the single key and unwrapped.
    const keys = Object.keys(payload as object).filter((k) => k !== "@ns");
    if (keys.length === 1) {
      const inner = (payload as Record<string, unknown>)[keys[0]!];
      if (inner && typeof inner === "object") return inner as MidpointObject;
    }
  }
  return payload as MidpointObject;
}

/** Search returns a nested ObjectListType; flatten to an array of objects. */
function unwrapList(payload: unknown): MidpointObject[] {
  const obj = (payload as Record<string, unknown> | undefined)?.["object"] as
    | Record<string, unknown>
    | undefined;
  const inner = obj?.["object"];
  if (Array.isArray(inner)) return inner as MidpointObject[];
  if (inner && typeof inner === "object") return [inner as MidpointObject];
  return [];
}

/** Extract the top-level operationResult status from a REST result wrapper. */
function topStatus(result: MidpointObject): string {
  const r = result as Record<string, unknown>;
  const opResult = (r["operationResult"] ?? r["result"] ?? r) as Record<string, unknown>;
  return String(opResult["status"] ?? "unknown");
}
