As of 2026-11-17 · default branch main @ 965010d (2026-06-19)

# poke-conduit: hand-off

## What this is
An MCP server that Poke (the AI assistant you talk to over iMessage) calls as a client: "the durable brain Poke consults." It gives Poke 13 tools across a queued-notes backlog, a 6-persona council with synthesis, proactive reminders (pushed back through Poke's inbound API), availability/DND status, and executable recipes. Stack: TypeScript, hand-rolled Streamable-HTTP JSON-RPC on Vercel Edge, Neon Postgres (pg-mem offline), Anthropic SDK (MockModel offline), vitest. Live: https://poke-conduit.vercel.app (`/healthz` returned 200 on 2026-11-17). Public repo.

A second, additive app lives in `src/spectrum/`: a standalone iMessage agent on Photon's Spectrum SDK (its own iMessage line, natural-language router, tapbacks, polls, effects) that reuses the same tools and store with no Poke in front. It is not deployed; it runs as a long-lived local process.

Relation to other repos: built 2026-06-18 right after poke-amb-bridge and copies its choices (hand-rolled JSON-RPC, edge runtime, CI shape). DEPLOY.md and `.env.example` say its `pc_`-prefixed tables can share the poke-amb-bridge Neon database. The migration map calls poke-amb-bridge "its own thing" and AMB a non-goal. No relation to imsg-mcp is stated.

## Run, test, deploy
| Task | Command |
|---|---|
| Install | `npm install` (CI: `npm ci` on Node 20. Node 22 also passes) |
| Test | `npm test` (`vitest run`; about 168 cases by grep count. README says 129, written before the Spectrum work) |
| Typecheck | `npm run typecheck` |
| Demo | `npm run demo` (self-asserting walkthrough over the real MCP wire path, no credentials) |
| Local server | `npm run serve` (port 7411: `/`, `/mcp`, `/cron`, `/healthz`) |
| Spectrum agent | `npm run spectrum` (live iMessage line) or `npm run spectrum -- --terminal` (stdin). Both need Spectrum Cloud credentials |
| Deploy | `vercel --prod` per DEPLOY.md. CI (`.github/workflows/ci.yml`) runs typecheck + test on every push and PR |

Env vars (names only):
- MCP server: `DATABASE_URL` (required in prod; unset means `POST /mcp` returns a deliberate 503 / `-32002`), `ANTHROPIC_API_KEY`, `POKE_API_KEY`, `POKE_INBOUND_URL`, `MCP_AUTH_ENFORCE`, `MCP_BEARER_KEY`, `MCP_RATE_MAX`, `MCP_RATE_WINDOW_SEC`, `CRON_SECRET`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `POKE_CONDUIT_PERSONA_MODEL`, `POKE_CONDUIT_SYNTH_MODEL`, `PORT`.
- Spectrum agent: `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET`, plus `DATABASE_URL` and `ANTHROPIC_API_KEY`.

External services: Vercel (edge functions, daily cron `0 13 * * *` on `/api/cron`), Neon Postgres, Anthropic API, Poke inbound API (`https://poke.com/api/v1/inbound/api-message`), optional Inngest, Spectrum Cloud (app.photon.codes) for the Spectrum agent.

## Where it was left off
Last work: 2026-06-19, the full Spectrum Phase A build (Tasks 1 to 11 of the Spectrum plan, commits 9d2bf39 to 965010d), ending with doc fixes that "terminal mode" is not offline. These 16 commits (8bbdd0a onward) were local only until 2026-10-23, when they were pushed before the laptop trade-in. CI on main at 965010d ran 2026-10-23: success.

Works:
- MCP server: deployed and responding. 13 tools, auth gate, per-identity rate limit, landing page, graceful inert mode. Demo and tests green.
- Spectrum agent: code complete for Phase A and unit-tested with structural fakes. The SDK file `src/spectrum/app.ts` is not covered by tests.

Unknown or not done:
- Whether prod has `DATABASE_URL`, `POKE_API_KEY`, `ANTHROPIC_API_KEY` set. Commit 3d16621 shipped prod with no secrets ("inert"). No later record says they were added. Whether Poke was ever pointed at this `/mcp` is also unrecorded.
- Whether the Spectrum agent ever ran against a real Spectrum Cloud line. SPECTRUM.md has a driven-demo script ("record this"); no commit or doc records a run or a recording.
- The GitHub repo description ("12 tools / 4 capabilities ... 92 tests") is stale: the code has 13 tools in 5 capability groups and about 168 tests.

## History and decisions
| Date | Decision or milestone | Why | Source |
|---|---|---|---|
| 2026-11-17 | Lockfile-only audit-fix PR #1 (c3/h21/m23 to c3/h15/m21). Dependabot security job for `undici` failed with `security_update_not_possible` | Account-wide security pass. No malware or compromise found | PR #1 body, `gh run list` |
| 2026-10-23 | Spectrum commits pushed to GitHub | Pushed local-only work before laptop trade-in | CI run on 965010d dated 2026-10-23 |
| 2026-06-19 | Docs and comments corrected: both Spectrum providers authenticate against Spectrum Cloud at boot; no credential-free mode | Verified on spectrum-ts@5.0.0: empty creds give ZodError, placeholder creds give 422 | 16aeb31, 965010d, docs/SPECTRUM.md §2 |
| 2026-06-19 | Spectrum agent built as additive `src/spectrum/`; only `app.ts` imports the SDK; structural types keep the core SDK-free; council excluded from the line | Migration map: reuse the tool library, keep the MCP server untouched; council already runs better inside MCP | 9d2bf39 to bb3fad1, 3503203, migration map §0/§8 |
| 2026-06-19 | Phase A scoped as "works when I drive it" (about 1 week), router eval loop off the critical path; Spectrum Cloud chosen over local `imessage-kit` | Map §5/§6 after 3 review loops: stranger-ready tuning is open-ended; local mode can't provision a line or send a contact card | docs/spectrum-migration-map.md §5, §6, §10 |
| 2026-06-19 | Map's own counter-case recorded: a Spectrum build is a weak job artifact (not linkable, third proof of the same thesis). Build only for the experience | Loop 3 red-team | migration map §0.5, §5a, §10 |
| 2026-06-19 | Spectrum API facts corrected from source (polls via `poll(title, options)`, tapbacks via raw emoji `message.react`, `message.content.text`) | Photon's prose differed from `spectrum-ts@5.0.0` source | Spectrum plan "Corrections baked in" |
| 2026-06-19 | Default synth model `claude-opus-4-8` | `claude-fable-5` was access-gated | 8bbdd0a |
| 2026-06-18 | `POST /mcp` with no `DATABASE_URL` returns 503 + JSON-RPC `-32002`, not a raw 500 | Public artifact should look intentionally inert, not broken | 4a1332a |
| 2026-06-18 | Optional Inngest provider for async council, lazily imported; `inngest` not a dependency | True serverless durability when switched on, 3-dep core otherwise | f0da16d (backlog item #3, not a GitHub PR) |
| 2026-06-18 | Recipes gain executable `steps` macros validated by zod at install; recipe tools can't recurse; council grows from 4 to 6 personas (Strategist, Pragmatist) | Make recipes runnable; fill gaps in the panel | 7c1447f (backlog item #8, not a GitHub PR) |
| 2026-06-18 | Landing page at `/`, per-identity rate limit (`-32029`), friendly `GET /mcp` | Mirror the bridge's public surface; GET /mcp was 500ing | 1640372 |
| 2026-06-18 | CI added, then actions bumped to checkout@v7 / setup-node@v6 | Mirror poke-amb-bridge; clear Node 20 deprecation warning | 2ffbdb3, 30d8df4 |
| 2026-06-18 | MockModel NUL separator written as an escape | Raw NUL byte made git treat the file as binary | f526f38 |
| 2026-06-18 | Vercel cron set to daily; deployed to prod with no secrets | Hobby plan rejects sub-daily crons; scheduler is minute-resolution if `/cron` is hit more often | 3d16621, DEPLOY.md §4 |
| 2026-06-18 | Dropped `@modelcontextprotocol/sdk` (hand-rolled JSON-RPC) and Inngest from the critical path (inline `LocalStep` + Vercel Cron) | SDK is Node-only, not edge-compatible; council is about 5 calls, well under the 300 s budget; deploy with only Neon | 7bd42e2, design spec "Build addendum" |
| 2026-06-18 | Ports and seams: `Store` (pg-mem/Neon, ISO-text timestamps), `Model` (Mock/Claude), `Step` (LocalStep/Inngest), `finishRun` compare-and-swap | Offline-testable, idempotent council runs | 7ba439f, 7d55313, 660647b, 9d6e0bd |
| 2026-06-18 | Two credentials, two directions: inbound key + Poke-injected `x-poke-user-id`; outbound `POKE_API_KEY` with payloads phrased as instructions | Poke's inbound API "acts, not relays" | design spec §7, §13 |
| 2026-06-18 | Design spec approved, 9-task plan | Product: Poke as front-end terminal, conduit as durable backend | e617563, 9ebb3a2 |

## In-flight work
| Branch | PR | Ahead / behind main | Contents | State |
|---|---|---|---|---|
| `security/npm-audit-fix` | #1 open | 1 ahead / 0 behind | `package-lock.json` only | CI green (typecheck + test). Checked on Node 22 |
No other branches. No issues.

## Planned next steps
| Item | Source | Status |
|---|---|---|
| Run the Spectrum driven demo on a real line and record it | docs/SPECTRUM.md §4 | Unknown. No record it happened |
| Provision Spectrum Cloud project (burner Apple ID for any local experiments) | docs/SPECTRUM.md §1, migration map §6 | Unknown |
| Phase B: cold cross-process delivery (SDK space-get) | `src/spectrum/app.ts:43`, `delivery.ts:14` comments; Spectrum plan | Not started. Today reminders reach only spaces seen by the same process |
| Phase B: carry item id in poll options instead of text matching | `src/spectrum/handler.ts:41` | Not started |
| Phase B: monotonic turn key for same-millisecond ordering | `src/store/sql.ts:323` | Not started |
| Phase B: async proactive-delivery showpiece pointed at the existing council; group chats; router eval loop; two-tier router; mini-app card | migration map §4b, §8; SPECTRUM.md "Out of scope" | Not started |
| Phase C: native Swift iMessage app-tray extension | migration map §0, §8 | Out of scope, not started |
| Alternative to the build: half-day memo + Loom on porting to Spectrum | migration map §5a | Unknown |
| Prod wiring: set `DATABASE_URL`, `POKE_API_KEY`, `ANTHROPIC_API_KEY`, `MCP_AUTH_ENFORCE=true`, `MCP_BEARER_KEY`; add `/mcp` to Poke | design spec §12, DEPLOY.md §2 and §5 | Unknown (secrets not visible from the repo) |
| Finer-than-daily cron (Vercel Pro or external pinger on `/cron`) | DEPLOY.md §4 | Not started per repo |
| Inngest in prod | DEPLOY.md §6 | Optional, not started (package not installed) |

## Gotchas
- **Spectrum has no offline mode.** The Spectrum plan said creds were optional for terminal runs; that was wrong. Three commits fixed the claim. Both `--terminal` and iMessage modes call Spectrum Cloud at boot.
- **Burner Apple ID only** for any local iMessage automation (migration map §6 safety rule).
- `.env.example` still sets `POKE_CONDUIT_SYNTH_MODEL=claude-fable-5`, which is access-gated. Code default is `claude-opus-4-8`. Copying `.env.example` as-is will override the working default. The Spectrum `ClaudeRouterModel` also uses the synth model setting.
- Commit messages "(#3)" and "(#8)" are internal backlog numbers, not GitHub PRs.
- `inngest` is loaded through a non-literal import so tsc and CI pass without it. Setting `INNGEST_EVENT_KEY` without `npm install inngest` will fail at runtime.
- pg-mem must stay out of the edge bundle: `api/_store.ts` imports `makeNeonStore` directly, not the store index.
- Vercel Hobby rejects sub-daily crons. Keep `vercel.json` daily unless on Pro.
- Async council (`deliver=async`) is best-effort on serverless without Inngest. `deliver=return` is the reliable path.
- With `MCP_AUTH_ENFORCE=true`, calls pass if keyed or if they carry a Poke-injected uid (same rule poke-amb-bridge adopted after keyless installers got stuck).
- `spectrum-ts` is a runtime dependency but only `src/spectrum/app.ts` imports it; no `api/` file does.
- Dependabot cannot auto-fix the transitive `undici` advisory (`security_update_not_possible`); it needs a manual parent bump.

## Sources
- Files on main: README.md, DEPLOY.md, docs/SPECTRUM.md, package.json, vercel.json, .env.example, .github/workflows/ci.yml, src/config.ts (env lines), src/spectrum/app.ts and router.ts (greps)
- Docs: docs/superpowers/specs/2026-06-18-poke-conduit-design.md (addendum, §12 to §14), docs/superpowers/plans/2026-06-18-poke-conduit.md (headings), docs/superpowers/plans/2026-06-19-spectrum-imessage-agent.md (header, corrections, self-review), docs/spectrum-migration-map.md (§0 to §1, §5 to §6, §8 to §11)
- Commit log and bodies for all 34 commits
- Branch `security/npm-audit-fix`; PR #1 body; `gh run list` (CI + Dependabot); Dependabot run 44182992946 log
- greps for TODO/FIXME/Phase-B; `curl` of `/healthz` on 2026-11-17 (200)
