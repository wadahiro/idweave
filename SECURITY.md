# Security Policy

## Reporting a vulnerability

Please report security issues **privately** via GitHub's
[private vulnerability reporting](https://github.com/wadahiro/idweave/security/advisories/new)
(the repository's **Security** tab → **Report a vulnerability**). Do not open a
public issue for a suspected vulnerability.

idweave is a **test harness** — it holds no production data, but it connects to real
systems with real credentials (midPoint/Keycloak admin, LDAP binds, DB users). The
highest-impact issues are therefore around credential handling and the dependency
supply chain.

## Supported versions

Pre-1.0: only the latest `main` is supported. Fixes land on `main`.

## Dependency / supply-chain practices

- **Reproducible installs.** `package-lock.json` (with integrity hashes) is the
  source of truth; CI installs with `npm ci`, never `npm install`. Node is pinned
  via `.nvmrc` / `package.json` `engines` (`engine-strict`).
- **Automated updates.** Dependabot watches the `npm` and `github-actions`
  ecosystems weekly (`.github/dependabot.yml`).
- **Audit gate.** CI runs `npm audit --audit-level=high`; a high/critical advisory
  fails the build (`.github/workflows/ci.yml`).
- **Pinned GitHub Actions.** Every action is pinned to a commit SHA (a version
  comment marks the tag); Dependabot keeps the SHAs current.
