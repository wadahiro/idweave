/**
 * Clear ALL midPoint caches (cluster-wide) over admin REST — the same action as the
 * GUI "Clear caches" button (`CacheDispatcher.dispatchInvalidation(null,null,true,null)`),
 * reached via the `executeScript` RPC so NO node secret is needed.
 *
 * Why: a near-non-stop snapshot-restore rolls the repository DB back WITHOUT restarting
 * midPoint, so its in-memory RepositoryCache (global object/version/query caches,
 * ON by default) can serve STALE data for up to its version-check/TTL window
 * (~10–60s) — nothing invalidates on an out-of-band DB change (verified against the
 * 4.10 source). Clearing after the restore removes that window. A full-restart
 * restore reboots midPoint, so this is a harmless no-op there.
 *
 * The clear reaches midPoint-internal beans via Groovy (unsandboxed by default), so
 * it is midPoint- AND version-specific — `clearCacheScript(version)` is the place to
 * branch the payload per major version (the 4.x payload below is verified on 4.10).
 */
import { MidpointRest } from "./midpointRest.ts";
import { pollUntil } from "../poll.ts";
import type { MidpointConfig, PollConfig } from "../config.ts";

/**
 * `SpringApplicationContextHolder` (our handle to the Spring context, to fetch the
 * CacheDispatcher bean) MOVED packages across midPoint majors — verified by
 * inspecting each image's jars: 4.0/4.4 = `wf.impl.processes.common`, 4.8/4.10 =
 * `model.impl.expr`. (`CacheDispatcher.dispatchInvalidation(Class,String,boolean,
 * CacheInvalidationContext)` itself is identical across all four.)
 */
function contextHolderClass(version: string): string {
  const major = version.split(".").slice(0, 2).join(".");
  return major === "4.0" || major === "4.4"
    ? "com.evolveum.midpoint.wf.impl.processes.common.SpringApplicationContextHolder"
    : "com.evolveum.midpoint.model.impl.expr.SpringApplicationContextHolder";
}

/** The version-correct `executeScript` payload that clears all caches. */
function clearCacheScript(version: string): string {
  // Get the CacheDispatcher bean by TYPE (its bean name is `cacheDispatcherImpl`, so
  // the name-derived lookup misses) and invalidate everything cluster-wide.
  const holder = contextHolderClass(version);
  return `<s:executeScript xmlns:s="http://midpoint.evolveum.com/xml/ns/public/model/scripting-3"
                 xmlns:c="http://midpoint.evolveum.com/xml/ns/public/common/common-3"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <s:action>
    <s:type>execute-script</s:type>
    <s:parameter>
      <s:name>script</s:name>
      <c:value xsi:type="c:ScriptExpressionEvaluatorType">
        <c:code>
          ${holder}
            .getApplicationContext()
            .getBean(com.evolveum.midpoint.repo.api.CacheDispatcher.class)
            .dispatchInvalidation(null, null, true, null)
          return 'caches cleared'
        </c:code>
      </c:value>
    </s:parameter>
    <s:parameter><s:name>forWholeInput</s:name><c:value>true</c:value></s:parameter>
  </s:action>
</s:executeScript>`;
}

/**
 * Invalidate all caches of one midPoint instance. Right after a near-non-stop
 * unpause the JDBC pool may still be re-establishing, so retry (bounded poll, no
 * sleep) until the script succeeds or the deadline passes.
 */
export async function clearMidpointCache(conn: MidpointConfig, version: string, poll: PollConfig): Promise<void> {
  const rest = new MidpointRest(conn);
  const xml = clearCacheScript(version);
  await pollUntil(
    () => rest.executeScriptXml(xml).then(() => true).catch(() => false),
    (ok) => ok,
    poll,
    `midPoint cache clear (${conn.baseUrl})`,
  );
}
