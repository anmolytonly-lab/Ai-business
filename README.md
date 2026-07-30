# AgentCorp

A fully autonomous AI-run business: an AI executive team handles strategy,
product, marketing, sales, support, finance and reporting. A human owner sets
goals and approves critical actions; everything else is automated.

**Status: Phase 2 complete** — agent registry (27 seed agents as JSON files
with hot-reload), single-agent execution through the LLM provider, and full
audit logging of every run.

## Stack

- Backend: Node.js ≥ 20 + Express, TypeScript strict
- DB: SQLite (better-sqlite3), vector search via sqlite-vec (loaded now, used from Phase 6)
- LLM: Gemini API through one provider module (`src/llm/provider.ts`)
- Frontend (Phase 8): React + Vite + TailwindCSS + shadcn/ui
- Desktop (Phase 11): Electron wrapper

## Setup

```bash
npm install
cp .env.example .env   # then add your GEMINI_API_KEY
```

Get a Gemini API key at https://aistudio.google.com/apikey. `.env` is
gitignored — keys never go in code.

## Run

```bash
npm run build      # compile TypeScript + copy SQL migrations to dist/
npm start          # start the API server (default http://localhost:3000)
npm run dev        # build + start in one step
npm run migrate    # apply pending DB migrations and list applied ones
npm run demo:llm   # Phase 1 demo: one Gemini call (text + validated JSON) with audit rows
```

`npm run demo:llm "your prompt"` sends a custom prompt.
`npm run demo:agent [agentId] ["instruction"]` runs one agent end-to-end and
prints its audit trail (defaults to `seo_writer`).

### Endpoints

| Route | Description |
|---|---|
| `GET /health` | Liveness check |
| `GET /api/status` | DB, migrations, agents loaded, today's spend |
| `GET /api/agents` | Registry summary (id, department, reporting line, tools) |
| `GET /api/agents/:id` | Full agent config including system prompt |
| `POST /api/agents/:id/run` `{ "instruction": "..." }` | Execute one agent, fully audited |
| `GET /api/audit` `?limit=&agentId=&eventType=` | Audit trail |
| `POST /api/llm/test` `{ "prompt": "..." }` | Raw provider call (Phase 1) |

## Agent registry

Agents are JSON files in `/agents/*.json` — never hardcoded. Files are
zod-validated on load and **hot-reloaded on change**; a file that fails
validation logs the error and keeps the previous good version in memory.
Schema: `{ id, name, department, role, systemPrompt, tools[], reportsTo,
canDelegateTo[], model, temperature, maxCostPerTask, requiresApproval[] }`.

Seed roster (27 agents): executive (ceo, coo, cfo, chief_of_staff),
product & tech (developer, code_reviewer, qa_tester, devops, ui_designer),
marketing (cmo, seo_writer, ad_copywriter, social_manager, instagram_agent,
video_scriptwriter, email_marketer, creative_director), sales & customer
(sales_rep, dm_manager, support_agent, onboarding, retention), ops & insight
(analyst, researcher, legal_compliance, bookkeeper, hr_reviewer).

`tools[]` and `requiresApproval[]` are declarations for now — the tool
system arrives in Phase 4 and the approval queue in Phase 7. Note:
`support_agent` is prompted to answer only from the knowledge base, but the
Company Brain doesn't exist until Phase 6, so it can still improvise today.

Every run writes `agent_run_started` / `agent_run_completed` (or
`agent_run_failed`) events to `audit_log`, plus the full prompt/response/cost
row in `llm_calls`. Runs whose cost exceeds the agent's `maxCostPerTask` get
an `agent_over_budget` event (hard enforcement lands with the Phase 7 budget
guard).

## Project layout

```
agents/                  # one JSON file per agent (hot-reloaded)
src/
  agents/schema.ts       # zod schema for agent config files
  agents/registry.ts     # load + validate + hot-reload the registry
  agents/executor.ts     # runAgent(): audited single-agent execution
  audit.ts               # audit_log write/read helpers
  workspace.ts           # default workspace bootstrap (multi-tenant in Phase 10)
  config/env.ts          # .env loading + zod validation
  db/index.ts            # better-sqlite3 connection, sqlite-vec load, migration runner
  db/migrations/         # numbered .sql migrations
  llm/provider.ts        # THE Gemini provider: retries/backoff, JSON+zod path, cost + audit logging
  llm/types.ts
  scripts/demo-llm.ts    # Phase 1 demo call
  scripts/demo-agent.ts  # Phase 2 demo: run one agent + show audit trail
  index.ts               # Express server
data/                    # SQLite database (gitignored)
```

## Database schema (Phase 1)

Tables created by `001_init.sql`, sized for the phases ahead:

- `workspaces` — one row per business/client (multi-tenant isolation)
- `goals`, `tasks` — owner goals and the task DAG (orchestration lands in Phase 3)
- `llm_calls` — every LLM call: prompts, tokens, estimated cost, latency, errors
- `audit_log` — tool calls, approvals, config changes (Phase 2+)
- `approvals` — human approval queue (Phase 7)
- `documents` — Company Brain source docs (Phase 6 adds chunking + embeddings)
- `agent_memory` — per-agent episodic memory (Phase 9 adds compaction)

## LLM provider guarantees

- One module (`src/llm/provider.ts`); model set per call, defaulting to `GEMINI_MODEL`
- Exponential backoff (2s/4s/8s, 4 attempts) on 429s, 5xx and network errors
- JSON calls: JSON-only instruction, markdown fences stripped, zod-validated,
  one corrective retry on parse failure
- Every call (including failures) writes an `llm_calls` row with token counts
  and estimated USD cost — nothing is invisible

## Build phases

1. ✅ Scaffold, .env.example, DB schema, LLM provider, one working Gemini call
2. ✅ Agent registry (`/agents/*.json`) + single-agent execution + full audit logging
3. CEO orchestration, task DAG, TaskRunner with dependencies
4. Tool system with per-agent permissions + sandbox
5. Critic loop + revision rounds + escalation
6. Company Brain (embeddings, retrieval, handbook injection)
7. Human approval queue + budget guard + kill switch
8. React frontend: chat, org chart, task board, approval inbox, audit log
9. Scheduler + autonomous routines + dashboard KPIs
10. Integrations adapters (stubs), agent builder UI, workspaces
11. Electron packaging + build scripts
