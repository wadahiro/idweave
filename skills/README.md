# Coding-agent skills

Skills that teach a coding agent (Claude Code, Codex, …) how to work with idweave, so it can
help you author, run, and debug scenarios. **Each subdirectory is one skill** — a `SKILL.md`
(its frontmatter `description` tells the agent when it applies) plus an optional
`agents/openai.yaml` for OpenAI/Codex-style agents.

| Skill | What it helps with |
|-------|--------------------|
| [`writing-idweave-scenarios`](writing-idweave-scenarios/SKILL.md) | Authoring a `scenario.yaml` — the model, step vocabulary, expect/assert, targeting systems, re-runnable discipline, GUI-vs-REST. |
| [`running-idweave`](running-idweave/SKILL.md) | The `idw` CLI — the capture→review→run loop, scoping to one scenario, snapshots/reset, reports, triage, and the `make` wrapper. |

## Install

These skills are **not shipped in the npm package** — install them straight from the repo
with the [`skills`](https://www.npmjs.com/package/skills) CLI, which adds them to your agent
(`.claude/skills/`, `.codex/skills/`, …):

```sh
npx skills add wadahiro/idweave
```

The skills lean on idweave's self-describing CLI (`idw steps`, `idw help`, `idw scenarios`)
rather than restating the step list, so they stay correct as idweave evolves.

## Adding a skill

Create `skills/<name>/SKILL.md` with frontmatter (`name`, `description`, optional
`allowed-tools`) and a focused, actionable body; add `agents/openai.yaml`
(`display_name` / `short_description` / `default_prompt`) for cross-agent support. Keep each
skill to one concern so the agent loads only what's relevant, and cross-reference siblings by
name.
