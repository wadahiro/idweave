/**
 * Unit: the search-federated-user precondition step — no running stack, no network. Covers
 * the handler's declaration surface (match/token/detail/schema) and that `run` fails with a
 * clear, actionable error when no Keycloak admin connection is configured (the success path
 * hits real Keycloak and is exercised by the federated suites).
 */
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { searchFederatedUserStep } from "./search-federated-user.ts";
import type { RunContext } from "./types.ts";

const validate = new Ajv({ allErrors: true, strict: false }).compile(searchFederatedUserStep.schema);

describe("search-federated-user step", () => {
  it("matches its own declaration and nothing else", () => {
    expect(searchFederatedUserStep.match({ "search-federated-user": { login: "alice" } })).toBe(true);
    expect(searchFederatedUserStep.match({ "clear-focus": { name: "alice" } })).toBe(false);
    expect(searchFederatedUserStep.match(null)).toBe(false);
  });

  it("renders a token and a one-line detail naming the login", () => {
    const step = { "search-federated-user": { login: "alice@example.com" } };
    expect(searchFederatedUserStep.token(step)).toBe("search-federated-user");
    expect(searchFederatedUserStep.detail(step, { suite: {} as never })).toContain("alice@example.com");
  });

  it("accepts a well-formed step and rejects malformed ones (schema)", () => {
    expect(validate({ "search-federated-user": { login: "alice" } })).toBe(true);
    expect(validate({ "search-federated-user": {} })).toBe(false); // missing login
    expect(validate({ "search-federated-user": { login: "alice", extra: 1 } })).toBe(false); // additionalProperties
  });

  it("throws an actionable error when no Keycloak admin connection is configured", async () => {
    const ctx = { cfg: { poll: { timeoutMs: 100, intervalMs: 10 } } } as unknown as RunContext;
    await expect(searchFederatedUserStep.run({ "search-federated-user": { login: "alice" } }, ctx)).rejects.toThrow(
      /KEYCLOAK_ADMIN_URL/,
    );
  });
});
