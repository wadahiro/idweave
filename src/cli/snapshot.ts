/**
 * CLI command: named whole-environment snapshots (build / list / restore).
 *
 * The connected-test baseline is a COHERENT multi-system state — midPoint's repo
 * AND every source/target system AND the host-side config. We capture/restore all
 * of it with one uniform mechanism while services are FROZEN — paused (default,
 * fast) or fully stopped — so the snapshot is consistent across systems:
 *   - every docker volume of the compose project (auto-discovered by label), and
 *   - every host BIND mount of the project (auto-discovered from compose config),
 *     read-write OR read-only.
 *
 * Read-only binds matter too: midPoint re-imports its `post-initial-objects`
 * config from the host on every boot, so a faithful restore must put that config
 * back as well — otherwise the restored DB and the host config diverge. Restore
 * therefore SYNCS each bind dir to the snapshot (host-side edits are reverted;
 * committed dirs like the config are recoverable via git). midPoint reboots from
 * the snapshot state, so caches come back fresh.
 *
 * Outer-orchestrator tooling: shells to docker on the HOST (invoked by make),
 * never from the test runtime — so no docker socket reaches test code.
 *
 * Env-driven (example defaults target the 4.10 version folder; the Makefile's
 * VER param overrides these for other versions):
 *   COMPOSE_PROJECT  (default: idweave-410)
 *   COMPOSE_FILES    (comma-separated; default: examples/midpoint-4.10/infra compose + overlay)
 *   SNAPSHOT_DIR         (default: examples/midpoint-4.10/infra/snapshots)
 *   SNAPSHOT_MODE (snapshot-build only: 'pause' [default] freezes containers in
 *                       place — fast, no restart, crash-consistent; 'stop' fully
 *                       stops for a clean shutdown. CLI `--stop`/`--pause` wins.)
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync, writeFileSync, readFileSync,
} from "node:fs";
import { resolve, join, relative, isAbsolute, dirname } from "node:path";
import { loadSuite, type SnapshotSpec } from "../scenario/suite.ts";
import { runAfterRestore } from "../scenario/restore.ts";
import { loadConfig } from "../config.ts";

const DEFAULT_SNAPSHOT = "baseline";

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function settings() {
  const project = env("COMPOSE_PROJECT", "idweave-410");
  const files = env(
    "COMPOSE_FILES",
    "examples/midpoint-4.10/infra/docker-compose.yml,examples/midpoint-4.10/infra/compose.test.yml",
  ).split(",");
  const snapshotDir = resolve(process.cwd(), env("SNAPSHOT_DIR", "examples/midpoint-4.10/infra/snapshots"));
  const composeArgs = ["compose", "-p", project, ...files.flatMap((f) => ["-f", f])];
  // Backend for the heavy VOLUME state. "tar" (default, portable: a helper container
  // tars each volume — works on any Docker host). "btrfs" (fast: the project's volumes
  // are btrfs subvolumes, so snapshot/reset is an instant, size-independent CoW op).
  // btrfs is a MAINLINE kernel FS (no DKMS — works on a stock kernel, incl. WSL2). The
  // HOST BINDS (e.g. editable CSV) are copied either way, so they stay locally visible.
  // btrfs needs the snapshot CLI to reach the FS tools where the volumes live (co-located
  // on a Linux host; via SNAPSHOT_BTRFS_CMD otherwise).
  const backend = backendOf(env("SNAPSHOT_BACKEND", "tar"));
  const btrfsDir = env("SNAPSHOT_BTRFS_DIR", "");
  if (backend === "btrfs" && !btrfsDir) {
    throw new Error("SNAPSHOT_BACKEND=btrfs requires SNAPSHOT_BTRFS_DIR (the directory holding the project's volume subvolumes).");
  }
  return { project, snapshotDir, composeArgs, backend, btrfsDir };
}

export type SnapshotBackend = "tar" | "btrfs";
export function backendOf(v: string): SnapshotBackend {
  const b = v.toLowerCase();
  if (b === "tar" || b === "btrfs") return b;
  throw new Error(`SNAPSHOT_BACKEND must be 'tar' or 'btrfs', got: "${v}"`);
}

function snapshotName(name: string | undefined): string {
  const n = name && name.trim() ? name.trim() : DEFAULT_SNAPSHOT;
  if (!/^[A-Za-z0-9._-]+$/.test(n)) {
    throw new Error(`Invalid snapshot name "${n}" (use letters, digits, . _ -)`);
  }
  return n;
}

export type SnapshotMode = "pause" | "stop";

/**
 * Freeze mode for `snapshot-build`. Default `pause` (freeze processes in place: fast,
 * no restart, crash-consistent — DBs recover via their WAL on the next real
 * start). `stop` does a full clean shutdown (slower, re-runs entrypoints on
 * start). A `--stop` / `--pause` CLI flag wins over the SNAPSHOT_MODE env.
 * (Pure: takes argv + env so it is unit-testable.)
 */
export function resolveSnapshotMode(argv: readonly string[], envMode: string | undefined): SnapshotMode {
  if (argv.includes("--stop")) return "stop";
  if (argv.includes("--pause")) return "pause";
  const m = (envMode ?? "").toLowerCase();
  if (m === "") return "pause";
  if (m === "pause" || m === "stop") return m;
  throw new Error(`SNAPSHOT_MODE must be 'pause' or 'stop', got: "${envMode}"`);
}

function docker(args: string[]): void {
  execFileSync("docker", args, { stdio: "inherit" });
}
function dockerOut(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf-8" });
}

// btrfs runs where the subvolumes live. SNAPSHOT_BTRFS_CMD is a privileged-exec PREFIX
// (btrfs ops need `btrfs`+`mkdir`/`sh`, so the prefix carries no program), default
// "" = run locally, e.g. "sudo" or "limactl shell dev1 -- sudo" from a Mac→lima VM.
function btrfsRun(script: string): void {
  const parts = env("SNAPSHOT_BTRFS_CMD", "").split(/\s+/).filter(Boolean);
  const argv = [...parts, "sh", "-c", script];
  execFileSync(argv[0]!, argv.slice(1), { stdio: "inherit" });
}
/** Read-only CoW snapshot of subvolume `vol` → `snap` (re-buildable: drop a stale one first). */
function btrfsSnapshot(vol: string, snap: string): void {
  btrfsRun(`btrfs subvolume delete '${snap}' 2>/dev/null; mkdir -p "$(dirname '${snap}')"; btrfs subvolume snapshot -r '${vol}' '${snap}'`);
}
/** Reset subvolume `vol` to `snap` by SWAP: delete it, re-snapshot writable from the RO baseline (ownership preserved). */
function btrfsReset(vol: string, snap: string): void {
  btrfsRun(`btrfs subvolume delete '${vol}' && btrfs subvolume snapshot '${snap}' '${vol}'`);
}

/** Compose volume KEYS (the per-volume subvolume names) from full docker volume names. */
function volumeKeys(project: string, volumes: string[]): string[] {
  const prefix = `${project}_`;
  return volumes.map((v) => (v.startsWith(prefix) ? v.slice(prefix.length) : v));
}

function splitCsv(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export interface RestorePlan {
  /** Compose service(s) to fully stop+restart around the reset. */
  stopServices: string[];
  /** Compose volume KEY(s) to reset (btrfs subvolume swap / tar untar of that volume). */
  rollbackChildren: string[];
}

/**
 * Resolve the near-non-stop restore plan from its sources, env winning per-field
 * over the suite's `snapshot.restore`. `null` when nothing names a service to stop →
 * the caller does a full stop/reset of everything. `rollback` defaults to the
 * `stop` names (volumes named after the data service they back). Pure (takes the
 * already-read sources) so it is unit-testable.
 */
export function planFromSources(
  envStop: string[],
  envRollback: string[],
  suiteRestore?: SnapshotSpec["restore"],
): RestorePlan | null {
  const stop = envStop.length ? envStop : suiteRestore?.stop ?? [];
  let rollback = envRollback.length ? envRollback : suiteRestore?.rollback ?? [];
  if (stop.length === 0) return null;
  if (rollback.length === 0) rollback = stop;
  return { stopServices: stop, rollbackChildren: rollback };
}

/** Read the near-non-stop plan: env (`SNAPSHOT_RESTORE_STOP`/`SNAPSHOT_RESTORE_ROLLBACK`), else `suite.snapshot.restore`. */
async function resolveRestorePlan(): Promise<RestorePlan | null> {
  const envStop = splitCsv(env("SNAPSHOT_RESTORE_STOP", ""));
  const envRollback = splitCsv(env("SNAPSHOT_RESTORE_ROLLBACK", ""));
  // Only pay the suite read when env doesn't already fully specify the plan.
  const suiteRestore = envStop.length && envRollback.length ? undefined : (await loadSnapshotSpec())?.restore;
  return planFromSources(envStop, envRollback, suiteRestore);
}

/** Best-effort read of `suite.snapshot` (no suite / invalid → undefined; never throws into snapshot). */
async function loadSnapshotSpec(): Promise<SnapshotSpec | undefined> {
  const dir = process.env.SCENARIOS_DIR;
  if (!dir) return undefined;
  try {
    return (await loadSuite(dir)).snapshot;
  } catch {
    return undefined;
  }
}

/**
 * Map of compose service → its container's `StartedAt`. A per-BOOT identity proxy:
 * midPoint mints a random internalNodeIdentifier each boot, so an unchanged
 * StartedAt means the same node identity the baseline was captured under. (One-shot
 * services that already exited aren't listed by `ps -q`, which is what we want.)
 */
function serviceStartedAt(composeArgs: string[]): Record<string, string> {
  const ids = dockerOut([...composeArgs, "ps", "-q"]).split("\n").map((s) => s.trim()).filter(Boolean);
  const out: Record<string, string> = {};
  for (const id of ids) {
    const line = dockerOut([
      "inspect", id, "--format", '{{index .Config.Labels "com.docker.compose.service"}}\t{{.State.StartedAt}}',
    ]).trim();
    const tab = line.indexOf("\t");
    if (tab > 0) out[line.slice(0, tab)] = line.slice(tab + 1);
  }
  return out;
}

/** Sync each host BIND dir to the snapshot (host-side edits reverted). Shared by both restore paths. */
function restoreBinds(binds: Bind[], dir: string): void {
  for (const b of binds) {
    const src = join(dir, "binds", b.relpath);
    if (!existsSync(src)) continue;
    console.log(`  restore bind ${b.relpath}`);
    syncBindInPlace(src, b.source);
  }
}

/**
 * Sync `dst` to match `src` WITHOUT replacing `dst` itself: for a directory, clear
 * its children and copy `src`'s in — PRESERVING the `dst` inode. A bind mount
 * resolves to the directory's inode, so `rm -rf dst && cp` leaves a container that
 * is only PAUSED (near-non-stop) pointing at the deleted inode — it would see an
 * empty/stale mount and files written there become invisible. In-place keeps the
 * live mount valid (and is harmless for the full-restart path).
 */
function syncBindInPlace(src: string, dst: string): void {
  // preserveTimestamps: keep the snapshot's mtime (cpSync drops it by default), so a
  // restore is faithful for any consumer that keys off file times. (mode is preserved
  // by default; owner is not — but a host bind is the restoring user's either way.)
  if (!statSync(src).isDirectory()) {
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { preserveTimestamps: true }); // file bind
    return;
  }
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(dst)) rmSync(join(dst, e), { recursive: true, force: true });
  for (const e of readdirSync(src)) cpSync(join(src, e), join(dst, e), { recursive: true, preserveTimestamps: true });
}

/** All docker volumes of the compose project (no need to enumerate). */
function projectVolumes(project: string): string[] {
  return dockerOut([
    "volume", "ls",
    "--filter", `label=com.docker.compose.project=${project}`,
    "--format", "{{.Name}}",
  ])
    .split("\n").map((s) => s.trim()).filter(Boolean);
}

interface Bind {
  source: string;
  /** Path relative to cwd, used as the storage key inside the snapshot. */
  relpath: string;
}

/** All host BIND mounts of the project (RW and RO), restricted to under cwd. */
function projectBinds(composeArgs: string[]): Bind[] {
  const cfg = JSON.parse(dockerOut([...composeArgs, "config", "--format", "json"])) as {
    services?: Record<string, { volumes?: Array<{ type?: string; source?: string }> }>;
  };
  const seen = new Set<string>();
  const binds: Bind[] = [];
  for (const svc of Object.values(cfg.services ?? {})) {
    for (const v of svc.volumes ?? []) {
      if (v.type !== "bind" || !v.source) continue;
      const source = resolve(v.source);
      if (seen.has(source)) continue;
      seen.add(source);
      const rel = relative(process.cwd(), source);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        console.warn(`  skip bind outside project: ${source}`);
        continue;
      }
      binds.push({ source, relpath: rel });
    }
  }
  return binds;
}

function snapshotVolume(vol: string, dir: string): void {
  // Tar-based (filesystem-agnostic; works on any Docker host). Source read-only.
  docker([
    "run", "--rm", "-v", `${vol}:/data:ro`, "-v", `${dir}:/backup`,
    "alpine", "tar", "czf", `/backup/${vol}.tgz`, "-C", "/data", ".",
  ]);
}
function restoreVolume(vol: string, dir: string): void {
  docker([
    "run", "--rm", "-v", `${vol}:/data`, "-v", `${dir}:/backup`,
    "alpine", "sh", "-c",
    `rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf /backup/${vol}.tgz -C /data`,
  ]);
}

function dirSize(dir: string): number {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
}
function human(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / 1024 ** 2).toFixed(1)}M`;
}

interface SnapMeta {
  name: string;
  created: string;
  mode?: SnapshotMode;
  backend?: SnapshotBackend;
  /** Per-service container StartedAt at build — the near-non-stop safety guard (see snapshotRestore). */
  startedAt?: Record<string, string>;
  volumes: string[];
  binds: string[];
}

export function snapshotBuild(name?: string): void {
  // Flags can appear in place of / alongside the name — don't treat them as one.
  const snap = snapshotName(name && !name.startsWith("-") ? name : undefined);
  const mode = resolveSnapshotMode(process.argv, process.env.SNAPSHOT_MODE);
  const { project, snapshotDir, composeArgs, backend, btrfsDir } = settings();
  const volumes = projectVolumes(project);
  if (volumes.length === 0) throw new Error(`No volumes found for compose project "${project}"`);
  const binds = projectBinds(composeArgs);
  // Record each running service's StartedAt BEFORE freezing — the near-non-stop
  // restore guard compares against it to detect a since-restarted app (pause does
  // not change StartedAt, so this is the boot the baseline is captured under).
  const startedAt = serviceStartedAt(composeArgs);
  const dir = join(snapshotDir, snap);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // pause = freeze processes in place (fast, no restart, crash-consistent);
  // stop = clean shutdown. Either way nothing writes the volumes mid-capture.
  const [freeze, thaw] = mode === "stop" ? ["stop", "start"] : ["pause", "unpause"];
  console.log(`Freezing services (${mode}) for a consistent snapshot "${snap}" [backend=${backend}]...`);
  docker([...composeArgs, freeze]);
  try {
    if (backend === "btrfs") {
      // Per-subvolume CoW snapshot (instant, size-independent — the volume DATA stays
      // in btrfs, not in snapshotDir). We froze above, so per-subvolume is consistent.
      for (const key of volumeKeys(project, volumes)) {
        console.log(`  btrfs snapshot subvolume ${key}`);
        btrfsSnapshot(`${btrfsDir}/${key}`, `${btrfsDir}/.snap/${snap}/${key}`);
      }
    } else {
      for (const v of volumes) {
        console.log(`  snapshot volume ${v}`);
        snapshotVolume(v, dir);
      }
    }
    // Host binds (e.g. editable CSV) are copied either way, so they stay locally visible.
    for (const b of binds) {
      if (!existsSync(b.source)) continue;
      console.log(`  snapshot bind ${b.relpath}`);
      cpSync(b.source, join(dir, "binds", b.relpath), { recursive: true, preserveTimestamps: true });
    }
    const meta: SnapMeta = {
      name: snap,
      created: new Date().toISOString(),
      mode,
      backend,
      startedAt,
      volumes,
      binds: binds.map((b) => b.relpath),
    };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  } finally {
    // Always thaw, even if a tar failed, so an error never leaves the stack frozen.
    docker([...composeArgs, thaw]);
  }
  console.log(`Captured snapshot "${snap}" (${mode}) in ${dir}.`);
}

export async function snapshotRestore(name?: string): Promise<void> {
  const snap = snapshotName(name);
  const { project, snapshotDir, composeArgs, backend, btrfsDir } = settings();
  const dir = join(snapshotDir, snap);
  if (!existsSync(dir)) {
    throw new Error(`Snapshot "${snap}" not found in ${snapshotDir}; run 'make snapshot-build' (or snapshot-list).`);
  }
  const volumes = projectVolumes(project);
  const binds = projectBinds(composeArgs);

  // A declared restore topology → fast NEAR-NON-STOP reset: STOP only the data
  // service(s) (postgres) and PAUSE the rest, so the heavy app (midPoint) is frozen,
  // never rebooted; reset only the data volume(s), restart the data service, unpause
  // the rest — the app recovers via its DB pool in seconds (vs a minutes-long reboot).
  // Skipping midPoint's reboot is backend-independent; the reset step is per-backend
  // (btrfs = instant subvolume swap; tar = untar that one volume — so even tar gets
  // the big win on small/medium DBs). Plan from env or suite.snapshot.restore; absent →
  // the full stop/reset path below.
  const plan = await resolveRestorePlan();
  if (plan && nearNonStopSafe(plan, dir, composeArgs)) {
    const paused = Object.keys(serviceStartedAt(composeArgs)).filter((s) => !plan.stopServices.includes(s));
    console.log(
      `Near-non-stop restore "${snap}" [${backend}]: stop [${plan.stopServices.join(", ")}], pause [${paused.join(", ") || "-"}]...`,
    );
    if (paused.length) docker([...composeArgs, "pause", ...paused]);
    docker([...composeArgs, "stop", ...plan.stopServices]);
    try {
      // `rollback` names compose volume KEYS to reset; map per backend.
      for (const child of plan.rollbackChildren) {
        if (backend === "btrfs") {
          console.log(`  btrfs reset subvolume ${child}`);
          btrfsReset(`${btrfsDir}/${child}`, `${btrfsDir}/.snap/${snap}/${child}`);
        } else {
          const vol = `${project}_${child}`;
          if (!existsSync(join(dir, `${vol}.tgz`))) {
            console.warn(`  no snapshot for volume ${vol}; skipping`);
            continue;
          }
          console.log(`  restore volume ${vol}`);
          restoreVolume(vol, dir);
        }
      }
      restoreBinds(binds, dir);
    } finally {
      // Data service back FIRST, then unpause the app so its pool reconnects to a
      // live DB (always run, so an error never leaves the stack frozen).
      docker([...composeArgs, "start", ...plan.stopServices]);
      if (paused.length) docker([...composeArgs, "unpause", ...paused]);
    }
    console.log(
      `Restored "${snap}" (near-non-stop): ${plan.stopServices.join(", ")} restarted; paused services recover via their pool.`,
    );
    // The paused running system kept running over a rolled-back DB → each system reconciles its
    // in-memory state (midPoint clears its caches, etc.). Only here: a full-restart
    // (below) reboots the running system, so its caches come back fresh and need no hook.
    await runRestoreHooks();
    return;
  }

  // Full reset (default, and the automatic fallback when near-non-stop isn't safe):
  // stop everything, reset all volumes, restart. Replacing a volume's files under a
  // live/paused process corrupts it, so everything must stop and reload.
  console.log(`Stopping services to restore snapshot "${snap}" [backend=${backend}]...`);
  docker([...composeArgs, "stop"]);
  try {
    if (backend === "btrfs") {
      for (const key of volumeKeys(project, volumes)) {
        console.log(`  btrfs reset subvolume ${key}`);
        btrfsReset(`${btrfsDir}/${key}`, `${btrfsDir}/.snap/${snap}/${key}`);
      }
    } else {
      for (const v of volumes) {
        if (!existsSync(join(dir, `${v}.tgz`))) continue;
        console.log(`  restore volume ${v}`);
        restoreVolume(v, dir);
      }
    }
    restoreBinds(binds, dir);
  } finally {
    docker([...composeArgs, "start"]);
  }
  console.log(`Restored snapshot "${snap}"; midPoint reboots from it.`);
}

/**
 * Run each system's post-restore hook after a near-non-stop restore (midPoint cache
 * clear, etc. — see scenario/restore.ts). Best-effort: a generic compose project
 * with no suite just has no participants, so this no-ops rather than failing.
 */
async function runRestoreHooks(): Promise<void> {
  try {
    const cfg = loadConfig();
    const suite = await loadSuite(cfg.scenariosDir);
    await runAfterRestore(suite, cfg);
  } catch (e) {
    console.warn(`  after-restore hooks skipped: ${(e as Error).message}`);
  }
}

/**
 * Near-non-stop is only safe while every service we PAUSE is the SAME boot the
 * baseline was captured under: midPoint mints a random internalNodeIdentifier per
 * boot and SHUTS ITS SCHEDULER DOWN if the rolled-back repo's id ≠ its in-memory
 * one (split-brain guard — unrecoverable without a JVM restart). Compare each
 * paused service's current StartedAt to the snapshot's; any change (or missing
 * record) → unsafe → the caller falls back to a full restart.
 */
function nearNonStopSafe(plan: RestorePlan, dir: string, composeArgs: string[]): boolean {
  let recorded: Record<string, string> = {};
  try {
    recorded = (JSON.parse(readFileSync(join(dir, "meta.json"), "utf-8")) as SnapMeta).startedAt ?? {};
  } catch {
    /* no meta → unsafe below */
  }
  const current = serviceStartedAt(composeArgs);
  const paused = Object.keys(current).filter((s) => !plan.stopServices.includes(s));
  const restarted = paused.filter((s) => recorded[s] !== current[s]);
  if (restarted.length) {
    console.warn(
      `  near-non-stop NOT safe: paused service(s) [${restarted.join(", ")}] restarted since the snapshot ` +
      "(node identity would desync → Quartz scheduler shutdown). Falling back to full restart; re-run snapshot-build to regain the fast path.",
    );
    return false;
  }
  return true;
}

export function snapshotList(): void {
  const { snapshotDir } = settings();
  const snaps = existsSync(snapshotDir)
    ? readdirSync(snapshotDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(snapshotDir, e.name))
        .filter((d) => existsSync(join(d, "meta.json"))) // uniform across backends (tar writes .tgz; btrfs keeps data in subvolumes)
    : [];
  if (snaps.length === 0) {
    console.log("No snapshots yet (run 'make snapshot-build').");
    return;
  }
  console.log("NAME                 CREATED                   MODE   BACKEND SIZE    VOLUMES  BINDS");
  for (const d of snaps) {
    let meta: Partial<SnapMeta> = {};
    try {
      meta = JSON.parse(readFileSync(join(d, "meta.json"), "utf-8")) as SnapMeta;
    } catch {
      /* legacy/unknown snapshot */
    }
    const name = (meta.name ?? d.split("/").pop() ?? "").padEnd(20);
    const created = (meta.created ?? "-").padEnd(25);
    const mode = (meta.mode ?? "-").padEnd(6);
    const be = (meta.backend ?? "tar").padEnd(7);
    // SIZE = the snapshot dir on disk: full snapshot for tar; binds-only for btrfs (the
    // volume data lives in the btrfs subvolume snapshot, near-zero CoW, not under snapshotDir).
    const size = human(dirSize(d)).padEnd(7);
    const vols = String((meta.volumes ?? []).length).padEnd(8);
    const nbinds = (meta.binds ?? []).length;
    console.log(`${name} ${created} ${mode} ${be} ${size} ${vols} ${nbinds}`);
  }
}
