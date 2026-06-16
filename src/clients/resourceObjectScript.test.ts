/**
 * Unit: the resource-object executeScript builders — that each addressing mode and each
 * version dialect emit the expected Groovy markers. No midPoint.
 */
import { describe, it, expect } from "vitest";
import {
  buildResourceReadScript,
  buildResourceListScript,
  buildResourceCreateScript,
  buildResourceModifyScript,
  buildResourceDeleteScript,
  buildPurgeFocusScript,
  objectClassLocalName,
} from "./resourceObjectScript.ts";

const base = { version: "4.10", resourceOid: "r-oid", objectClass: "ri:AccountObjectClass" };

describe("objectClassLocalName", () => {
  it("strips a prefix or namespace", () => {
    expect(objectClassLocalName("ri:AccountObjectClass")).toBe("AccountObjectClass");
    expect(objectClassLocalName("{ns}GroupObjectClass")).toBe("GroupObjectClass");
  });
});

describe("addressing mode -> match expression", () => {
  it("__uid__ matches the PRIMARY identifier", () => {
    const xml = buildResourceReadScript({ ...base, identifierAttr: "__uid__", identifier: "u1" });
    expect(xml).toContain("getPrimaryIdentifiers(bean)");
    expect(xml).toContain('"u1"');
  });
  it("__name__ matches the SECONDARY identifier", () => {
    const xml = buildResourceReadScript({ ...base, identifierAttr: "__name__", identifier: "cn=x" });
    expect(xml).toContain("getSecondaryIdentifiers(bean)");
  });
  it("a regular attribute matches by local name via the dialect accessor", () => {
    const xml = buildResourceReadScript({ ...base, identifierAttr: "username", identifier: "jdoe" });
    expect(xml).toContain("getSimpleAttributes(bean)"); // 4.10 accessor
    expect(xml).toContain('getElementName().getLocalPart() == "username"');
  });
  it("list returns every object (no identifier filter)", () => {
    const xml = buildResourceListScript(base);
    expect(xml).toContain("_out << toAttrMap(bean)");
    expect(xml).not.toContain("getPrimaryIdentifiers");
  });
});

describe("version dialects", () => {
  it("4.10 create wraps + computes effective policy", () => {
    const xml = buildResourceCreateScript({ ...base, attributes: { username: ["x"] } });
    expect(xml).toContain("model.impl.expr.SpringApplicationContextHolder");
    expect(xml).toContain("ResourceObjectShadow.fromBean");
    expect(xml).toContain("computeAndUpdateEffectiveMarksAndPolicies");
  });
  it("4.8 create takes a plain ShadowType (no policy/wrapper)", () => {
    const xml = buildResourceCreateScript({ version: "4.8", resourceOid: "r", objectClass: "ri:AccountObjectClass", attributes: { username: ["x"] } });
    expect(xml).toContain("addResourceObject(ctx, _obj");
    expect(xml).not.toContain("computeAndUpdateEffectiveMarksAndPolicies");
  });
  it("4.4 builds a PrismObject + create(ResourceShadowDiscriminator)", () => {
    const xml = buildResourceCreateScript({ version: "4.4", resourceOid: "r", objectClass: "ri:AccountObjectClass", attributes: { username: ["x"] } });
    expect(xml).toContain("wf.impl.processes.common.SpringApplicationContextHolder");
    expect(xml).toContain("pc.createObject(ShadowType.class)");
    expect(xml).toContain("ResourceShadowDiscriminator");
  });
  it("4.0 uses the provisioning.impl converter + ResultHandler + manual context", () => {
    const xml = buildResourceReadScript({ version: "4.0", resourceOid: "r", objectClass: "ri:AccountObjectClass", identifierAttr: "username", identifier: "x" });
    expect(xml).toContain("provisioning.impl.ResourceObjectConverter");
    expect(xml).toContain("com.evolveum.midpoint.schema.ResultHandler");
    expect(xml).toContain("new com.evolveum.midpoint.provisioning.impl.ProvisioningContext(rm, result)");
  });
  it("throws for an unsupported major", () => {
    expect(() => buildResourceReadScript({ version: "3.9", resourceOid: "r", objectClass: "ri:x", identifierAttr: "a", identifier: "b" })).toThrow(/not yet supported/);
  });
});

describe("modify/delete", () => {
  it("4.10 modify uses RepoShadow + setRealValuesToReplace", () => {
    const xml = buildResourceModifyScript({ ...base, identifierAttr: "username", identifier: "x", replaces: { mail: ["a@b"] } });
    expect(xml).toContain("RepoShadow.of");
    expect(xml).toContain("setRealValuesToReplace");
  });
  it("4.8 modify uses the prism delta factory + setValuesToReplace (no RepoShadow)", () => {
    const xml = buildResourceModifyScript({ version: "4.8", resourceOid: "r", objectClass: "ri:AccountObjectClass", identifierAttr: "username", identifier: "x", replaces: { mail: ["a@b"] } });
    expect(xml).toContain("setValuesToReplace");
    expect(xml).not.toContain("RepoShadow.of");
  });
  it("delete addresses then deletes", () => {
    const xml = buildResourceDeleteScript({ ...base, identifierAttr: "__uid__", identifier: "u1" });
    expect(xml).toContain("deleteResourceObject(ctx,");
    expect(xml).toContain("getPrimaryIdentifiers(bean)");
  });
});

describe("buildPurgeFocusScript (clear-focus)", () => {
  it("force-deletes each linked account via ProvisioningService, falls back to repo, refuses indestructible, deletes the focus", () => {
    const xml = buildPurgeFocusScript({ version: "4.10", focusType: "user", focusOid: "f-oid" });
    expect(xml).toContain("prov.deleteObject(ShadowType.class, soid, ProvisioningOperationOptions.createForce(true)");
    expect(xml).toContain("repo.deleteObject(ShadowType.class, soid"); // protected/source fallback
    expect(xml).toContain("isIndestructible()"); // baseline guard
    expect(xml).toContain('repo.getObject(com.evolveum.midpoint.xml.ns._public.common.common_3.UserType.class, "f-oid"');
    expect(xml).toContain('return "PURGED:" + n');
  });

  it("selects the focus class per type and the holder per major", () => {
    expect(buildPurgeFocusScript({ version: "4.10", focusType: "role", focusOid: "r" })).toContain("common_3.RoleType.class");
    expect(buildPurgeFocusScript({ version: "4.8", focusType: "user", focusOid: "x" })).toContain("model.impl.expr.SpringApplicationContextHolder");
    expect(buildPurgeFocusScript({ version: "4.4", focusType: "user", focusOid: "x" })).toContain("wf.impl.processes.common.SpringApplicationContextHolder");
  });

  it("rejects an unsupported focus type", () => {
    expect(() => buildPurgeFocusScript({ version: "4.10", focusType: "widget", focusOid: "x" })).toThrow(/unsupported focus type/);
  });
});
