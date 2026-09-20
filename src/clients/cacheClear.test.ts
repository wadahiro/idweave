import { describe, expect, it } from "vitest";
import {
  clearCacheScript,
  quiesceMidpointTasksScript,
  restoreMidpointTasksScript,
} from "./cacheClear.ts";

describe("midPoint restore scripts", () => {
  it.each([
    ["4.0", "com.evolveum.midpoint.wf.impl.processes.common.SpringApplicationContextHolder"],
    ["4.4", "com.evolveum.midpoint.wf.impl.processes.common.SpringApplicationContextHolder"],
    ["4.8", "com.evolveum.midpoint.model.impl.expr.SpringApplicationContextHolder"],
    ["4.10", "com.evolveum.midpoint.model.impl.expr.SpringApplicationContextHolder"],
  ])("uses the correct Spring holder for midPoint %s", (version, holder) => {
    expect(clearCacheScript(version)).toContain(holder);
    expect(quiesceMidpointTasksScript(version)).toContain(holder);
    expect(restoreMidpointTasksScript(version)).toContain(holder);
  });

  it("stops the scheduler and waits for running tasks before rollback", () => {
    const xml = quiesceMidpointTasksScript("4.10", 12_345);
    expect(xml).toContain("getBean(com.evolveum.midpoint.task.api.TaskManager.class)");
    expect(xml).toContain("stopSchedulersAndTasks([taskManager.getNodeId()], 12345L, result)");
    expect(xml).toContain("Could not stop all midPoint tasks before snapshot restore");
  });

  it("clears caches, synchronizes Quartz, then starts the scheduler", () => {
    const xml = restoreMidpointTasksScript("4.10");
    const clear = xml.indexOf("dispatchInvalidation");
    const synchronize = xml.indexOf("synchronizeTasks(result)");
    const start = xml.indexOf("startLocalScheduler(result)");
    expect(clear).toBeGreaterThan(-1);
    expect(synchronize).toBeGreaterThan(clear);
    expect(start).toBeGreaterThan(synchronize);
  });
});
