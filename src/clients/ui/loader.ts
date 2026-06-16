/**
 * clients — page-object LOADER: version selection + project override merge.
 *
 * Resolves the three layers into one ready-to-use set:
 *   reference[version]  (stock GUI for a midPoint major — `pages/<version>.ts`)
 *     ⊕ project overrides (only the screens a deployment deviates on)
 *
 * References live in a static registry (not a template-literal `import`) so the
 * engine bundles cleanly for distribution — that is the whole point of this
 * refactor. Adding a major version = a `pages/<version>.ts` module + one line
 * below. Overrides are a project file named by the suite, so they are inherently
 * a runtime dynamic import (they are NOT part of the distributed engine).
 */
import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";
import type { PageObjectModule, ResolvedPageObjects } from "./contract.ts";
import { AUTH_PROVIDERS, NATIVE_AUTH, availableAuthTypes } from "./auth/registry.ts";

/**
 * Known reference modules by major version. Static so a bundler can see every
 * import; the lazy thunk means only the selected version is actually loaded.
 */
const REFERENCES: Record<string, () => Promise<{ default: PageObjectModule }>> = {
  "4.10": () => import("./pages/4.10.ts"),
  // Scaffolds cloned from 4.10 — selectors UNVERIFIED against these GUIs yet.
  "4.8": () => import("./pages/4.8.ts"),
  "4.4": () => import("./pages/4.4.ts"),
  "4.0": () => import("./pages/4.0.ts"),
};

/** The required factories a resolved set must provide (validated post-merge). */
const REQUIRED_KEYS = ["login", "requestAccess", "workItems"] as const;

/** GUI page-object selection, declared by the suite (version + optional override file). */
export interface GuiPageObjectSpec {
  /** Major midPoint version → which reference module to load (e.g. "4.10"). */
  version: string;
  /** Optional project override module path, resolved relative to `baseDir`. */
  overrides?: string;
  /**
   * Optional authentication provider for the `login` screen. Omitted/`midpoint`
   * keeps the version module's own login form; another type (e.g. `keycloak`)
   * resolves a login from the auth registry that OVERRIDES it (for SSO).
   */
  auth?: { type: string };
}

/** Available reference versions, for diagnostics. */
export function availableVersions(): string[] {
  return Object.keys(REFERENCES);
}

/**
 * Load the reference module for `version`, merge any project overrides over it,
 * and validate the result has every required factory.
 *
 * @param spec    version + optional overrides path (from the suite's `gui`).
 * @param baseDir directory the overrides path is resolved against (the suite dir).
 */
export async function loadPageObjects(
  spec: GuiPageObjectSpec,
  baseDir: string,
): Promise<ResolvedPageObjects> {
  const ref = REFERENCES[spec.version];
  if (!ref) {
    throw new Error(
      `Unknown GUI version "${spec.version}" (available: ${availableVersions().join(", ") || "none"}). ` +
        `Add a reference module at src/clients/ui/pages/${spec.version}.ts and register it in loader.ts.`,
    );
  }
  const reference = (await ref()).default;
  const overrides = spec.overrides ? await importOverrides(spec.overrides, baseDir) : undefined;
  return mergeAndValidate(reference, overrides, spec);
}

/**
 * Pure layer composition: merge project overrides over a reference (project wins
 * screen by screen; absent/undefined override keys fall through to reference),
 * then validate every required factory is present. IO-free, so all the merge and
 * validation branches are unit-testable without a browser or fixture files.
 */
export function mergeAndValidate(
  reference: PageObjectModule,
  overrides: PageObjectModule | undefined,
  spec: GuiPageObjectSpec,
): ResolvedPageObjects {
  const merged: PageObjectModule = overrides ? { ...reference, ...stripUndefined(overrides) } : reference;
  const resolved = validate(applyAuth(merged, spec), spec);
  // Named-login resolver: the version's native login (post-override) for
  // native, a registered provider otherwise — so `gui.logins` can mix them.
  const nativeLogin = merged.login!; // validated present below
  resolved.loginFor = (type) => {
    if (!type || type === NATIVE_AUTH) return nativeLogin;
    const provider = AUTH_PROVIDERS[type];
    if (!provider) {
      throw new Error(
        `Unknown GUI auth type "${type}" (available: ${availableAuthTypes().join(", ")}). ` +
          `Set a gui.logins[...].auth to one of those, or omit it for the version's native login.`,
      );
    }
    return provider;
  };
  return resolved;
}

/**
 * Resolve the `login` screen from the auth provider when the suite selects one.
 * Native (default/`midpoint`) keeps the version module's own login; any
 * registered provider (e.g. `keycloak`) overrides it. Pure — no IO — so the
 * branch is unit-testable alongside the merge.
 */
function applyAuth(m: PageObjectModule, spec: GuiPageObjectSpec): PageObjectModule {
  const type = spec.auth?.type;
  if (!type || type === NATIVE_AUTH) return m;
  const provider = AUTH_PROVIDERS[type];
  if (!provider) {
    throw new Error(
      `Unknown GUI auth type "${type}" (available: ${availableAuthTypes().join(", ")}). ` +
        `Set gui.auth.type to one of those, or omit it for the version's native login.`,
    );
  }
  return { ...m, login: provider };
}

/** Dynamic-import a project override module and return its PageObjectModule. */
async function importOverrides(overridesPath: string, baseDir: string): Promise<PageObjectModule> {
  const abs = isAbsolute(overridesPath) ? overridesPath : resolve(baseDir, overridesPath);
  let mod: { default?: PageObjectModule };
  try {
    mod = await import(pathToFileURL(abs).href);
  } catch (cause) {
    const detail = String(cause);
    // The override is a TypeScript ESM module (`export default`). Node 23+ defaults
    // a `.ts` to CommonJS unless the nearest package.json says otherwise, and then
    // loading its ESM default throws a require(esm) cycle (or a TS syntax error).
    // Point straight at the one-line fix instead of leaving the cryptic cause.
    const esmCjsHint = /ERR_REQUIRE_CYCLE_MODULE|require\(\) ES Module|Unexpected (identifier|token|reserved word)/.test(detail)
      ? ` — this looks like an ESM/CommonJS mismatch: add \`"type": "module"\` to your project's package.json so the .ts override loads as ES module (Node 23+ defaults .ts to CommonJS, which breaks its \`export default\`).`
      : "";
    throw new Error(`Failed to load GUI overrides module "${overridesPath}" (resolved: ${abs}): ${detail}${esmCjsHint}`);
  }
  if (!mod.default) {
    throw new Error(`GUI overrides module "${overridesPath}" must default-export a PageObjectModule.`);
  }
  return mod.default;
}

/** Drop keys whose value is `undefined` so they don't clobber the reference on spread. */
function stripUndefined(m: PageObjectModule): PageObjectModule {
  const out: PageObjectModule = {};
  for (const [k, v] of Object.entries(m)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Ensure every required factory is present after merging; otherwise fail loudly. */
function validate(m: PageObjectModule, spec: GuiPageObjectSpec): ResolvedPageObjects {
  const missing = REQUIRED_KEYS.filter((k) => typeof m[k] !== "function");
  if (missing.length > 0) {
    const where = spec.overrides ? `reference "${spec.version}" + overrides "${spec.overrides}"` : `reference "${spec.version}"`;
    throw new Error(`GUI page objects from ${where} are missing required factories: ${missing.join(", ")}.`);
  }
  // `flows` defaults to empty (most suites define none); a project override adds them.
  return { flows: {}, ...m } as ResolvedPageObjects;
}
