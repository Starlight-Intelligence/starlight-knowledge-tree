# AI skill tree registry

One registry for skills a person or an agent can hold, and the roles that require them.

| File | What it is | Edited by |
|---|---|---|
| `registry.json` | Canonical source: level rubric, branches, skills, roles | Hand |
| `../schemas/skill-tree.schema.json` | Shape of the registry | Hand |
| `metrics.json` | Role profiles, agent-to-human pairings, skill demand | Generated |
| `skill-tree.sql` | Portable SQL (SQLite and Postgres): DDL, seed, tracking tables, readiness view | Generated |
| `profiles/` | Illustrative sample profiles for gap analysis (no real people) | Hand |

The web page at `/skill-tree` reads `apps/web/src/data/skill-tree.json`, also generated.

## Model

- **Skill**: a branch, a tier (1 to 5), prerequisites, an evidence bar, and its bearers (`human`, `agent`, or both). Agent-bearable skills say how an agent gains them: `prompt`, `tool`, `memory`, `harness`, or `finetune`.
- **Role**: a bearer and a list of required skills at levels 1 to 5. Human and agent roles are measured against the same tree.
- **Level**: one rubric with a human reading and an agent reading for each level.
- **Holder and assessment** (SQL only): a person or agent instance with dated, evidenced levels. `holder_role_readiness` computes readiness against every role of the same bearer.

The validator enforces what JSON Schema cannot: prerequisites resolve, form a DAG, and sit at or below the skill's tier; roles only require skills their bearer can hold; agent-bearable skills name an acquisition mode.

## Commands

```bash
node scripts/skill-tree.mjs validate
node scripts/skill-tree.mjs build            # regenerate metrics.json, skill-tree.sql, web bundle
node scripts/skill-tree.mjs build --check    # CI: fails on stale generated files (part of npm run validate)
node scripts/skill-tree.mjs gap data/skill-tree/profiles/sample-coding-agent.json coding-agent
node scripts/skill-tree.mjs db dist/skill-tree.db   # load into SQLite (Node 22.5+)
node --test scripts/tests/skill-tree.test.mjs
```

## Status

Proposal, v0.1.0. Role requirements and levels are editorial judgment, not labor-market data. Change them in `registry.json` and rerun `build`.
