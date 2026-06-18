# poke-conduit — Design Spec

- **Date:** 2026-06-18
- **Status:** Approved for build (autonomous)
- **Author:** Kevin Nguyen (with Claude)
- **Working name:** `poke-conduit` — "the durable brain Poke consults"

---

## Build addendum (2026-06-18, as-built)

Two infrastructure decisions changed during the build to remove friction and make the whole
product testable **and** deployable with no external durability account. They do not change any
capability or the data model — only the machinery underneath.

- **MCP SDK dropped → hand-rolled JSON-RPC.** The surface Poke actually speaks is tiny
  (`initialize` / `ping` / `tools/list` / `tools/call` + `notifications/*`). Following the proven
  `poke-amb-bridge`, the server is a hand-rolled Streamable-HTTP JSON-RPC handler. It is
  edge-runtime-compatible (the Node-only `@modelcontextprotocol/sdk` is not), stateless, and fully
  unit-testable over `Request`/`Response`. `@modelcontextprotocol/sdk` is **not** a dependency.
- **Inngest dropped from the critical path.** The council is ~5 model calls — well under Vercel's
  300 s function budget — so it runs **inline under `LocalStep`** (the exact code path tests and the
  demo exercise). Idempotency is preserved by the `finishRun` compare-and-swap, and **Vercel Cron**
  drives the scheduler (`/api/cron`). The `Step` seam and the `fromInngestStep` adapter remain as
  the documented upgrade path if a run ever needs true multi-hour durability. Net effect: deployable
  with just **Neon** — no Inngest Cloud account, and no untested durability path. `inngest` is
  **not** a dependency.

Wherever the text below says "Inngest in prod," read "inline under `LocalStep`, with Inngest as the
documented upgrade." As-built runtime dependencies: `@anthropic-ai/sdk`, `@neondatabase/serverless`,
`zod` (plus dev tooling: `@vercel/node`, `pg-mem`, `tsx`, `typescript`, `vitest`).

---

## 1. Problem & product

Real iMessage access is the hardest, riskiest part of any messaging agent (no official Apple
API, real ban risk, needs a paid bridge or a Mac). **Poke already solved that** — it lives in
iMessage, sanctioned, and it is an **MCP client** that calls external MCP servers (proven in this
environment: Poke already calls the `poke-amb-bridge` `/mcp` endpoint with `Bearer` auth +
auto-injected `X-Poke-User-Id`).

**poke-conduit** inverts the integration: instead of building our own iMessage transport, we make
Poke the front-end terminal and build the **brain it consults** — a production-shaped, durable,
multi-agent backend exposed as a single MCP server. It provides:

1. **Queued-notes backlog** (flagship) — durable add/list/complete/pin.
2. **Council** — fan a question out to N persona worker-agents, collect POVs, synthesize, and
   **proactively text the synthesis back through Poke**.
3. **Proactive triggers / reminders** — a minute-resolution scheduler that re-activates work and
   pushes to the user via Poke's inbound API.
4. **Recipes + Status/DND** (lighter surfaces) — a JSON recipe registry and per-thread agent state.

The architecture underneath all four is the research's **orchestrator + persistent worker-agent**
split, on a **durable-execution** backbone (Inngest in prod), behind a **Store** interface
(Neon Postgres in prod, `pg-mem` in tests).

## 2. Goals / non-goals

**Goals**
- A runnable, fully-tested TypeScript service: `npm test`, `npm run typecheck`, `npm run demo`,
  `npm run serve` all green with **zero external accounts**.
- Production-shaped: deployable to **Vercel + Neon + Inngest Cloud**; Poke calls it live over a URL.
- Real Claude behind the agents (key-gated), deterministic mock for tests.
- Demo narrates the full loop end-to-end with PASS/FAIL assertions and explicit failure logs.

**Non-goals (explicitly out — YAGNI)**
- Real iMessage transport (Poke *is* the transport), native interactive bubbles, Spectrum SDK,
  BlueBubbles/Mac path, WhatsApp/Telegram channels.
- Multi-tenant OAuth / Tier-2 per-user token minting (single Poke account for proactivity in MVP).
- Multi-tier memory summarization, billing, a recipe *execution* engine (recipes store config only).
- Heavy per-thread concurrency control (rely on idempotency keys + DB constraints; documented).

## 3. Architecture

```
  Poke (iMessage front-end)
        │  MCP tool calls  (Authorization: Bearer ·  X-Poke-User-Id ⇒ per-user scope)
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ api/mcp.ts  — MCP server (tool surface, auth, scoping)         │
  │   fast tools → run inline     async tools → emit Inngest event  │
  └───────┬───────────────────────────────────┬──────────────────┘
          │                                    │ inngest.send()
   ┌──────▼─────────┐                  ┌────────▼─────────────────┐
   │ Orchestrator   │                  │ api/inngest.ts — durable │
   │ routing /      │                  │ functions (thin shells): │
   │ personality /  │                  │  • council  → runCouncil │
   │ delegation     │                  │  • scheduler(cron * * * *)│
   └──────┬─────────┘                  │             → runScheduler│
          │                            └────────┬─────────────────┘
   ┌──────▼─────────┐  Model interface           │ on completion / fire
   │ Worker agents  │  (ClaudeModel | MockModel)  ▼
   │ + Council      │                  poke/inbound.ts → POST poke.com/api/v1/inbound/api-message
   └──────┬─────────┘                            (Poke texts the user)
          ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ store/  — Store interface · NeonStore (prod) | PgMemStore (test)│
  │   pc_backlog · pc_recipes · pc_status · pc_triggers · pc_runs    │
  └──────────────────────────────────────────────────────────────┘
```

### Unit boundaries (each independently testable)

| Unit | Does | Used via | Depends on |
|---|---|---|---|
| `src/store/` | Persistence of all entities | `Store` interface | pg (Neon) / pg-mem |
| `src/model/` | Text in → text out w/ persona system prompts | `Model` interface | `@anthropic-ai/sdk` (Claude) / none (Mock) |
| `src/durable/` | Checkpointed steps + idempotency; scheduler tick | `Step` interface; `runScheduler` | Store, Model |
| `src/agents/` | Orchestrator, WorkerAgent, Council | function calls | Model, Store, Step |
| `src/tools/` | backlog/pins/recipes/status/council verbs | called by MCP layer | agents, Store |
| `src/mcp/` | MCP protocol wiring + auth + scoping | HTTP (`api/mcp.ts`) | tools, `@modelcontextprotocol/sdk` |
| `src/poke/` | Poke inbound API client (proactive push) | `notifyUser()` | fetch + `POKE_API_KEY` |
| `src/serve.ts` `src/demo.ts` | Runnable HTTP service + narrated e2e | CLI | all of the above |

**Key seam — the `Step` abstraction.** Council and scheduler core logic are plain async functions
that receive an injected `Step` (`step.run(id, fn)`). In production `api/inngest.ts` passes
**Inngest's** `step` (real checkpointing, retries, cron). In tests/demo we pass a **`LocalStep`**
that runs the fn and records the call. So durability semantics (step boundaries, idempotency keys
`(runId, stepId)`) are exercised by the test suite and the demo **without any Inngest runtime**.

## 4. MCP tool surface (the contract Poke calls)

All tools are scoped by `X-Poke-User-Id` (the calling user). Auth: `Authorization: Bearer <key>`
or `x-poke-key` header, enforced when `MCP_AUTH_ENFORCE=true` (ported from the bridge).

| Tool | Mode | Input (zod) | Returns |
|---|---|---|---|
| `add_to_backlog` | inline | `{ text: string, tags?: string }` | rendered numbered backlog |
| `list_backlog` | inline | `{ filter?: "open"\|"pinned"\|"done"\|"all" }` | rendered numbered backlog |
| `complete_item` | inline | `{ ref: number\|string }` (index or id) | confirmation + list |
| `pin_item` | inline | `{ ref: number\|string, pinned?: boolean }` | confirmation + list |
| `convene_council` | async | `{ question: string, personas?: string[], deliver?: "push"\|"return" }` | `push`→`{run_id, status, note}`; `return`→synthesis+POVs (≤25s) else `{run_id,...}` |
| `get_result` | inline | `{ run_id: string }` | `{ status, synthesis?, povs? }` |
| `schedule_reminder` | inline | `{ text: string, fire_at: ISO-8601, recurrence?: "none"\|"daily" }` | `{ trigger_id, fire_at }` |
| `set_status` | inline | `{ status: "active"\|"dnd"\|"deep_work", note?: string, until?: ISO }` | current status line |
| `get_status` | inline | `{}` | current status line |
| `list_recipes` | inline | `{}` | recipe list (name/enabled) |
| `install_recipe` | inline | `{ ref: string, spec?: object }` | confirmation |

`ref` accepts either a 1-based **index** into the user's current open list or a stable **id**;
the tool resolves index→id against `pc_backlog`.

## 5. Agents

- **Orchestrator** (`agents/orchestrator.ts`): the interaction layer. Holds the persona/voice for
  user-facing confirmations and decides whether a request is a fast tool or a delegated durable task.
  In MVP the MCP tool names already encode intent, so the orchestrator's job is (a) render
  user-facing text in a consistent voice and (b) own the council fan-out/synthesis prompts. Kept
  thin and pure.
- **WorkerAgent** (`agents/worker.ts`): a persona with its own system prompt that answers a question
  via one `Model.complete()` call inside a `step.run`. Stateless per call in MVP (no long-lived
  tool loop); "persistent" is represented by the durable run record, not an in-memory process.
- **Council** (`agents/council.ts`): `runCouncil(deps, { runId, userId, question, personas })`:
  1. resolve personas (default panel below);
  2. `step.run("persona:<name>")` per persona → POV (parallel; a failed persona degrades to a
     recorded error and is excluded from synthesis, never aborts the run);
  3. `step.run("synthesis")` → orchestrator synthesizes the POVs into one answer;
  4. persist POVs + synthesis to `pc_runs`; if `deliver:"push"`, `notifyUser()` via Poke.

**Default persona panel** (overridable per call): `builder` (optimistic, ship-it),
`skeptic` (risk/failure-mode), `operator` (pragmatic/sequencing), `user-advocate` (end-user lens).
Persona system prompts live in `agents/personas.ts`.

**Model tiering:** personas use `POKE_CONDUIT_PERSONA_MODEL` (fast/cheap default), synthesis uses
`POKE_CONDUIT_SYNTH_MODEL` (strong default). Exact ids set when writing `model/claude.ts` after
consulting the `claude-api` skill; both env-overridable. Tests use `MockModel` (deterministic,
persona-shaped output), so no id dependency in CI.

## 6. Durability model

- **Step interface** (`durable/step.ts`): `{ run<T>(id: string, fn: () => Promise<T>): Promise<T> }`.
  `LocalStep` runs immediately and records `(id)` for assertions. Inngest's `step` satisfies the
  same shape in `api/inngest.ts`.
- **Idempotency:** every non-idempotent side effect (Poke push, run finalize) keys on
  `(runId, stepId)`; a `pc_runs` row transitions `running → done` exactly once (guarded by a
  conditional `UPDATE ... WHERE status='running'`).
- **Scheduler** (`durable/scheduler.ts`): `runScheduler(deps, now)`:
  selects `pc_triggers WHERE status='pending' AND fire_at <= now`, for each: compose message →
  `notifyUser()` → mark `fired` (and re-arm `fire_at += 1d` if `recurrence='daily'`). In prod an
  Inngest cron (`* * * * *`) calls it; in demo/tests we call it directly with a controlled `now`.

## 7. Proactivity & the two credentials

Two **independent** credentials, made explicit to avoid conflation:

| Direction | Mechanism | Auth |
|---|---|---|
| Poke → poke-conduit (user asks) | MCP tool call (Poke is MCP client) | inbound: `Bearer`/`x-poke-key` + `X-Poke-User-Id` |
| poke-conduit → user (proactive) | Poke inbound API `POST /api/v1/inbound/api-message` | outbound: `POKE_API_KEY` (user's V2 key) |

The inbound API makes Poke **act on** an injected message rather than relay it verbatim, so
proactive payloads are phrased as instructions, e.g. `{"message":"Remind me: <text>"}`. MVP
proactivity targets a **single Poke account** (the env `POKE_API_KEY`); multi-user proactivity
(per-user keys) is out of scope. The Poke endpoint is **mocked** in tests/demo via an injectable
`PokeClient`.

## 8. Data model (Neon Postgres / pg-mem; simple SQL only)

Columns are scalar `text`/`timestamptz`/`boolean`; lists/objects stored as JSON **text** and parsed
in app code (maximizes pg-mem ↔ Neon parity). All tables prefixed `pc_` so the schema can share the
existing bridge Neon DB without collision. `user_id` = the `X-Poke-User-Id`.

```sql
CREATE TABLE IF NOT EXISTS pc_backlog (
  id          text PRIMARY KEY,
  user_id     text NOT NULL,
  text        text NOT NULL,
  status      text NOT NULL DEFAULT 'open',     -- open | done
  pinned      boolean NOT NULL DEFAULT false,
  tags        text NOT NULL DEFAULT '',          -- comma-separated
  created_at  timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS pc_recipes (
  id          text PRIMARY KEY,
  user_id     text NOT NULL,
  name        text NOT NULL,
  prompt      text NOT NULL DEFAULT '',
  integrations text NOT NULL DEFAULT '[]',       -- JSON text
  enabled     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pc_status (
  user_id     text PRIMARY KEY,
  status      text NOT NULL DEFAULT 'active',     -- active | dnd | deep_work
  note        text NOT NULL DEFAULT '',
  until       timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pc_triggers (
  id          text PRIMARY KEY,
  user_id     text NOT NULL,
  kind        text NOT NULL DEFAULT 'reminder',   -- reminder | resurface
  text        text NOT NULL DEFAULT '',
  fire_at     timestamptz NOT NULL,
  recurrence  text NOT NULL DEFAULT 'none',        -- none | daily
  status      text NOT NULL DEFAULT 'pending',     -- pending | fired
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pc_runs (
  id          text PRIMARY KEY,
  user_id     text NOT NULL,
  kind        text NOT NULL DEFAULT 'council',
  status      text NOT NULL DEFAULT 'running',     -- running | done | error
  input       text NOT NULL DEFAULT '{}',          -- JSON text
  output      text NOT NULL DEFAULT '{}',          -- JSON text (povs + synthesis)
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
```

## 9. Stack, repo layout, config

**Stack:** TypeScript / Node 20 / ESM · `@modelcontextprotocol/sdk` · `@anthropic-ai/sdk` ·
`inngest` · `@neondatabase/serverless` + `pg-mem` · `@vercel/node` · `zod` · `vitest` + `tsx`.

```
poke-conduit/
  api/            mcp.ts · inngest.ts · healthz.ts        (Vercel functions)
  src/
    store/        index.ts (Store iface) · pg.ts (Neon) · pgmem.ts · schema.ts
    model/        index.ts (Model iface) · claude.ts · mock.ts
    durable/      step.ts · scheduler.ts
    agents/       orchestrator.ts · worker.ts · council.ts · personas.ts
    tools/        backlog.ts · council.ts · reminders.ts · status.ts · recipes.ts · index.ts
    mcp/          server.ts (tool registration) · auth.ts
    poke/         inbound.ts (PokeClient)
    http/         core.ts (shared request plumbing, ported from bridge)
    render.ts     (numbered-list / status-line rendering)
    config.ts     (env)
    serve.ts      (local HTTP service on :7411)
    demo.ts       (narrated e2e)
  test/           one *.test.ts per unit + feature + e2e
  docs/superpowers/specs/2026-06-18-poke-conduit-design.md
  package.json · tsconfig.json · vitest.config.ts · vercel.json · inngest.json
  README.md · DEPLOY.md · .env.example · .gitignore
```

**Env (`.env.example`):** `ANTHROPIC_API_KEY` · `POKE_CONDUIT_PERSONA_MODEL` ·
`POKE_CONDUIT_SYNTH_MODEL` · `DATABASE_URL` (Neon) · `POKE_API_KEY` · `MCP_AUTH_ENFORCE` ·
`MCP_BEARER_KEY` · `INNGEST_EVENT_KEY` · `INNGEST_SIGNING_KEY`. Demo/tests need **none** of these;
the demo prints how to set `ANTHROPIC_API_KEY` to go live.

## 10. Testing strategy (unit + feature + e2e, explicit failure logs)

- **Unit:** store CRUD + index→id resolution (pg-mem); `LocalStep` idempotency + double-run guard;
  `runScheduler` due-selection + daily re-arm; council fan-out + partial-failure degradation +
  synthesis (MockModel); MCP auth allow/deny; render output.
- **Feature:** every MCP tool end-to-end through the registered server on pg-mem + MockModel +
  mock PokeClient (asserts pushes fire with the right payload).
- **E2E (`npm run demo`):** narrates and asserts the full loop:
  `add_to_backlog ×3 → list → pin → convene_council(deliver:return) → schedule_reminder(now) →
  runScheduler → assert Poke push captured → get_result`. Auto-detects `ANTHROPIC_API_KEY`
  (live council if present, mock otherwise). Prints `PASS`/`FAIL ✗ <what failed + expected/actual>`
  per step and a final summary; non-zero exit on any failure.

## 11. Demo narrative (what the user sees)

> "Text Poke normally. Behind the scenes Poke consults poke-conduit: it files your notes into a
> durable backlog, convenes a council of four AI advisors who deliberate and text you back a
> synthesized recommendation, and proactively resurfaces reminders on a schedule — all over one MCP
> endpoint, no iMessage infrastructure of our own."

## 12. Deploy plan (final step; gated on user-held credentials only)

Build is **fully done locally** (test + demo green) before any deploy. Then, as credentials allow:
1. `vercel link` / deploy `api/*` (the bridge is already on Vercel → CLI likely authed; attempt).
2. `DATABASE_URL` → reuse the bridge's Neon DB (tables are `pc_`-prefixed) or a new branch.
3. Inngest Cloud: add `INNGEST_*` keys; register `api/inngest.ts`.
4. Set `POKE_API_KEY`, `ANTHROPIC_API_KEY`, `MCP_AUTH_ENFORCE=true`, `MCP_BEARER_KEY`.
5. Add the MCP URL to Poke (`npx poke@latest mcp add <url>`).
`DEPLOY.md` documents each command. Deploy is **not** a blocker for "built/tested/demo'd."

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Vercel function timeout vs multi-call council | Council runs as Inngest steps; MCP returns run_id; `deliver:"return"` caps wait ≤25s |
| pg-mem ≠ Neon SQL | Simple scalar/text-JSON schema only; same `schema.ts` both sides |
| Inngest needed for tests | `Step` injection → `LocalStep` in tests/demo; Inngest only in `api/inngest.ts` |
| Anthropic id/key drift | env-configurable ids; consult `claude-api` skill; MockModel default in CI |
| Poke inbound "acts not relays" | Payloads phrased as instructions; PokeClient mocked in tests |
| Concurrent duplicate runs | idempotent `pc_runs` finalize (`UPDATE ... WHERE status='running'`) |

## 14. Build sequence (feeds the implementation plan)

1. Scaffold: `package.json`, tsconfig, vitest, `.gitignore`, `config.ts`, `http/core.ts` (port).
2. `store/` (Store iface, schema, pg-mem, Neon) + tests.
3. `model/` (Model iface, MockModel, ClaudeModel via claude-api skill) + tests.
4. `durable/step.ts` + `scheduler.ts` + tests.
5. `agents/` (personas, worker, council, orchestrator) + tests.
6. `tools/` + `render.ts` + `mcp/` (server, auth) + `poke/inbound.ts` + feature tests.
7. `api/` (mcp, inngest, healthz) + `serve.ts`.
8. `demo.ts` (e2e) + run green.
9. README + DEPLOY + `.env.example`; attempt deploy; final report.
