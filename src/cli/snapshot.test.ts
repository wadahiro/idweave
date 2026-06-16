import { describe, expect, it } from "vitest";
import { resolveSnapshotMode, backendOf, planFromSources } from "./snapshot.ts";

describe("resolveSnapshotMode", () => {
  it("defaults to pause (no flag, no env)", () => {
    expect(resolveSnapshotMode([], undefined)).toBe("pause");
    expect(resolveSnapshotMode([], "")).toBe("pause");
  });

  it("honors SNAPSHOT_MODE (case-insensitive)", () => {
    expect(resolveSnapshotMode([], "stop")).toBe("stop");
    expect(resolveSnapshotMode([], "STOP")).toBe("stop");
    expect(resolveSnapshotMode([], "pause")).toBe("pause");
  });

  it("lets a CLI flag win over the env", () => {
    expect(resolveSnapshotMode(["snapshot-build", "--stop"], "pause")).toBe("stop");
    expect(resolveSnapshotMode(["snapshot-build", "--pause"], "stop")).toBe("pause");
  });

  it("rejects an invalid env value", () => {
    expect(() => resolveSnapshotMode([], "freeze")).toThrow(/pause.*stop/i);
  });
});

describe("backendOf", () => {
  it("accepts tar / btrfs (case-insensitive)", () => {
    expect(backendOf("tar")).toBe("tar");
    expect(backendOf("btrfs")).toBe("btrfs");
    expect(backendOf("BTRFS")).toBe("btrfs");
  });
  it("rejects anything else", () => {
    expect(() => backendOf("zfs")).toThrow(/tar.*btrfs/i);
    expect(() => backendOf("xfs")).toThrow(/tar.*btrfs/i);
  });
});

describe("planFromSources (near-non-stop restore plan)", () => {
  it("returns null when nothing names a service to stop → full reset", () => {
    expect(planFromSources([], [])).toBeNull();
    expect(planFromSources([], ["midpoint_data"], { rollback: ["midpoint_data"] })).toBeNull();
  });
  it("uses the suite plan when env is empty", () => {
    expect(planFromSources([], [], { stop: ["midpoint_data"], rollback: ["midpoint_data"] }))
      .toEqual({ stopServices: ["midpoint_data"], rollbackChildren: ["midpoint_data"] });
  });
  it("env wins per-field over the suite", () => {
    expect(planFromSources(["db"], ["dbvol"], { stop: ["midpoint_data"], rollback: ["midpoint_data"] }))
      .toEqual({ stopServices: ["db"], rollbackChildren: ["dbvol"] });
    expect(planFromSources(["db"], [], { rollback: ["dbvol"] }))
      .toEqual({ stopServices: ["db"], rollbackChildren: ["dbvol"] });
  });
  it("defaults rollback to the stop service names", () => {
    expect(planFromSources(["midpoint_data"], []))
      .toEqual({ stopServices: ["midpoint_data"], rollbackChildren: ["midpoint_data"] });
  });
});
