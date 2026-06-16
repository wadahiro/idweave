/**
 * Runner adapter for the independent Keycloak example.
 *
 * Unlike the midPoint examples, there is NO midPoint here: these scenarios drive
 * `login-ui` against Keycloak's own consoles (suite gui.logins + GUI_BASE_URL =
 * the Keycloak origin) and CRUD/assert a realm user over admin REST; `rest`
 * (midPoint) is never called, so this needs no midPoint and no snapshot restore.
 * Run via `make test EXAMPLE=keycloak`.
 */
import { describe, test, beforeAll } from "vitest";
import { loadConfig } from "../../src/config.ts";
import { MidpointRest } from "../../src/clients/midpointRest.ts";
import { loadScenarios } from "../../src/scenario/loader.ts";
import { loadSuite } from "../../src/scenario/suite.ts";
import { runScenario } from "../../src/scenario/runner.ts";
import { reportFailure } from "../../src/scenario/failure.ts";
import { KeycloakAdmin } from "../../src/clients/keycloakAdmin.ts";
import { pollUntil } from "../../src/poll.ts";

const cfg = loadConfig();
// Constructed but unused: a login-only scenario never reaches a REST oracle/reset.
const rest = new MidpointRest(cfg.midpoint);
const suite = await loadSuite(cfg.scenariosDir);
const scenarios = await loadScenarios(cfg.scenariosDir);

beforeAll(async () => {
  if (!cfg.idpAdmin) {
    throw new Error("Keycloak admin connection not set — export KEYCLOAK_ADMIN_* (see examples/keycloak/.env.example).");
  }
  // Wait until Keycloak has imported the realm and is serving the admin REST API.
  const kc = new KeycloakAdmin(cfg.idpAdmin);
  await pollUntil(
    () => kc.findByUsername("__readiness_probe__").then(() => true).catch(() => false),
    (ok) => ok,
    cfg.poll,
    "Keycloak admin REST to become ready",
  );
});

describe("keycloak console logins", () => {
  for (const loaded of scenarios) {
    const { id, requirement } = loaded.scenario;
    test(`${id} [${requirement}]`, async () => {
      try {
        await runScenario(loaded, { rest, cfg, suite, now: () => Date.now() });
      } catch (err) {
        reportFailure(err);
        throw err;
      }
    });
  }
});
