import { describe, expect, it } from "vitest";
import type { LdapSystemConfig } from "../scenario/suite.ts";
import { entryDn, encodePassword, rowToEntry } from "./ldapSource.ts";

const ad: LdapSystemConfig = {
  url: "ldap://localhost:10389",
  bind: { dn: "Administrator@example", passwordEnv: "IDW_LDAP_AD_PASSWORD" },
  containerDn: "ou=Users,dc=example,dc=com",
  rdnAttr: "cn",
  objectClasses: ["user"],
  baseAttrs: { userAccountControl: "544" },
  password: { from: "pw", to: "unicodePwd" },
};

describe("ldapSource transforms", () => {
  it("builds the entry DN from rdnAttr + row's RDN value + containerDn", () => {
    expect(entryDn(ad, "idwtest-001")).toBe("cn=idwtest-001,ou=Users,dc=example,dc=com");
  });

  it("escapes RDN special characters", () => {
    expect(entryDn(ad, "a,b+c")).toBe("cn=a\\,b\\+c,ou=Users,dc=example,dc=com");
  });

  it("encodes an AD password as quoted UTF-16LE (matches Samba init.ldif)", () => {
    expect(encodePassword("p@ssw0rd").toString("base64")).toBe("IgBwAEAAcwBzAHcAMAByAGQAIgA=");
  });

  it("maps a row to entry attrs: objectClass + baseAttrs + row keys + rdn + encoded pw", () => {
    const e = rowToEntry(ad, {
      cn: "idwtest-001",
      sAMAccountName: "idwtest-001",
      personid: "9990001",
      "ext-Department": "TEST",
      displayName: "Test One",
      pw: "p@ssw0rd",
    });
    expect(e.objectClass).toEqual(["user"]);
    expect(e.userAccountControl).toBe("544");
    expect(e.cn).toBe("idwtest-001");
    expect(e.personid).toBe("9990001");
    expect(e["ext-Department"]).toBe("TEST");
    expect(e.pw).toBeUndefined(); // the password column is not copied verbatim
    expect(Buffer.isBuffer(e.unicodePwd)).toBe(true);
    expect((e.unicodePwd as Buffer).toString("utf16le")).toBe('"p@ssw0rd"');
  });

  it("omits empty row values but keeps the RDN attribute", () => {
    const e = rowToEntry(ad, { cn: "x", sAMAccountName: "", personid: "1" });
    expect(e.sAMAccountName).toBeUndefined();
    expect(e.cn).toBe("x");
  });
});
