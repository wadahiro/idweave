# Outer orchestrator (brief §4/§7): owns heavy infra (up/restore) and sequences
# up -> ready -> config import -> tests -> report. No test code touches docker.

# Two independent knobs; the canonical form is explicit, e.g.
#   make all EXAMPLE=midpoint-basic VER=4.4
# EXAMPLE picks the suite under examples/ (midpoint-basic | midpoint-advanced |
# keycloak). VER is the midPoint major (4.0/4.4/4.8/4.10). TODAY only midpoint-basic
# varies by VER — ONE scenario tree across all majors; midpoint-advanced pins midPoint
# 4.10 and keycloak has no midPoint, so they ignore VER for now (a future midPoint
# example could honor it). Defaults below keep the bare `make test` working.
EXAMPLE ?= midpoint-basic
VER     ?= 4.10

ifeq ($(EXAMPLE),keycloak)
  # Independent Keycloak SUT: its own consoles + admin REST; no midPoint.
  EX          := examples/keycloak
  INFRA_DIR   := $(EX)/infra
  REPORTS     := $(EX)/reports
  PORT        := 8090
  IS_MIDPOINT := no
  COMPOSE     := docker compose -p idweave-keycloak -f $(INFRA_DIR)/docker-compose.yml
  export COMPOSE_PROJECT          := idweave-keycloak
  export COMPOSE_FILES            := $(INFRA_DIR)/docker-compose.yml
  export GUI_BASE_URL             := http://localhost:$(PORT)
  export GUI_LOGIN_TIMEOUT_MS     := 15000
  export KEYCLOAK_ADMIN_URL       := http://localhost:$(PORT)
  export KEYCLOAK_ADMIN_REALM     := idweave
  export KEYCLOAK_ADMIN_CLIENT_ID := idweave-admin
  export KEYCLOAK_ADMIN_SECRET    := idweave-admin-secret
else ifeq ($(EXAMPLE),midpoint-advanced)
  # midPoint 4.10 fanning out to LDAP + SCIM (flat, single-version).
  EX          := examples/midpoint-advanced
  INFRA_DIR   := $(EX)/infra
  CONFIG      := $(EX)/midpoint-config
  CSV_DIR     := $(EX)/infra/data/csv
  REPORTS     := $(EX)/reports
  PORT        := 8112
  ADMINPW     := Test5ecr3t
  IS_MIDPOINT := yes
  COMPOSE     := docker compose -p idweave-advanced -f $(INFRA_DIR)/docker-compose.yml -f $(INFRA_DIR)/compose.test.yml
  export COMPOSE_PROJECT    := idweave-advanced
  export COMPOSE_FILES      := $(INFRA_DIR)/docker-compose.yml,$(INFRA_DIR)/compose.test.yml
  export GUI_BASE_URL       := http://localhost:$(PORT)/midpoint
  # Direct LDAP + SCIM assert/CRUD: only the secrets come from env (URLs/bind-DN
  # live in suite.yaml; container-internal hosts are the compose service names).
  export LDAP_BIND_PASSWORD := adminpassword
  export SCIM_TOKEN         := advanced-scim-token
else
  # midpoint-basic: ONE scenario tree across midPoint majors, selected by VER, which
  # picks the infra compose, post-init config, GUI page objects (MP_VERSION), and the
  # expected/<ver>/ tree (EXPECTED_VERSION).
  EX          := examples/midpoint-basic
  VERID       := $(subst .,,$(VER))   # compose project names can't contain dots (4.10->410)
  INFRA_DIR   := $(EX)/infra/$(VER)
  CONFIG      := $(EX)/midpoint-config/$(VER)
  # The CSV source/target files are external-system data, version-independent and
  # driven one version at a time — so they live in ONE shared dir, not per version.
  CSV_DIR     := $(EX)/infra/data/csv
  REPORTS     := $(EX)/reports/$(VER)
  IS_MIDPOINT := yes
  # Host port per version (container is always 8080); keep in sync with each
  # infra/<ver>/docker-compose.yml port mapping.
  PORT_4_10 := 8080
  PORT_4_8  := 8108
  PORT_4_4  := 8104
  PORT_4_0  := 8100
  PORT      := $(or $(PORT_$(subst .,_,$(VER))),8080)
  # Admin password. 4.8/4.10 honor MP_SET_midpoint_administrator_initialPassword
  # (=Test5ecr3t, baked in their compose); 4.0 and 4.4 parse but do NOT apply it, so
  # their administrator keeps the initial-object default 5ecr3t.
  ADMINPW_4_4 := 5ecr3t
  ADMINPW_4_0 := 5ecr3t
  ADMINPW   := $(or $(ADMINPW_$(subst .,_,$(VER))),Test5ecr3t)
  COMPOSE   := docker compose -p idweave-$(VERID) -f $(INFRA_DIR)/docker-compose.yml -f $(INFRA_DIR)/compose.test.yml
  export COMPOSE_PROJECT    := idweave-$(VERID)
  export COMPOSE_FILES      := $(INFRA_DIR)/docker-compose.yml,$(INFRA_DIR)/compose.test.yml
  export GUI_BASE_URL       := http://localhost:$(PORT)/midpoint
  export MP_VERSION         := $(VER)
  export EXPECTED_VERSION   := $(VER)
endif

# ── Common engine env (the engine + snapshot CLI read these) ────────────────
export SCENARIOS_DIR     := $(EX)/scenarios
export REPORTS_DIR       := $(REPORTS)
export SNAPSHOT_DIR      := $(INFRA_DIR)/snapshots
# midPoint endpoint/creds — the keycloak example ignores these (no midPoint).
export MIDPOINT_BASE_URL := http://localhost:$(PORT)/midpoint
export MIDPOINT_USER     := administrator
export MIDPOINT_PASSWORD := $(ADMINPW)
ifeq ($(IS_MIDPOINT),yes)
export CONFIG_DIR        := $(CONFIG)
export CSV_HOST_DIR      := $(CSV_DIR)
endif

.PHONY: help install up ready config scenarios scenarios-md run test capture-expected triage snapshot-build snapshot-list snapshot-restore all down clean unit

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

install: ## Install JS dependencies
	npm install

up: ## Start the EXAMPLE stack (a midPoint example bakes in our config via post-init)
	$(COMPOSE) up -d

CLI := npx tsx src/cli.ts

ready: ## Block until the SUT is live (midPoint REST; keycloak waits in its own suite)
	@if [ "$(IS_MIDPOINT)" = "yes" ]; then $(CLI) wait-ready; else echo "ready: $(EXAMPLE) has no midPoint gate (its suite waits for the SUT itself)"; fi

config: ready ## Re-apply config via REST (midPoint examples; dev, restart-free; baked at `up`)
	@if [ "$(IS_MIDPOINT)" = "yes" ]; then $(CLI) import-config; else echo "config: $(EXAMPLE) has no midPoint config to import"; fi

scenarios: ## List the test cases (id / requirement / steps / asserts)
	$(CLI) scenarios

scenarios-md: ## Emit the test-case list as Markdown for review (redirect to a file)
	$(CLI) scenarios md

steps: ## List the step kinds a scenario may use (generated from the registry)
	$(CLI) steps

readme-steps: ## Refresh the generated step reference embedded in README.md
	$(CLI) steps embed

run: ## Run scenarios via the CLI (consumer entry); emits $(EX)/reports/{junit.xml,ctrf.json}
	$(CLI) run

test: ## Run the connected scenarios via vitest (engine self-test); emits $(EX)/reports/{junit.xml,ctrf.json}
	@mkdir -p $(REPORTS)
	@npx vitest run $(EX)/ --reporter=default --reporter=junit --outputFile.junit=$(REPORTS)/junit.xml; \
		code=$$?; \
		npx tsx scripts/junit-to-ctrf.ts $(REPORTS)/junit.xml $(REPORTS)/ctrf.json || true; \
		exit $$code

unit: ## Run the core unit tests under src/ (no SUT; fast)
	npx vitest run src/

capture-expected: ready ## (Re)capture expected files by characterization — verify by intent before trusting
	$(CLI) capture-expected

triage: ## Offline AI triage of the last run's failures (reads examples/reports/ctrf.json)
	$(CLI) triage

snapshot-build: ## Snapshot the whole env as a named baseline (NAME=baseline by default)
	$(CLI) snapshot-build $(NAME)

snapshot-list: ## List saved environment snapshots
	$(CLI) snapshot-list

snapshot-restore: ## Reset the WHOLE env to a named snapshot (NAME=baseline), then wait (snapshot-restore runs each system's after-restore hook itself)
	$(CLI) snapshot-restore $(NAME)
	@if [ "$(IS_MIDPOINT)" = "yes" ]; then $(CLI) wait-ready; fi

# One-shot local run. Config is baked at `up` (post-init); the suite waits for
# the baseline before running, so no explicit config step is needed.
all: up ready test ## Full local run: up (post-init config) -> ready -> test

down: ## Stop the stack
	$(COMPOSE) down

clean: ## Remove run output (reports/dumps) for this EXAMPLE/VER
	rm -rf $(REPORTS)
