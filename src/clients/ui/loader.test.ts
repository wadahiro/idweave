/**
 * Unit: the page-object loader's version selection + override merge — no running stack, no
 * browser. The pure `mergeAndValidate` covers every layer-composition branch
 * (override wins / fall-through / undefined-skip / missing-required) with fake
 * in-memory modules; the async `loadPageObjects` covers the unknown-version
 * guard (which fails before importing any reference, so Playwright never loads).
 */
import { describe, it, expect } from "vitest";
import {
  availableVersions,
  loadPageObjects,
  mergeAndValidate,
  type GuiPageObjectSpec,
} from "./loader.ts";
import { AUTH_PROVIDERS } from "./auth/registry.ts";
import type { PageObjectModule } from "./contract.ts";

const SPEC: GuiPageObjectSpec = { version: "4.10" };

// Fake factories tagged so we can tell whose screen survived the merge. They
// ignore the PageContext (never invoked against a real browser here).
const refLogin = () => ({ login: async () => {}, _tag: "ref-login" }) as never;
const ovLogin = () => ({ login: async () => {}, _tag: "ov-login" }) as never;
const refRequest = () => ({ requestRole: async () => {}, _tag: "ref-request" }) as never;
const refWork = () => ({ approve: async () => {}, _tag: "ref-work" }) as never;
const ovRequest = () => ({ requestRole: async () => {}, _tag: "ov-request" }) as never;

function reference(): PageObjectModule {
  return { version: "4.10", login: refLogin, requestAccess: refRequest, workItems: refWork };
}

/** Read the tag a factory stamps on its product, to identify the surviving layer. */
const tagOf = (factory: (ctx: never) => unknown): string =>
  (factory(undefined as never) as { _tag: string })._tag;

describe("mergeAndValidate", () => {
  it("returns the reference unchanged when there are no overrides", () => {
    const resolved = mergeAndValidate(reference(), undefined, SPEC);
    expect(tagOf(resolved.login)).toBe("ref-login");
    expect(tagOf(resolved.requestAccess)).toBe("ref-request");
    expect(tagOf(resolved.workItems)).toBe("ref-work");
  });

  it("lets a project override win screen by screen, others falling through", () => {
    const resolved = mergeAndValidate(reference(), { requestAccess: ovRequest }, SPEC);
    expect(tagOf(resolved.requestAccess)).toBe("ov-request"); // overridden
    expect(tagOf(resolved.login)).toBe("ref-login"); // fell through
    expect(tagOf(resolved.workItems)).toBe("ref-work"); // fell through
  });

  it("does not let an undefined override key clobber the reference", () => {
    const resolved = mergeAndValidate(reference(), { workItems: undefined }, SPEC);
    expect(tagOf(resolved.workItems)).toBe("ref-work");
  });

  it("throws listing the missing factories when a required screen is absent", () => {
    const incomplete: PageObjectModule = { version: "4.10", login: refLogin };
    expect(() => mergeAndValidate(incomplete, undefined, SPEC)).toThrow(
      /missing required factories: requestAccess, workItems/,
    );
  });

  it("names both layers in the error when overrides are in play", () => {
    const incomplete: PageObjectModule = { login: refLogin, requestAccess: refRequest };
    const spec: GuiPageObjectSpec = { version: "4.10", overrides: "./pageobjects.ts" };
    expect(() => mergeAndValidate(incomplete, {}, spec)).toThrow(
      /reference "4.10" \+ overrides ".\/pageobjects.ts".*missing.*workItems/,
    );
  });
});

describe("auth provider resolution", () => {
  it("keeps the version's native login when no auth is selected", () => {
    const resolved = mergeAndValidate(reference(), undefined, SPEC);
    expect(tagOf(resolved.login)).toBe("ref-login");
  });

  it("keeps native login for the midpoint sentinel", () => {
    const spec: GuiPageObjectSpec = { version: "4.10", auth: { type: "midpoint" } };
    expect(tagOf(mergeAndValidate(reference(), undefined, spec).login)).toBe("ref-login");
  });

  it("overrides login with the keycloak provider, leaving other screens untouched", () => {
    const spec: GuiPageObjectSpec = { version: "4.10", auth: { type: "keycloak" } };
    const resolved = mergeAndValidate(reference(), undefined, spec);
    // Identity check (not tagOf): the SSO factory dereferences a real PageContext.
    expect(resolved.login).toBe(AUTH_PROVIDERS.keycloak); // SSO login replaced it
    expect(tagOf(resolved.requestAccess)).toBe("ref-request"); // version screen kept
    expect(tagOf(resolved.workItems)).toBe("ref-work");
  });

  it("auth provider wins over a project login override too", () => {
    const spec: GuiPageObjectSpec = { version: "4.10", auth: { type: "keycloak" } };
    const resolved = mergeAndValidate(reference(), { login: ovLogin }, spec);
    expect(resolved.login).toBe(AUTH_PROVIDERS.keycloak);
  });

  it("rejects an unknown auth type, listing the available ones", () => {
    const spec: GuiPageObjectSpec = { version: "4.10", auth: { type: "saml" } };
    expect(() => mergeAndValidate(reference(), undefined, spec)).toThrow(
      /Unknown GUI auth type "saml".*midpoint, keycloak/,
    );
  });
});

describe("loginFor (named-login resolver)", () => {
  it("resolves native (the version's login) for undefined / midpoint", () => {
    const resolved = mergeAndValidate(reference(), undefined, SPEC);
    expect(tagOf(resolved.loginFor(undefined))).toBe("ref-login");
    expect(tagOf(resolved.loginFor("midpoint"))).toBe("ref-login");
  });

  it("resolves a registered provider (keycloak) by name", () => {
    const resolved = mergeAndValidate(reference(), undefined, SPEC);
    expect(resolved.loginFor("keycloak")).toBe(AUTH_PROVIDERS.keycloak);
  });

  it("still resolves native even when the suite DEFAULT login is keycloak", () => {
    // gui.auth makes `login` the SSO provider, but a named login can still pick native.
    const resolved = mergeAndValidate(reference(), undefined, { version: "4.10", auth: { type: "keycloak" } });
    expect(resolved.login).toBe(AUTH_PROVIDERS.keycloak);
    expect(tagOf(resolved.loginFor("midpoint"))).toBe("ref-login");
  });

  it("throws on an unknown named-login auth type", () => {
    const resolved = mergeAndValidate(reference(), undefined, SPEC);
    expect(() => resolved.loginFor("saml")).toThrow(/Unknown GUI auth type "saml".*midpoint, keycloak/);
  });
});

describe("loadPageObjects", () => {
  it("lists the registered reference versions", () => {
    expect(availableVersions()).toEqual(expect.arrayContaining(["4.10", "4.8", "4.4", "4.0"]));
  });

  it("rejects an unknown version, listing the available ones", async () => {
    await expect(loadPageObjects({ version: "9.9" }, "/tmp")).rejects.toThrow(
      /Unknown GUI version "9.9".*available: 4\.10/,
    );
  });
});
