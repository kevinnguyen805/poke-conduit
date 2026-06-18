# Deploying poke-conduit

Target: **Vercel** (edge functions) + **Neon** (Postgres). The only hard requirement is a Neon
database; everything else degrades gracefully.

## 1. Provision a database (required)

Create a Neon Postgres database and copy its pooled connection string. The schema is created
automatically on first request (`CREATE TABLE IF NOT EXISTS`, idempotent), so there is no migration
step. All tables are `pc_`-prefixed and collision-free, so this can safely share an existing Neon
database (e.g. the `poke-amb-bridge` one) or use a fresh one.

## 2. Environment variables

Set these in the Vercel project (Settings → Environment Variables), or via `vercel env add`:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **yes** | Neon connection string. Empty → falls back to in-memory pg-mem (local only). |
| `ANTHROPIC_API_KEY` | for real council | Set → council uses real Claude. Empty → deterministic `MockModel`. |
| `POKE_API_KEY` | for proactive push | Your Poke V2 API key. Empty → outbound pushes are logged, not sent. |
| `POKE_INBOUND_URL` | no | Defaults to `https://poke.com/api/v1/inbound/api-message`. |
| `MCP_AUTH_ENFORCE` | no | `true` to require auth on data tools. Default off (allow all — diagnostic-first). |
| `MCP_BEARER_KEY` | if enforcing | The key matched against the inbound `Bearer` / `x-poke-key`. |
| `MCP_RATE_MAX` | no | Max `POST /mcp` calls per identity per window. Default `120`. |
| `MCP_RATE_WINDOW_SEC` | no | Rate-limit window in seconds. Default `60`. |
| `CRON_SECRET` | recommended | If set, `/api/cron` requires `Authorization: Bearer <secret>`. Vercel sends this automatically for its own cron invocations. |
| `POKE_CONDUIT_PERSONA_MODEL` | no | Council persona model. Default `claude-haiku-4-5-20251001`. |
| `POKE_CONDUIT_SYNTH_MODEL` | no | Synthesis model. Default `claude-fable-5`. |

## 3. Deploy

```bash
npm i -g vercel        # if needed
vercel link            # link/create the project
vercel env add DATABASE_URL production    # repeat for the others
vercel --prod          # deploy
```

The edge functions in `api/` are auto-detected. `vercel.json` maps clean paths
(`/mcp`, `/cron`, `/healthz`) to them and registers the cron job. The root path `/` serves a
static landing page (`public/index.html`) describing the server; a browser `GET /mcp` returns
friendly server info (not a 500) instead of requiring a JSON-RPC POST.

### Verify

```bash
curl https://<your-deployment>/healthz
# {"ok":true,"service":"poke-conduit","version":"0.1.0"}

curl -s https://<your-deployment>/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
# 12
```

## 4. The cron schedule (read this)

`vercel.json` ships a **daily** tick (`0 13 * * *` — 13:00 UTC) so it **deploys out of the box on
Vercel Hobby**, which rejects any sub-daily cron (`Hobby accounts are limited to daily cron jobs`).
The scheduler itself is minute-resolution — it fires every trigger whose `fire_at` has passed
whenever it's ticked — so the cadence is purely a question of how often `/api/cron` gets hit. Two
ways to get finer than daily:

- **Vercel Pro:** change the schedule to `* * * * *` (every minute) and redeploy. Done.
- **Hobby (or any plan):** leave the daily Vercel cron as a safety-net heartbeat and drive
  `/api/cron` externally as often as you like — it's a plain endpoint any scheduler can hit:

  ```bash
  curl -s https://<your-deployment>/cron -H "Authorization: Bearer $CRON_SECRET"
  ```

  (e.g. cron-job.org, a GitHub Action on a schedule, or a Poke recipe). The tick is idempotent —
  it only fires triggers whose `fire_at` has passed and flips them out of `pending` — so ticking
  it more often never double-fires.

## 5. Point Poke at it

Add an MCP integration in Poke targeting `https://<your-deployment>/mcp`. Poke's client:

- sends the integration API key as `Authorization: Bearer <key>`, and
- **auto-injects** `x-poke-user-id` (the per-user id that scopes all stored data).

Auth behavior with `MCP_AUTH_ENFORCE=true`: a call is allowed if it is **keyed** (Bearer/x-poke-key
matches `MCP_BEARER_KEY`) **or** carries a Poke-injected user id — so real Poke traffic always
passes (it injects a uid), and only fully-anonymous probes (no key, no uid) are rejected with
`-32001`. Set `MCP_BEARER_KEY` to the integration key if you also want keyed callers to pass without
relying on the uid. With enforcement **off** (default), all calls are allowed — good for first
connection and diagnostics; turn it on once the integration is wired.

On connect, Poke reads the server's `instructions` (an onboarding blurb introducing all capabilities
and a "don't auto-act" guardrail). Then just text Poke naturally: *"save this to read later"*,
*"what's on my list?"*, *"convene the council on X and get back to me"*, *"remind me to … tomorrow
at 9"*, *"I'm in deep work until 5"*.

## Notes

- **Async council** (`deliver=async`) backgrounds the work after responding. In a long-lived process
  (`npm run serve`) it always completes; on serverless it is best-effort unless the run is moved onto
  Inngest via the `fromInngestStep` adapter. `deliver=return` (the default) is always reliable and is
  what the tests and demo exercise.
- **Runtime:** edge Web handlers (the Neon serverless driver is HTTP-based and needs no persistent
  connection). pg-mem is a dev dependency only and never enters the production bundle.
