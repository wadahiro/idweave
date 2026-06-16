/**
 * clients — build the midPoint `executeScript` (bulk-action) Groovy that reads, lists,
 * AND drives (create/modify/delete) a RESOURCE OBJECT through the connector WITHOUT
 * persisting a shadow.
 *
 * Why a script (not a shadow REST call): the public `ProvisioningService` always
 * persists/updates a shadow, which would mutate the system under test. The one-level
 * lower `ResourceObjectConverter` uses the resource's stored connector config but writes
 * NO shadow to the repository (verified against source AND empirically: every op shows a
 * 0 shadow-count delta). It is internal API, reached from a Groovy bulk action via
 * `SpringApplicationContextHolder.getBean(...)` (unsandboxed, like clients/cacheClear.ts).
 *
 * Addressing — an object is matched by the connector identifier the `identifierAttr`
 * names: `__uid__` (the PRIMARY identifier, e.g. LDAP entryUUID / a CSV key column),
 * `__name__` (the SECONDARY identifier, e.g. an LDAP DN; absent on some connectors), or a
 * regular attribute name. A list (no identifier) returns every object of the class.
 *
 * INTERNAL, VERSION-SPECIFIC API — the `resourceobjects` layer was refactored across
 * majors, so each is a {@link Dialect} (all verified live, 0 shadow delta): 4.4/4.8/4.10
 * use `resourceobjects.ResourceObjectConverter` + a `ResourceObjectHandler` search (differing
 * in context construction, found wrapping, attribute accessor, and a `prism|shadow|wrapped`
 * write shape); 4.0 uses the older `provisioning.impl` converter + a `ResultHandler`.
 */

const INSTANCE_NS = "http://midpoint.evolveum.com/xml/ns/public/resource/instance-3";

/** Markers the write/read scripts return. */
export const ABSENT_MARKER = "__IDW_ABSENT__";
export const NOT_FOUND_MARKER = "__IDW_NOTFOUND__";
/** `identifierAttr` tokens that select a connector identifier instead of a regular attribute. */
export const UID_ATTR = "__uid__";
export const NAME_ATTR = "__name__";

/** Local part of a QName-ish objectClass value: `ri:AccountObjectClass` -> `AccountObjectClass`. */
export function objectClassLocalName(objectClass: string): string {
  const afterBrace = objectClass.includes("}") ? objectClass.slice(objectClass.lastIndexOf("}") + 1) : objectClass;
  return afterBrace.includes(":") ? afterBrace.slice(afterBrace.lastIndexOf(":") + 1) : afterBrace;
}

/** Escape a value for embedding inside a Groovy double-quoted string literal. */
function groovyStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
}

/** The write shape of a major: a bare PrismObject (4.4/4.0), a bare ShadowType (4.8), or wrapped + policy (4.10). */
type WriteKind = "prism" | "shadow" | "wrapped";

interface Dialect {
  holder: string;
  converterClass: string;
  handlerType: string;
  searchTail: string;
  ctxAndOd: string;
  initialize: boolean;
  foundBean: string;
  attrMethod: string;
  writeKind: WriteKind;
}

const HOLDER_MODEL = "com.evolveum.midpoint.model.impl.expr.SpringApplicationContextHolder";
const HOLDER_WF = "com.evolveum.midpoint.wf.impl.processes.common.SpringApplicationContextHolder";
const CONVERTER_RO = "com.evolveum.midpoint.provisioning.impl.resourceobjects.ResourceObjectConverter";
const CONVERTER_40 = "com.evolveum.midpoint.provisioning.impl.ResourceObjectConverter";
const HANDLER_RO = "com.evolveum.midpoint.provisioning.impl.resourceobjects.ResourceObjectHandler";
const HANDLER_40 = "com.evolveum.midpoint.schema.ResultHandler";

const CTX_BULK =
  `def cf = ac.getBean(com.evolveum.midpoint.provisioning.impl.ProvisioningContextFactory.class)\n` +
  `def coords = com.evolveum.midpoint.schema.ResourceOperationCoordinates.ofObjectClass(RES, OC)\n` +
  `def ctx = cf.createForBulkOperation(coords, new com.evolveum.midpoint.provisioning.api.ProvisioningOperationContext(), task, result)\n` +
  `def od = ctx.getObjectDefinitionRequired()`;
const CTX_RSD =
  `def cf = ac.getBean(com.evolveum.midpoint.provisioning.impl.ProvisioningContextFactory.class)\n` +
  `def ctx = cf.create(new com.evolveum.midpoint.schema.ResourceShadowDiscriminator(RES, OC), task, result)\n` +
  `def od = ctx.getObjectClassDefinition()`;
const CTX_40 =
  `def rm = ac.getBean(com.evolveum.midpoint.provisioning.impl.ResourceManager.class)\n` +
  `def ctx = new com.evolveum.midpoint.provisioning.impl.ProvisioningContext(rm, result)\n` +
  `ctx.setResourceOid(RES); ctx.setTask(task)\n` +
  `def _rsd = new com.evolveum.midpoint.schema.ResourceShadowDiscriminator(RES); _rsd.setObjectClass(OC); ctx.setShadowCoordinates(_rsd)\n` +
  `def od = ctx.getObjectClassDefinition()`;

function dialectFor(version: string): Dialect {
  const major = version.split(".").slice(0, 2).join(".");
  const ro = { converterClass: CONVERTER_RO, handlerType: HANDLER_RO, searchTail: ", null, false, null, result" };
  switch (major) {
    case "4.10":
      return { ...ro, holder: HOLDER_MODEL, ctxAndOd: CTX_BULK, initialize: true, foundBean: ".getResourceObject().getBean()", attrMethod: "getSimpleAttributes", writeKind: "wrapped" };
    case "4.8":
      return { ...ro, holder: HOLDER_MODEL, ctxAndOd: CTX_BULK, initialize: true, foundBean: ".getResourceObject()", attrMethod: "getAttributes", writeKind: "shadow" };
    case "4.4":
      return { ...ro, holder: HOLDER_WF, ctxAndOd: CTX_RSD, initialize: false, foundBean: ".getResourceObject()", attrMethod: "getAttributes", writeKind: "prism" };
    case "4.0":
      return { holder: HOLDER_WF, converterClass: CONVERTER_40, handlerType: HANDLER_40, searchTail: ", null, false, result", ctxAndOd: CTX_40, initialize: false, foundBean: "", attrMethod: "getAttributes", writeKind: "prism" };
    default:
      throw new Error(
        `resource (connector-mediated) target is not yet supported on midPoint ${version} — ` +
          `add a dialect (4.0/4.4/4.8/4.10 supported).`,
      );
  }
}

/** Shared prelude: imports, beans, ctx/od (per dialect), and a `toAttrMap` closure. */
function prelude(d: Dialect, resourceOid: string, objectClass: string): string {
  const ocLocal = groovyStr(objectClassLocalName(objectClass));
  const wrappedImports = d.writeKind === "wrapped"
    ? `import com.evolveum.midpoint.xml.ns._public.common.common_3.ShadowLifecycleStateType\n`
    : "";
  return `
import groovy.json.JsonOutput
import javax.xml.namespace.QName
import com.evolveum.midpoint.schema.result.OperationResult
import com.evolveum.midpoint.schema.util.ShadowUtil
import com.evolveum.midpoint.xml.ns._public.common.common_3.ShadowType
import com.evolveum.midpoint.prism.path.ItemPath
${wrappedImports}def NS = "${INSTANCE_NS}"
def RES = "${groovyStr(resourceOid)}"
def OC = new QName(NS, "${ocLocal}")
def pc = midpoint.prismContext
def ac = ${d.holder}.getApplicationContext()
def converter = ac.getBean(${d.converterClass}.class)
def task = midpoint.getCurrentTask()
def result = new OperationResult("idwResourceOp")
${d.ctxAndOd}
def toAttrMap = { bean ->
  def m = [:]
  ShadowUtil.${d.attrMethod}(bean).each { a -> m[a.getElementName().getLocalPart()] = a.getRealValues().collect { it.toString() } }
  return m
}`.trim();
}

/** A search over all objects of the class, invoking `onBean` (Groovy using `bean`) per object. */
function searchBlock(d: Dialect, onBean: string): string {
  const init = d.initialize ? "found.initialize(task, res)\n    " : "";
  return `def handler = { found, res ->
    ${init}def bean = found${d.foundBean}
    ${onBean}
    return true
  } as ${d.handlerType}
  converter.searchResourceObjects(ctx, handler${d.searchTail})`;
}

/** Groovy boolean (over `bean`) that matches the object addressed by `identifierAttr` = `identifier`. */
function matchExpr(d: Dialect, identifierAttr: string, identifier: string): string {
  const v = groovyStr(identifier);
  if (identifierAttr === UID_ATTR) {
    return `ShadowUtil.getPrimaryIdentifiers(bean).any { _i -> _i.getRealValues().any { _w -> _w.toString() == "${v}" } }`;
  }
  if (identifierAttr === NAME_ATTR) {
    return `ShadowUtil.getSecondaryIdentifiers(bean).any { _i -> _i.getRealValues().any { _w -> _w.toString() == "${v}" } }`;
  }
  return `(ShadowUtil.${d.attrMethod}(bean).find { _a -> _a.getElementName().getLocalPart() == "${groovyStr(identifierAttr)}" }?.getRealValues()?.collect { _w -> _w.toString() } ?: []).contains("${v}")`;
}

/** Wrap Groovy code in the executeScript envelope (forWholeInput so a standalone body runs once). */
function envelope(groovy: string): string {
  return (
    `<s:executeScript xmlns:s="http://midpoint.evolveum.com/xml/ns/public/model/scripting-3"` +
    ` xmlns:c="http://midpoint.evolveum.com/xml/ns/public/common/common-3"` +
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <s:action>\n    <s:type>execute-script</s:type>\n` +
    `    <s:parameter><s:name>script</s:name>` +
    `<c:value xsi:type="c:ScriptExpressionEvaluatorType"><c:code><![CDATA[\n${groovy}\n]]></c:code></c:value>` +
    `</s:parameter>\n` +
    `    <s:parameter><s:name>forWholeInput</s:name><c:value>true</c:value></s:parameter>\n` +
    `  </s:action>\n</s:executeScript>`
  );
}

const assemble = (d: Dialect, resourceOid: string, objectClass: string, body: string): string =>
  envelope(prelude(d, resourceOid, objectClass) + "\n" + body.trim());

/** Groovy that locates the addressed object into `_b` (or returns NOT_FOUND_MARKER). */
function locateInto(d: Dialect, identifierAttr: string, identifier: string): string {
  return `def _b = null
${searchBlock(d, `if (${matchExpr(d, identifierAttr, identifier)}) _b = bean`)}
if (_b == null) return "${NOT_FOUND_MARKER}"`;
}

/** The 4.10 RepoShadow + effective-policy + lifecycle prep before a modify/delete (else empty). */
function wrappedExistingPrep(kind: WriteKind): string {
  if (kind !== "wrapped") return "";
  return `_b.setShadowLifecycleState(ShadowLifecycleStateType.LIVE)
def _repo = com.evolveum.midpoint.provisioning.impl.RepoShadow.of(_b, null, ctx.getResource())
ctx.computeAndUpdateEffectiveMarksAndPolicies(_repo, com.evolveum.midpoint.provisioning.impl.shadows.RepoShadowWithState.ShadowState.EXISTING, result)`;
}

interface Common {
  version: string;
  resourceOid: string;
  objectClass: string;
}

/** Read the object addressed by `identifierAttr`=`identifier`; returns its attributes as JSON, or ABSENT_MARKER. */
export function buildResourceReadScript(opts: Common & { identifierAttr: string; identifier: string }): string {
  const d = dialectFor(opts.version);
  const body = `
def _b = null
${searchBlock(d, `if (${matchExpr(d, opts.identifierAttr, opts.identifier)}) _b = bean`)}
return _b == null ? "${ABSENT_MARKER}" : JsonOutput.toJson(toAttrMap(_b))`;
  return assemble(d, opts.resourceOid, opts.objectClass, body);
}

/** List EVERY object of the class on the target; returns a JSON array of attribute maps. */
export function buildResourceListScript(opts: Common): string {
  const d = dialectFor(opts.version);
  const body = `
def _out = []
${searchBlock(d, "_out << toAttrMap(bean)")}
return JsonOutput.toJson(_out)`;
  return assemble(d, opts.resourceOid, opts.objectClass, body);
}

/** Create an object on the target through the connector. `attributes` is attr -> values. */
export function buildResourceCreateScript(opts: Common & { attributes: Record<string, string[]> }): string {
  const d = dialectFor(opts.version);
  const blank = d.writeKind === "prism"
    ? `def _obj = pc.createObject(ShadowType.class)\n_obj.asObjectable().setObjectClass(OC)`
    : `def _obj = new ShadowType()\n_obj.setObjectClass(OC)`;
  const setAttrs = Object.entries(opts.attributes)
    .map(([n, vals]) => `_a = od.findAttributeDefinition(new QName(NS, "${groovyStr(n)}")).instantiate(); [${vals.map((v) => `"${groovyStr(v)}"`).join(", ")}].each { _a.addRealValue(it) }; _cont.add(_a)`)
    .join("\n");
  const addCall = d.writeKind === "wrapped"
    ? `def _ros = com.evolveum.midpoint.provisioning.impl.resourceobjects.ResourceObjectShadow.fromBean(_obj, false, od)
ctx.computeAndUpdateEffectiveMarksAndPolicies(_ros, com.evolveum.midpoint.provisioning.impl.shadows.RepoShadowWithState.ShadowState.TO_BE_CREATED, result)
converter.addResourceObject(ctx, _ros, null, null, false, result)`
    : `converter.addResourceObject(ctx, _obj, null, null, false, result)`;
  const body = `
${blank}
def _cont = ShadowUtil.getOrCreateAttributesContainer(_obj, od)
def _a
${setAttrs}
${addCall}
return "CREATED"`;
  return assemble(d, opts.resourceOid, opts.objectClass, body);
}

/**
 * Modify (replace) attributes on the addressed object: `replaces` is attr -> values (an
 * empty array CLEARS the attribute). Returns "MODIFIED" or NOT_FOUND_MARKER.
 */
export function buildResourceModifyScript(
  opts: Common & { identifierAttr: string; identifier: string; replaces: Record<string, string[]> },
): string {
  const d = dialectFor(opts.version);
  const deltas = Object.entries(opts.replaces)
    .map(([n, vals]) => {
      const qn = `new QName(NS, "${groovyStr(n)}")`;
      const path = `ItemPath.create(ShadowType.F_ATTRIBUTES, ${qn})`;
      if (d.writeKind === "wrapped") {
        return `_d = od.findAttributeDefinition(${qn}).createEmptyDelta(${path})\n_d.setRealValuesToReplace(${vals.map((v) => `"${groovyStr(v)}"`).join(", ")})\n_deltas.add(_d)`;
      }
      const wrappedVals = `[${vals.map((v) => `pc.itemFactory().createPropertyValue("${groovyStr(v)}")`).join(", ")}]`;
      return `_d = pc.deltaFactory().property().create(${path}, od.findAttributeDefinition(${qn}))\n_d.setValuesToReplace(${wrappedVals})\n_deltas.add(_d)`;
    })
    .join("\n");
  const target = d.writeKind === "wrapped" ? "_repo" : "_b";
  const body = `
${locateInto(d, opts.identifierAttr, opts.identifier)}
${wrappedExistingPrep(d.writeKind)}
def _deltas = []
def _d
${deltas}
converter.modifyResourceObject(ctx, ${target}, null, null, _deltas, null, result)
return "MODIFIED"`;
  return assemble(d, opts.resourceOid, opts.objectClass, body);
}

/** Fully-qualified focus class per type — for the clear-focus repo read/delete. */
const FOCUS_CLASS: Record<string, string> = {
  user: "com.evolveum.midpoint.xml.ns._public.common.common_3.UserType",
  role: "com.evolveum.midpoint.xml.ns._public.common.common_3.RoleType",
  org: "com.evolveum.midpoint.xml.ns._public.common.common_3.OrgType",
  service: "com.evolveum.midpoint.xml.ns._public.common.common_3.ServiceType",
};

/** Marker a clear-focus returns when the focus is `indestructible` (refused). */
export const INDESTRUCTIBLE_MARKER = "__IDW_INDESTRUCTIBLE__";

/**
 * Build the clear-focus bulk action: in ONE round-trip, force-remove a focus AND every
 * account it provisioned. For each `linkRef` shadow it calls the PUBLIC
 * `ProvisioningService.deleteObject(force)` — which deletes the real resource object
 * through the connector keyed by the shadow's primary identifier (no resource scan, and
 * BELOW the model layer so no deletion-approval workflow), then removes the shadow. A
 * protected/read-only resource object (e.g. an authoritative SOURCE account) raises a
 * SecurityViolationException — caught, so we just repo-delete that shadow (the external
 * source record is left intact). Finally the focus is repo-deleted. A focus the
 * deployment marked `indestructible` is REFUSED (returns INDESTRUCTIBLE_MARKER) — a guard
 * against force-removing a baseline object matched only by name.
 *
 * Only the application-context HOLDER differs per major (model.impl vs wf.impl) — the
 * ProvisioningService/RepositoryService APIs are version-stable, so no per-major dialect.
 * Returns `PURGED:<n>` (n = accounts the connector deleted), ABSENT (focus gone), or
 * INDESTRUCTIBLE_MARKER (refused).
 */
export function buildPurgeFocusScript(opts: { version: string; focusType: string; focusOid: string }): string {
  const holder = dialectFor(opts.version).holder;
  const fclass = FOCUS_CLASS[opts.focusType];
  if (!fclass) throw new Error(`clear-focus: unsupported focus type "${opts.focusType}"`);
  const groovy = `
import com.evolveum.midpoint.schema.result.OperationResult
import com.evolveum.midpoint.xml.ns._public.common.common_3.ShadowType
import com.evolveum.midpoint.provisioning.api.ProvisioningService
import com.evolveum.midpoint.provisioning.api.ProvisioningOperationOptions
import com.evolveum.midpoint.repo.api.RepositoryService
def ac = ${holder}.getApplicationContext()
def prov = ac.getBean(ProvisioningService.class)
def repo = ac.getBean("repositoryService", RepositoryService.class)
def task = midpoint.getCurrentTask()
def result = new OperationResult("idwCleanupFocus")
def focus
try { focus = repo.getObject(${fclass}.class, "${groovyStr(opts.focusOid)}", null, result).asObjectable() }
catch (e) { return "${ABSENT_MARKER}" }
if (Boolean.TRUE.equals(focus.isIndestructible())) return "${INDESTRUCTIBLE_MARKER}"
int n = 0
for (link in focus.getLinkRef()) {
  def soid = link.getOid()
  if (soid == null) continue
  def r = new OperationResult("idwCleanupShadow")
  try {
    prov.deleteObject(ShadowType.class, soid, ProvisioningOperationOptions.createForce(true), null, task, r)
    n++
  } catch (Throwable t) {
    // Protected/read-only (e.g. a source) or already gone — drop the shadow only, leaving
    // the external record. Best-effort: a missing shadow is fine.
    try { repo.deleteObject(ShadowType.class, soid, r) } catch (ignored) {}
  }
}
repo.deleteObject(${fclass}.class, focus.getOid(), result)
return "PURGED:" + n`;
  return envelope(groovy.trim());
}

/** Delete the addressed object through the connector. Returns "DELETED" or NOT_FOUND_MARKER. */
export function buildResourceDeleteScript(opts: Common & { identifierAttr: string; identifier: string }): string {
  const d = dialectFor(opts.version);
  const target = d.writeKind === "wrapped" ? "_repo" : "_b";
  const body = `
${locateInto(d, opts.identifierAttr, opts.identifier)}
${wrappedExistingPrep(d.writeKind)}
converter.deleteResourceObject(ctx, ${target}, null, null, result)
return "DELETED"`;
  return assemble(d, opts.resourceOid, opts.objectClass, body);
}
