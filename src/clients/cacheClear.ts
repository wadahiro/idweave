/**
 * Clear ALL midPoint caches (cluster-wide) over admin REST — the same action as the
 * GUI "Clear caches" button (`CacheDispatcher.dispatchInvalidation(null,null,true,null)`),
 * reached via the `executeScript` RPC so NO node secret is needed.
 *
 * Why: a near-non-stop snapshot-restore rolls the repository DB back WITHOUT restarting
 * midPoint, so its in-memory RepositoryCache (global object/version/query caches,
 * ON by default) can serve STALE data for up to its version-check/TTL window
 * (~10–60s) — nothing invalidates on an out-of-band DB change. A near-non-stop
 * restore also has to quiesce running tasks, then synchronize the Quartz job store
 * before resuming the scheduler. A full-restart restore reboots midPoint, so none
 * of these in-memory repairs are needed there.
 *
 * The clear reaches midPoint-internal beans via Groovy (unsandboxed by default), so
 * it is midPoint- AND version-specific. The shared TaskManager API is present in
 * 4.0, 4.4, 4.8, and 4.10; the Spring context holder is selected per major below.
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

/** Wrap a Groovy body in the version-correct executeScript payload. */
function script(version: string, code: string): string {
  return `<s:executeScript xmlns:s="http://midpoint.evolveum.com/xml/ns/public/model/scripting-3"
                 xmlns:c="http://midpoint.evolveum.com/xml/ns/public/common/common-3"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <s:action>
    <s:type>execute-script</s:type>
    <s:parameter>
      <s:name>script</s:name>
      <c:value xsi:type="c:ScriptExpressionEvaluatorType">
        <c:code>
          ${code}
        </c:code>
      </c:value>
    </s:parameter>
    <s:parameter><s:name>forWholeInput</s:name><c:value>true</c:value></s:parameter>
  </s:action>
</s:executeScript>`;
}

/** The version-correct `executeScript` payload that clears all caches. */
export function clearCacheScript(version: string): string {
  // Get the CacheDispatcher bean by TYPE (its bean name is `cacheDispatcherImpl`, so
  // the name-derived lookup misses) and invalidate everything cluster-wide.
  const holder = contextHolderClass(version);
  return script(version, `${holder}
            .getApplicationContext()
            .getBean(com.evolveum.midpoint.repo.api.CacheDispatcher.class)
            .dispatchInvalidation(null, null, true, null)
          return 'caches cleared'`);
}

/**
 * Stop the local Quartz scheduler and its running tasks before an out-of-band
 * repository rollback. The wait is deliberately bounded: a restore must not
 * freeze forever behind a task that cannot stop cleanly.
 */
export function quiesceMidpointTasksScript(version: string, timeoutMs = 60_000): string {
  const holder = contextHolderClass(version);
  return script(version, `def taskManager = ${holder}
            .getApplicationContext()
            .getBean(com.evolveum.midpoint.task.api.TaskManager.class)
          def result = new com.evolveum.midpoint.schema.result.OperationResult('idweave.snapshot.quiesce')
          def stopped = taskManager.stopSchedulersAndTasks([taskManager.getNodeId()], ${timeoutMs}L, result)
          result.computeStatusIfUnknown()
          if (!stopped || !result.isSuccess()) {
            throw new IllegalStateException('Could not stop all midPoint tasks before snapshot restore: ' + result)
          }
          return 'tasks quiesced'`);
}

/**
 * Reconcile Quartz with the rolled-back repository, then resume the local
 * scheduler. `synchronizeTasks` removes jobs created after the snapshot and
 * recreates/updates triggers for tasks that exist in the restored repository.
 */
export function restoreMidpointTasksScript(version: string): string {
  const holder = contextHolderClass(version);
  return script(version, `${holder}
            .getApplicationContext()
            .getBean(com.evolveum.midpoint.repo.api.CacheDispatcher.class)
            .dispatchInvalidation(null, null, true, null)
          def taskManager = ${holder}
            .getApplicationContext()
            .getBean(com.evolveum.midpoint.task.api.TaskManager.class)
          def result = new com.evolveum.midpoint.schema.result.OperationResult('idweave.snapshot.restore-tasks')
          taskManager.synchronizeTasks(result)
          result.computeStatusIfUnknown()
          if (!result.isSuccess()) {
            throw new IllegalStateException('Could not synchronize midPoint tasks after snapshot restore: ' + result)
          }
          taskManager.startLocalScheduler(result)
          result.computeStatusIfUnknown()
          if (!result.isSuccess()) {
            throw new IllegalStateException('Could not start the midPoint scheduler after snapshot restore: ' + result)
          }
          return 'caches cleared; tasks synchronized; scheduler started'`);
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

/** Quiesce the local scheduler before a near-non-stop repository rollback. */
export async function quiesceMidpointTasks(conn: MidpointConfig, version: string, poll: PollConfig): Promise<void> {
  const rest = new MidpointRest(conn);
  const xml = quiesceMidpointTasksScript(version);
  await pollUntil(
    () => rest.executeScriptXml(xml).then(() => true).catch(() => false),
    (ok) => ok,
    poll,
    `midPoint task quiesce (${conn.baseUrl})`,
  );
}

/** Restore midPoint's cache and scheduler state after a near-non-stop rollback. */
export async function restoreMidpointTasks(conn: MidpointConfig, version: string, poll: PollConfig): Promise<void> {
  const rest = new MidpointRest(conn);
  const xml = restoreMidpointTasksScript(version);
  await pollUntil(
    () => rest.executeScriptXml(xml).then(() => true).catch(() => false),
    (ok) => ok,
    poll,
    `midPoint task synchronization (${conn.baseUrl})`,
  );
}
