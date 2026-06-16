/**
 * Unit: the pure row -> Keycloak-user-representation mapper, and that the blanket
 * reset/set are refused on a shared realm. No Keycloak server.
 */
import { describe, it, expect } from "vitest";
import { applyRow, resetSource, setSource } from "./keycloakSource.ts";
import type { SystemSpec } from "../scenario/suite.ts";

describe("applyRow", () => {
  it("routes known fields to the top level, the rest to custom attributes, coerces booleans, skips blanks", () => {
    const rep = applyRow({}, {
      username: "alice",
      email: "alice@example.com",
      firstName: "Alice",
      enabled: "true",
      emailVerified: "false",
      department: "eng",
      employeeId: "E-1",
      title: "",
    });
    expect(rep).toEqual({
      username: "alice",
      email: "alice@example.com",
      firstName: "Alice",
      enabled: true,
      emailVerified: false,
      attributes: { department: ["eng"], employeeId: ["E-1"] },
    });
  });

  it("overlays onto an existing representation (replace), preserving untouched attributes", () => {
    const current = { id: "x", username: "bob", firstName: "Bob", attributes: { department: ["sales"] } };
    const rep = applyRow({ ...current }, { username: "bob", firstName: "Robert", region: "EU" });
    expect(rep).toEqual({
      id: "x",
      username: "bob",
      firstName: "Robert",
      attributes: { department: ["sales"], region: ["EU"] },
    });
  });
});

describe("blanket source mutation is refused on a shared realm", () => {
  const system = { keycloak: {} } as unknown as SystemSpec;
  it("reset throws", () => {
    expect(() => resetSource("/tmp", system)).toThrow(/not supported/);
  });
  it("set throws", () => {
    expect(() => setSource("/tmp", system, [])).toThrow(/not supported/);
  });
});
