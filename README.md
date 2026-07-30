# AgentCorp

A fully autonomous AI-run business: an AI executive team handles strategy,
product, marketing, sales, support, finance and reporting. A human owner sets
goals and approves critical actions; everything else is automated.

**Status: Phase 7 complete** — outbound actions are gated behind a human
approval queue with a legal-compliance pass, spend is capped per task, per
agent and per day, and a kill switch halts everything instantly.

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
`npm run demo:goal ["goal"]` runs the full Phase 3 loop: owner goal → CEO
plan → DAG execution → report.
`npm run demo:tools` shows an agent writing and running a file in the
sandbox, and an agent being refused a tool it wasn't granted.
`npm run demo:critic` runs deliverables through the reviewer and prints each
round's verdict.
`npm run demo:brain` seeds the knowledge base, runs semantic search, and shows
a grounded answer, a refusal on undocumented facts, and handbook enforcement.
`npm run demo:safety` shows the legal gate, an approval card, the kill switch
halting an agent mid-flight, and the budget snapshot.

### Endpoints

| Route | Description |
|---|---|
| `GET /health` | Liveness check |
| `GET /api/status` | DB, migrations, agents loaded, today's spend |
| `GET /api/agents` | Registry summary (id, department, reporting line, tools) |
| `GET /api/agents/:id` | Full agent config including system prompt |
| `POST /api/agents/:id/run` `{ "instruction": "..." }` | Execute one agent, fully audited |
| `GET /api/approvals` `?status=pending` | Outbound actions awaiting your click |
| `POST /api/approvals/:id/decide` | `{ "decision": "approved"\|"rejected", "note"?: string }` |
| `GET /api/budget` | Spend vs daily and per-agent caps, broken down by agent |
| `GET /api/kill-switch` / `POST /api/kill-switch` | Read or set `{ "engaged": boolean }` |
| `POST /api/documents` `{ "title", "content" }` | Add a document to the Company Brain |
| `GET /api/documents` | List documents (source, review status, chunk count) |
| `POST /api/documents/:id/approve` | Approve an agent-written learning |
| `DELETE /api/documents/:id` | Remove a document and its vectors |
| `POST /api/brain/search` `{ "query": "..." }` | Semantic search with scores |
| `GET /api/handbook` | The company handbook text |
| `GET /api/tools` | Available tools, sandbox root, shell whitelist |
| `POST /api/goals` `{ "description": "..." }` | Set a goal; CEO plans and runs it (202, then poll) |
| `GET /api/goals` | All goals with status and final report |
| `GET /api/goals/:id` | One goal plus its full task DAG |
| `GET /api/escalations` `?status=open` | Deliverables that need your decision |
| `POST /api/escalations/:id/resolve` | `{ "status": "resolved"\|"dismissed", "resolution": "..." }` |
| `GET /api/tasks/:id/reviews` | Full review history for a task |
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
  orchestration/planner.ts  # CEO goal -> validated task DAG + hard caps
  orchestration/runner.ts   # TaskRunner: dependency-aware parallel execution
  approvals/index.ts     # approval queue + legal_compliance gate
  safety/budget.ts       # daily and per-agent spend caps, 80% alert
  safety/killswitch.ts   # global halt, checked before every model and tool call
  brain/index.ts         # Company Brain: index, retrieve, learnings, approval
  brain/chunker.ts       # paragraph-aware chunking
  brain/handbook.ts      # company_handbook.md injection + hot-reload
  orchestration/critic.ts   # reviewer routing, revision rounds, escalation
  orchestration/goals.ts    # create/execute/read goals
  tools/sandbox.ts       # workspace path resolution + command whitelist
  tools/registry.ts      # tool registry + permission enforcement + audit
  tools/impl/            # file, shell, db tools and Phase 6/10 stubs
  workspace.ts           # default workspace bootstrap (multi-tenant in Phase 10)
  config/env.ts          # .env loading + zod validation
  db/index.ts            # better-sqlite3 connection, sqlite-vec load, migration runner
  db/migrations/         # numbered .sql migrations
  llm/provider.ts        # THE Gemini provider: retries/backoff, JSON+zod path, cost + audit logging
  llm/types.ts
  scripts/demo-llm.ts    # Phase 1 demo call
  scripts/demo-agent.ts  # Phase 2 demo: run one agent + show audit trail
  scripts/demo-goal.ts   # Phase 3 demo: goal -> DAG -> execution report
  scripts/demo-tools.ts  # Phase 4 demo: sandboxed tool use + permission denial
workspace/               # agent filesystem sandbox (gitignored)
  index.ts               # Express server
data/                    # SQLite database (gitignored)
```

## Approvals, budget & kill switch (Phase 7)

### Human approval queue

An agent's `requiresApproval[]` declares which outbound actions it may never
perform on its own — `publish`, `send_email`, `send_dm`, `deploy`, `spend`,
`legal_text`. When such an agent's deliverable passes review, the system
**does not act**: it creates a pending approval card and stops.

The task itself is complete — the card gates the *external* action, which
does not exist until the Phase 10 adapters. Approving records the decision; it
does not yet transmit anything anywhere.

### Legal compliance gate

Before any card is created, `legal_compliance` reviews the content against the
handbook and returns `{ risky, flags[], assessment }`, which is attached to the
card so you see the risks before you click.

The gate **fails closed**: if the compliance check errors, times out or is
blocked, the result is `risky: true` with the failure as a flag — a broken
check never looks like a clean bill of health. This was confirmed in a live
run when Gemini returned a 503 and the card was correctly flagged rather than
passed.

Real flags raised on a promotional-email goal: "Zero Risk" as a guaranteed
outcome, "Seamless Automation" as a handbook-forbidden hype word, and missing
disclaimers where only a placeholder existed.

### Budget guard

| Scope | Limit | Behaviour |
|---|---|---|
| Per task | agent's `maxCostPerTask` | Tool loop stops mid-run when exceeded |
| Per agent per day | `AGENT_DAILY_BUDGET_USD` | That agent stops for the day |
| Company per day | `DAILY_BUDGET_USD` | **Alert at 80%**, hard stop at 100% |

Set either daily cap to `0` to disable it. The 80% alert fires once per day
(tracked in `system_state`), logs a `budget_alert` event, and is surfaced by
`GET /api/budget`.

### Kill switch

`POST /api/kill-switch {"engaged": true}` halts everything instantly. It is
checked in the provider before **every** model call and embedding, and in the
tool registry before **every** tool call — so no code path reaches an external
system while it is on. State lives in the database, so it survives a restart;
the server warns at boot if it is still engaged.

Both guards sit at the single choke point in `src/llm/provider.ts`, which is
why nothing can bypass them.

Covered by 33 tests: daily and per-agent hard stops, once-per-day alerting,
`0` disabling a cap, kill switch blocking both model and tool calls, approval
lifecycle and double-decide rejection, gated-action mapping per agent, and the
legal gate failing closed.

## Company Brain & handbook (Phase 6)

### Knowledge base

Documents are chunked (~1200 chars, paragraph-aligned, with overlap), embedded
with `gemini-embedding-001` at 768 dimensions, and indexed in a `sqlite-vec`
virtual table. **Every agent retrieves context before answering** — the top
`BRAIN_TOP_K` (default 4) chunks for its instruction are prepended to its
prompt, with an instruction to say so rather than invent when the answer isn't
there. Retrieval is workspace-scoped, so one client's data can never surface in
another's answers.

Embedding happens before any database write, and the document, its chunks and
its vectors are inserted in a single transaction — a failed embedding can never
leave a document that agents would silently retrieve nothing from.

Agents granted `kb_write` can record learnings back. Those are stored with
`source: "agent"` and `needs_review: 1`, are labelled **UNREVIEWED** wherever
they surface in retrieval, and stay flagged until the owner approves them via
`POST /api/documents/:id/approve`.

### Handbook injection

`company_handbook.md` at the repo root is prepended to **every** agent's system
prompt, ahead of its role instructions, with an explicit "if these conflict,
the handbook wins". It carries brand voice, tone rules and forbidden claims
(guaranteed outcomes, unverifiable statistics, fake social proof, competitor
claims, regulatory claims). Edit it and the change applies immediately — it
hot-reloads like the agent registry. Replace the placeholder "About the
business" section with your own company details.

### What this changed

In Phase 2, asked "what is your refund policy?", `support_agent` **invented
one**. With the Brain seeded it answers from the documents — correct windows,
correct method, correct billing address — and when asked about an iPhone app
that isn't documented it replies "That information is not in the knowledge
base. I can escalate this…" instead of guessing. Asked for an ad promising
"guaranteed 300% revenue growth", `ad_copywriter` now refuses and quotes the
handbook rule it would breach.

Covered by 23 tests: chunking bounds, handbook precedence, learning write-back
and flagging, permission denial on `kb_write`, cross-workspace isolation, owner
approval idempotency, and vector-index cleanup on delete.

## Critic loop (Phase 5)

No deliverable is accepted on the producing agent's own say-so. Every task
output goes to a reviewer agent, which judges it **only** against the task and
its `acceptanceCriteria` and returns a zod-validated verdict:

```json
{ "verdict": "APPROVE" | "REVISE", "feedback": "...", "requiredChanges": ["..."] }
```

### Reviewer routing

| Producer's department | Reviewer |
|---|---|
| product (developer, devops, qa_tester, ui_designer) | `code_reviewer` |
| marketing (seo_writer, instagram_agent, …) | `creative_director` |
| executive, sales, ops | `coo` |

An agent never reviews its own work: `code_reviewer` and `creative_director`
fall back to `coo` for their own deliverables, and the `coo` falls back to the
`ceo`. Pass `reviewerId` to `produceWithReview()` to override the routing.

### Revision and escalation

On `REVISE` the producing agent is re-run with the critique and its previous
attempt, and must address every required change. After **2 revision rounds**
(3 production attempts total) the task is marked `escalated`, an `escalations`
row is created with the deliverable and the last critique, and it waits for a
human at `GET /api/escalations`.

Escalated work does **not** flow downstream: dependent tasks are blocked
rather than built on a deliverable that hasn't passed review. A reviewer that
errors out escalates too — a broken critic never silently passes work through.

Every round is persisted to `reviews` (verdict, feedback, required changes,
and the exact deliverable judged) and audited as `review_approved`,
`review_revise_requested`, `task_escalated` or `escalation_resolved`.

Observed on a real run: a 4-task Instagram goal produced 6 reviews, 2 of which
were sent back. The `coo` caught the `creative_director` returning a bare
"APPROVE" with no caption and no justification — both were fixed within the
allowed rounds. The escalation path itself is covered by 23 tests using an
always-REVISE reviewer fixture, verifying it stops at exactly 2 rounds,
records 3 reviews, blocks dependents, and rejects double-resolution.

## Tools & sandbox (Phase 4)

Agents call tools through Gemini's native function calling. An agent is only
*offered* the tools in its own `tools[]`, and `callTool()` re-checks the grant
before executing — the model never sees a tool it can't use, and couldn't use
one if it guessed the name.

| Tool | Grantee example | Notes |
|---|---|---|
| `file_read` / `file_write` / `file_list` | developer, devops | Workspace-relative paths only |
| `shell` | developer, devops, qa_tester | Whitelisted commands, no shell interpreter |
| `db_query` | analyst, cfo, bookkeeper | Read-only SELECT, restricted tables |
| `kb_search` / `kb_write` | most content agents | Real: semantic search; writes are flagged for review |
| `web_search` | researcher, seo_writer | **Stub** until Phase 10 |

Stubs return an explicit "not available" message that tells the agent not to
invent an answer, rather than silently returning nothing.

### Safety boundaries

**Filesystem** — everything resolves under `AGENT_WORKSPACE_ROOT` (default
`./workspace`). Rejected, not sanitised: absolute paths, `..` traversal, null
bytes, and symlinks pointing outside the workspace (checked via `realpath` on
both the target and its nearest existing ancestor).

**Shell** — commands run through `execFile` with `shell: false`, so pipes,
redirects and chaining are structurally impossible. The command must be a
bare whitelisted name (no paths), arguments containing shell metacharacters
are rejected, execution is capped at 30s, and the child process gets a minimal
environment — it never inherits `GEMINI_API_KEY`. The default whitelist
deliberately excludes `rm`, `mv`, `sudo`, `curl`, `wget` and `git`; add more
via `SHELL_WHITELIST_EXTRA`.

**Database** — `db_query` accepts a single statement, requires SELECT/WITH,
verifies `statement.readonly` via better-sqlite3, blocks `llm_calls`,
`approvals` and `workspaces`, and caps results at 100 rows.

**Cost** — the tool loop checks accumulated spend against the agent's
`maxCostPerTask` on every iteration and stops mid-loop if exceeded; it also
halts after 8 iterations so a confused agent can't spin.

Every tool call is audited: `tool_call_started`, `tool_call_completed`,
`tool_call_failed`, `tool_permission_denied`, `tool_sandbox_violation`.

Verified with 29 security tests (traversal, symlink escape, `rm -rf`,
metacharacter injection, cross-agent permission denial, SQL write/multi-
statement/restricted-table rejection) — all rejected and audited. In the live
demo the `developer` agent wrote `fizzbuzz.js` and executed it for real
output, while `seo_writer` correctly reported it had no shell access.

## Orchestration (Phase 3)

`POST /api/goals` hands the owner's goal to the CEO agent, which returns a
task DAG:

```json
{ "tasks": [{ "id": "t1", "agentId": "cmo", "instruction": "...",
              "dependsOn": [], "acceptanceCriteria": "..." }] }
```

The plan is zod-validated and then **semantically** checked before anything
runs: every `agentId` must exist in the registry, the CEO may not assign work
to itself, dependencies must reference real tasks, and the graph must be
acyclic. A rejected plan goes back to the CEO once with the specific problems
listed; if it still fails, the goal is marked failed with the reasons.

`TaskRunner` (`src/orchestration/runner.ts`) then executes the DAG:

- A task runs only once all its dependencies have completed; independent
  tasks run in parallel (bounded at 3 concurrent LLM calls).
- Each task's prompt carries its instruction, its acceptance criteria, and
  the outputs of the tasks it depends on (truncated to 2500 chars each).
- A failed task marks its transitive dependents `blocked` — independent
  branches keep running rather than the whole goal dying.
- The goal ends with a stored report: per-task status and total LLM cost.

Observed on a real run (blog post + email sequence launch goal): an 8-task
DAG across 5 agents, 8/8 completed in 75s for $0.04, with `ad_copywriter` and
`email_marketer` executing concurrently as siblings.

### Hard caps

| Cap | Value | Behaviour |
|---|---|---|
| Tasks per goal | 40 | Planning refuses to exceed it; at the cap the goal stops and reports |
| Delegation rounds | 5 | `goals.delegation_round` increments per planning pass; round 6 stops and reports |

Both raise `CapExceededError`, mark the goal failed with an explanatory
report, and log `task_cap_reached` / `delegation_cap_reached` audit events.
Phase 3 only uses round 1 (the CEO's initial plan); the counter is the hook
for agent-initiated delegation in later phases.

## Database schema

Tables created by `001_init.sql`, sized for the phases ahead:

- `workspaces` — one row per business/client (multi-tenant isolation)
- `goals` — owner goals with status, delegation round, and final report
- `tasks` — the task DAG: agent, instruction, acceptance criteria,
  `depends_on`, status and result
- `llm_calls` — every LLM call: prompts, tokens, estimated cost, latency, errors
- `audit_log` — tool calls, approvals, config changes (Phase 2+)
- `reviews` — every critic verdict with feedback and the deliverable judged
- `escalations` — work that failed review twice, awaiting a human decision
- `approvals` — pending outbound actions with their legal review
- `system_state` — kill switch and once-per-day budget alert markers
- `documents` / `document_chunks` / `vec_chunks` — Company Brain: source docs,
  their chunks, and the sqlite-vec embedding index
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
3. ✅ CEO orchestration, task DAG, TaskRunner with dependencies
4. ✅ Tool system with per-agent permissions + sandbox
5. ✅ Critic loop + revision rounds + escalation
6. ✅ Company Brain (embeddings, retrieval, handbook injection)
7. ✅ Human approval queue + budget guard + kill switch
8. React frontend: chat, org chart, task board, approval inbox, audit log
9. Scheduler + autonomous routines + dashboard KPIs
10. Integrations adapters (stubs), agent builder UI, workspaces
11. Electron packaging + build scripts
