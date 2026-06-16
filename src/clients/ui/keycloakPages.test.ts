/**
 * Unit: the Keycloak GUI page-object set — login is the Keycloak provider; the
 * midPoint-shaped screens are not applicable and throw clearly. No browser.
 */
import { describe, it, expect } from "vitest";
import { keycloakGuiPageObjects } from "./keycloakPages.ts";

describe("keycloakGuiPageObjects", () => {
  const pages = keycloakGuiPageObjects();

  it("provides a login factory (and loginFor resolves to it for any type)", () => {
    expect(typeof pages.login).toBe("function");
    expect(pages.loginFor("keycloak")).toBe(pages.loginFor(undefined));
  });

  it("throws a clear error if a midPoint screen is reached on a Keycloak target", () => {
    const ctx = { page: {} as never, baseUrl: "http://kc:8080" };
    expect(() => pages.requestAccess(ctx)).toThrow(/not available on a Keycloak system/);
    expect(() => pages.workItems(ctx)).toThrow(/not available on a Keycloak system/);
  });

  it("has no custom flows by default", () => {
    expect(pages.flows).toEqual({});
  });
});
