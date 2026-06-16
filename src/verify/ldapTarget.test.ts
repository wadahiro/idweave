/**
 * Unit: projectLdapEntry — the pure projection/normalization of a raw directory
 * entry into the stable record the check asserts. No LDAP server.
 */
import { describe, it, expect } from "vitest";
import { projectLdapEntry } from "./ldapTarget.ts";

const RAW = {
  dn: "uid=jdoe,ou=Users,ou=share,dc=example,dc=com",
  uid: "jdoe",
  cn: "John Doe",
  sn: "Doe",
  mail: "jdoe@example.com",
  objectClass: ["top", "person", "inetOrgPerson"],
  userPassword: "{SSHA}abc123hashchanges",
  entryUUID: "8f3a-...-volatile",
  createTimestamp: "20260101000000Z",
};

describe("projectLdapEntry", () => {
  it("with an allowlist keeps only declared attributes (plus dn)", () => {
    const out = projectLdapEntry(RAW, ["uid", "mail", "objectClass"]);
    expect(out).toEqual({
      dn: "uid=jdoe,ou=Users,ou=share,dc=example,dc=com",
      uid: "jdoe",
      mail: "jdoe@example.com",
      objectClass: ["inetOrgPerson", "person", "top"], // multi-valued sorted
    });
    expect(out.userPassword).toBeUndefined();
    expect(out.entryUUID).toBeUndefined();
  });

  it("matches allowlist attributes case-insensitively, outputs the declared name", () => {
    const out = projectLdapEntry({ dn: "d", SAMAccountName: "jdoe" }, ["samaccountname"]);
    expect(out).toEqual({ dn: "d", samaccountname: "jdoe" });
  });

  it("masks a volatile attribute's value to a token (asserts presence), case-insensitively", () => {
    const out = projectLdapEntry(
      { dn: "d", uid: "jdoe", "x-externalRef": "15/15-abc/deadbeef" },
      ["uid", "x-externalRef"],
      ["X-externalRef"],
    );
    expect(out).toEqual({ dn: "d", uid: "jdoe", "x-externalRef": "<dynamic>" });
  });

  it("without an allowlist keeps everything except the volatile/secret denylist", () => {
    const out = projectLdapEntry(RAW);
    expect(out).toEqual({
      dn: "uid=jdoe,ou=Users,ou=share,dc=example,dc=com",
      uid: "jdoe",
      cn: "John Doe",
      sn: "Doe",
      mail: "jdoe@example.com",
      objectClass: ["inetOrgPerson", "person", "top"],
    });
    // userPassword / entryUUID / createTimestamp stripped as volatile.
  });

  it("always keeps the dn and sorts multi-valued attributes", () => {
    const out = projectLdapEntry({ dn: "x", memberOf: ["cn=z", "cn=a", "cn=m"] });
    expect(out).toEqual({ dn: "x", memberOf: ["cn=a", "cn=m", "cn=z"] });
  });

  it("omits a declared attribute the entry does not have", () => {
    const out = projectLdapEntry({ dn: "x", uid: "jdoe" }, ["uid", "telephoneNumber"]);
    expect(out).toEqual({ dn: "x", uid: "jdoe" });
  });

  it("omits an attribute present as an empty array (ldapts' absent representation)", () => {
    // ldapts returns a requested-but-absent attribute as []; that is absent, not a
    // present empty value — it must not survive into the projection.
    const out = projectLdapEntry({ dn: "x", uid: "jdoe", "x-externalRef": [] }, ["uid", "x-externalRef"]);
    expect(out).toEqual({ dn: "x", uid: "jdoe" });
    // same without an allowlist
    expect(projectLdapEntry({ dn: "x", uid: "jdoe", "x-externalRef": [] })).toEqual({ dn: "x", uid: "jdoe" });
  });
});
