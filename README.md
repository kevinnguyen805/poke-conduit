# poke-conduit

**The durable brain Poke consults.** Poke already lives in iMessage (sanctioned, no Apple API, no
ban risk) and is an **MCP client** that calls external MCP servers. poke-conduit inverts the usual
integration: instead of building our own iMessage transport, **Poke is the front-end terminal** and
poke-conduit is the **MCP server it calls** — a production-shaped, durable, multi-agent backend.

```
  iMessage  ──►  Poke (MCP client)  ──►  poke-conduit /mcp  ──►  Postgres (Neon)
                      ▲                        │  orchestrator · worker-agents
                      └───── proactive push ───┘  council · backlog · scheduler
                          (Poke inbound API)
```

You text Poke; Poke calls a tool here; poke-conduit does durable work and can **text you back later**
through Poke's inbound API (async council verdicts, fired reminders).

## What it does

| Capability | Tools | Notes |
|---|---|---|
| **Queued-notes backlog** (flagship) | `add_note` · `list_backlog` · `complete_note` · `pin_note` | Durable to-read / to-do queue, 1-based refs, pinning. |
| **Council** (multi-agent) | `ask_council` · `council_status` | Fans a hard question out to four persona agents (Builder · Skeptic · Operator · User-Advocate), then a synthesizer makes the call. `deliver=return` replies inline; `deliver=async` returns now and **pushes** the verdict when ready. |
| **Proactive reminders** | `set_reminder` · `list_reminders` | Minute-resolution scheduler fires due reminders and pushes them via Poke. One-shot or `daily`. |
| **Availability / DND** | `get_status` · `set_status` | `active` / `dnd` / `deep_work`, optional note + `until`. |
| **Recipes** | `list_recipes` · `install_recipe` | Saved named routines. |

## Architecture

A few small, single-responsibility seams make the whole thing testable offline and deployable with
just Neon:

- **Hand-rolled MCP** (`src/mcp/`, `src/http/core.ts`) — a Streamable-HTTP JSON-RPC handler over Web
  `Request`/`Response`. No SDK: the surface Poke speaks is tiny, and hand-rolling keeps it
  edge-runtime-compatible and fully unit-testable. (Same choice the `poke-amb-bridge` made.) `POST
  /mcp` is rate-limited per identity (Poke user id, else IP) via a `RateLimiter` port
  (`src/http/ratelimit.ts`) — in-memory locally, Postgres-backed in prod; a static landing page is
  served at `/`, and a browser `GET /mcp` returns friendly server info instead of a 500.
- **`Store` port** (`src/store/`) — one `SqlStore` runs on **pg-mem** (tests / `serve` / demo) and
  **Neon** (prod) over an injected `Sql` driver. All timestamps are ISO text so they sort lexically
  and round-trip byte-identically between the two.
- **`Model` port** (`src/model/`) — `ClaudeModel` when `ANTHROPIC_API_KEY` is set, else a
  deterministic `MockModel` (so tests and the demo need zero credentials).
- **`Step` seam** (`src/durable/step.ts`) — council logic is written once against `Step`. It runs
  under `LocalStep` (in-process, memoized) inline within Vercel's 300 s budget today; the
  `fromInngestStep` adapter is the documented upgrade to true multi-hour durability.
- **Two credentials, two directions** — *inbound* (Poke → conduit: `Bearer`/`x-poke-key` +
  injected `x-poke-user-id`, gated by `MCP_AUTH_ENFORCE`) is distinct from *outbound* (conduit →
  Poke: `POKE_API_KEY` to Poke's inbound API, which makes Poke **act on** the message).

## Run it locally

No credentials required — it falls back to pg-mem + MockModel + a mock Poke client.

```bash
npm install
npm test          # 101 tests (unit + tool handlers + full MCP wire e2e)
npm run demo      # narrated, self-asserting end-to-end walkthrough (19 checks)
npm run serve     # local HTTP server: GET / · POST /mcp · GET /cron · GET /healthz
```

The demo runs the **real wire path** (`handleMcp(Request) → Response`) and never sends a real
message. Set `ANTHROPIC_API_KEY` first to watch the council deliberate with real Claude:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run demo
```

Drive the local server by hand:

```bash
npm run serve &
curl -s localhost:7411/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'   # 12
```

## Deploy

See **[DEPLOY.md](./DEPLOY.md)** — Vercel (edge functions) + Neon, env vars, the cron schedule
caveat, and how to point Poke at your `/mcp` endpoint.

## Project layout

```
api/       mcp.ts · cron.ts · healthz.ts · _store.ts   (Vercel edge entry points)
public/    index.html                                  (static landing page served at /)
src/
  config.ts · ids.ts
  store/   types · schema · sql (SqlStore) · pgmem · pg (Neon) · index
  model/   types · mock · claude · index
  durable/ step.ts (Step · LocalStep · fromInngestStep)
  poke/    index.ts (PokeClient · HttpPokeClient · MockPokeClient)
  agents/  personas · worker · council · orchestrator
  tools/   backlog · reminders · status · recipes · council · index
  mcp/     auth.ts · server.ts (JSON-RPC)
  http/    core.ts (Request→Response core) · ratelimit.ts (RateLimiter port)
  scheduler.ts · render.ts · serve.ts · demo.ts
test/      store · model · step · council · scheduler · render · auth · tools · mcp · ratelimit
docs/superpowers/  specs/ · plans/
```

Built as a finished MVP from a design spec → plan → task-by-task implementation, tests written
immediately after each unit. See `docs/superpowers/` for the spec (with the as-built addendum) and
the implementation plan.
