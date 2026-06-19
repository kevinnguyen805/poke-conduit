# Running the Spectrum iMessage agent

This is the standalone consumer-iMessage agent — poke-conduit's tool library on
its **own** iMessage line (agent-as-contact), with a natural-language brain. The
MCP server (`/mcp`) is unaffected and still runs as before.

## What you get (Phase A — "works when I drive it")
- The agent **texts you first**: a reminder fires with a native **effect**.
- **Tapback** a completion: "mark 2 done" → 👍 on your message + a confirmation.
- One native **poll**: "which should I do first?" → tap to pick; your vote pins it.
- **Talks back** on anything off-script (it never goes silent or says "I can't").

Out of scope here (Phase B): the council on the line, group chats, the stranger-
ready router eval loop, the tappable app-tray icon (that's a native Swift extension).

## 1. Provision a Spectrum Cloud line
1. Sign up at **https://app.photon.codes**.
2. Create a project; copy its **Project ID** and **Project Secret** (Settings).
   > ⚠️ Use a **burner Apple ID on a spare device/VM** for any local/on-device
   > experiments — never automate iMessage on your primary Apple ID.

## 2. Environment
| Variable | Required | Purpose |
|---|---|---|
| `SPECTRUM_PROJECT_ID` | **yes (both run modes)** | Spectrum Cloud project id. |
| `SPECTRUM_PROJECT_SECRET` | **yes (both run modes)** | Spectrum Cloud project secret. |
| `DATABASE_URL` | recommended | Neon Postgres (shared `pc_*` schema). Empty → in-memory pg-mem (state resets on restart). |
| `ANTHROPIC_API_KEY` | for the real brain | Set → ClaudeRouterModel (real NL routing). Empty → deterministic MockRouterModel (keyword routing — fine for a keyword-routing demo). |

Both `--terminal` and the default iMessage mode require valid Cloud credentials.
`Spectrum()` authenticates the project against Spectrum Cloud at construction
regardless of provider (verified on spectrum-ts@5.0.0: empty creds → ZodError;
placeholder creds → SpectrumCloudError 422 VALIDATION_ERROR from a Cloud network
call). There is no credential-free / offline mode.

## 3. Run
```bash
# Drive from your terminal (stdin) — no phone needed, but still requires the
# Cloud creds above. Useful for iterating once your project is provisioned.
npm run spectrum -- --terminal

# Bind the real iMessage line (also requires SPECTRUM_PROJECT_ID/SECRET):
npm run spectrum
```

On successful boot, both modes print:

```
[spectrum] agent live on provider '<name>' — texting back.
```

## 4. Driven-demo script (record this)
With the live line connected and your number texting the agent (or, in
`--terminal` mode, typing the messages below at the prompt):

1. **"save the spectrum launch checklist"** → "Added to your backlog…".
2. **"remind me to stretch in 1 minute"** → "Reminder set for …". Wait — the
   agent **texts you first** with a 🔦 spotlight effect.
3. **"what's on my list?"** → numbered backlog.
4. **"mark 1 done"** → 👍 tapback on your message + a text confirmation.
5. Add a second item, then **"which should I do first?"** → a native **poll**;
   tap an option → the agent pins that item and replies: *On it — pinned "…"
   to the top. Let's start there.*
6. **"how's it going?"** → a warm conversational reply (the out-of-domain surface).

## Architecture (one screen)
- `app.ts` — the only SDK file: boots `Spectrum(...)` (both providers need real
  Cloud creds), iterates `app.messages` and handles each one inside
  `app.responding()` (for the typing indicator), keeps a live-space map for
  proactive delivery, ticks the scheduler every 60 s.
- `handler.ts` — routes each inbound via `router.ts`, runs the matched tool with a
  rebuilt `ToolContext`, delivers with native texture (👍 tapback for
  `complete_note`, native poll when the result carries one, text otherwise);
  poll votes take a lightweight branch that pins the chosen item. SDK-free + fully
  unit-tested.
- `delivery.ts` — `SpectrumDelivery` (the `PokeClient` seam) sends verbatim to the
  user's live space, multi-tenant, with a `spotlight` effect for reminder pushes.
  Cold cross-process delivery (GUID not yet seen this session) is Phase-B.
- Reused unchanged: `tools/`, `store/`, `model/`, `scheduler` (widened, backward-compatible).
