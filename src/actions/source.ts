/**
 * actions — source dispatch. Routes the uniform source operations (reset/set/add/
 * replace/remove) to the adapter for the system's protocol (csv | ldap | scim |
 * keycloak), so the mutate step and the runner stay protocol-agnostic. Each adapter
 * exposes the same five functions with the same signatures; this picks one by the
 * system's discriminating key. (The keycloak adapter throws for reset/set — a shared
 * realm has no safe blanket wipe; see keycloakSource.)
 */
import type { SystemSpec } from "../scenario/suite.ts";
import type { CsvRow } from "./csvSource.ts";
import * as csv from "./csvSource.ts";
import * as ldap from "./ldapSource.ts";
import * as scim from "./scimSource.ts";
import * as keycloak from "./keycloakSource.ts";

function adapter(system: SystemSpec) {
  return system.scim ? scim : system.ldap ? ldap : system.keycloak ? keycloak : csv;
}

export function resetSource(hostDir: string, system: SystemSpec): Promise<void> {
  return adapter(system).resetSource(hostDir, system);
}
export function setSource(hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  return adapter(system).setSource(hostDir, system, rows);
}
export function addSourceRows(hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  return adapter(system).addSourceRows(hostDir, system, rows);
}
export function replaceSourceRows(hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  return adapter(system).replaceSourceRows(hostDir, system, rows);
}
export function removeSourceRows(hostDir: string, system: SystemSpec, ids: string[]): Promise<void> {
  return adapter(system).removeSourceRows(hostDir, system, ids);
}
