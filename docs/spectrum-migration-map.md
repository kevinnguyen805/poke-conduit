# poke-conduit → Spectrum "Layer-1" Migration Map

**Status:** v2 — reviewed (3 adversarial loops complete) · **Date:** 2026-06-18 · **Owner:** Kevin
**Reviewed by:** Loop 1 (correctness) · Loop 2 (approach) · Loop 3 (red-team) — see changelog (§11)

---

## 0. What this document is

A concrete, file-by-file map of the work to turn **poke-conduit** (today: a stateful MCP
*server* — durable per-user store, stateless JSON-RPC transport — that Poke calls) into a
**standalone consumer-iMessage agent** that owns its own
iMessage line and *is* the contact — what the prior analysis called **Layer 1**.

It exists to replace a vibe ("days, in-stack") with a verifiable task list, and to be torn
apart by review before any code is touched.

> **Framing (Loop-2):** the unit of reuse is the conduit's **tool library** (`tools/`, `agents/`,
> `store/`, `model/`), not the MCP *server*. The MCP server stays alive and untouched as its own
> working proof; this is an **additive** new app (`src/spectrum/`) that *imports* those handlers —
> not a rewrite that retires anything. "Migration" here means the *experience* migrates from
> inside-Poke to its-own-line, not a port. (Corollary: don't bend the new app around MCP-shaped
> abstractions — the text-only `Model` port and the instruction-phrased `PokeClient` both change.)

### The three layers (recap, so this doc stays scoped)

| Layer | Experience | Build path | This doc |
|---|---|---|---|
| **0 — today** | Text bubbles relayed *through* Poke | done | — |
| **1 — target** | Your **own** iMessage line; agent-as-contact; proactive push; rich in-thread payloads (effects, cards, polls, contact card) | TypeScript, in-stack | **← this doc** |
| **2 — stretch** | The literal tappable **app-tray icon** | native Swift iMessage App Extension → TestFlight/App Store | out of scope (named in §9) |

Layer 2 is explicitly **not** in this migration. Confirmed by Spectrum's own docs: even
their `customizedMiniApp` card carries an `extensionBundleId` + `teamId` — i.e. the card is
a payload, but the interactive app it opens is a **native extension you build and ship**.
No framework removes that.

---

## 0.5 Why this might be the wrong build (the counter-case)

> **Read this before §1.** Loop 3 (red-team) argues the strongest version of "don't build
> this." It survived verification; the rest of the doc is the case *for* building, so this
> section keeps that case honest.

**A. The stack is optically complicated for the job.** Poke is a *consumer app*; Photon (which
makes Spectrum) is an *infrastructure company* — they sit at **different layers of the same
category** ("AI agents in iMessage"), not head-to-head. So this is **not** "endorsing a direct
competitor" (an earlier red-team draft said so; web-verification corrected it). But the sharper
edge is real: **Poke built its own iMessage delivery as its hard-won moat; Spectrum sells exactly
that capability to everyone.** Building your flagship Poke-application artifact *on Spectrum's
rails* is therefore awkward-if-unframed — it can read as "I reach for the commoditized infra you
chose to build in-house." Defensible as whole-stack fluency ("I understand the layer you had to
build yourselves"), but it must be **named and framed**, never left implicit. Severity: **serious,
manageable — not lethal.**

**B. The artifact doesn't ship as a portfolio piece.** poke-conduit and poke-amb-bridge are
*linkable*: a recruiter opens a URL, reads the README, sees green CI. A live iMessage agent on
Spectrum is an **ephemeral, credentialed, single-line experience** — you cannot hand someone "the
number" the way you hand them a URL. The job-artifact deliverable is therefore a **video/Loom + a
repo**, not a running thing they can touch — a materially weaker proof per hour than the two you
already have. Severity: **lethal to the "it's a job artifact" claim** (not to the build itself).

**C. It is a third proof of a thesis already proven twice.** "Kevin is a PM who codes
agent-in-iMessage infra" is *already* demonstrated by poke-conduit (MCP server) and poke-amb-bridge
(linking bridge), both public + deployed. The genuinely *new* capability here is the **NL-router
brain** (§4b) — the one thing Poke did for you that you've never built. If the point is to
learn/prove something new, that brain is the only part that qualifies; the rest is a re-skin of
shipped work. Severity: **serious (redundancy), with one real exception (the brain).**

**What this changes — and what it doesn't.** It does **not** kill the build: the *experience* (an
agent that texts you first, natively) is genuinely worth wanting — that's the user's stated goal-2.
It **does** demote the job rationale from "load-bearing" to "bonus, framing-dependent," re-price
scope to a demo you drive (§5), and force an honest §10. If the *only* reason to build were the job,
the half-day alternative in §5a wins. Build it because you want the experience — and frame the stack
deliberately when you show it.

---

## 1. The core architectural change in one sentence

> Today Poke owns the transport **and the natural-language brain**; poke-conduit only
> supplies tools + storage + a sub-agent council. Layer-1 means **poke-conduit grows its own
> transport _and_ its own brain**, and keeps everything else.

```
TODAY                                   LAYER 1
─────                                   ───────
User → iMessage → Poke                  User → iMessage → Spectrum managed line
                   │  (NL→tool call)                       │  (raw text)
                   ▼                                        ▼
            poke-conduit /mcp                        app.messages loop
              handleRpc()                              router()  ← NET NEW (the brain)
                   │                                        │  (NL→{name,args})
                   ▼                                        ▼
            tool.handler(args, ctx) ───────────────► tool.handler(args, ctx)   [REUSE]
                   │                                        │
   proactive: PokeClient.push(instruction) ──────► space.send(payload)         [SWAP behind iface]
```

---

## 2. What **stays** (reuse — the "product behavior" Spectrum says you own)

These are transport-agnostic today and move over untouched:

- `src/tools/*` — `backlog.ts`, `reminders.ts`, `council.ts`, `recipes.ts`,
  `recipe-runner.ts`, `status.ts`. Each exports `ToolDef`s whose `handler(args, ctx)` is
  pure logic over the `Store`. **No transport assumptions.** ✅ reuse as-is.
- `src/tools/index.ts` — `ALL_TOOLS` + `findTool(name)`. The router will call these directly. ✅
- `src/agents/*` — `council.ts`, `orchestrator.ts`, `personas.ts`, `worker.ts`. The
  6-persona fan-out + synthesis. ✅ pure reuse.
- `src/store/*` — `pg.ts`, `pgmem.ts`, `schema.ts`, `sql.ts`, `types.ts`, `index.ts`. Neon
  in prod, pg-mem in tests. ✅ reuse (one additive table in §4).
- `src/model/*` — `claude.ts`, `mock.ts`, `index.ts`, `types.ts`. ✅ reuse (the router will
  also use this — see §4).
- `src/durable/*` — `step.ts`, `inngest.ts`. Async council durability. ✅ reuse.
- `src/scheduler.ts` — fires due reminder triggers. ✅ logic reuse; only the **delivery
  call** at the end changes (§3).
- `src/ids.ts`, `src/config.ts` — ✅ reuse + extend config (§4).

**Infrastructure / deployment layer (Loop-1 review caught these missing from v1):**
- `src/http/core.ts` — ⚠️ **partial reuse, load-bearing.** Its `makeToolContextFactory` is what
  wires `store + model + delivery + makeStep + background + dispatchAsyncCouncil` into a
  `ToolContext`. The Spectrum loop (§4a) must **replicate this exact wiring** — the 6-line
  `app.ts` snippet hides it. This is real work, not boot boilerplate.
- `src/http/ratelimit.ts` — ✅ stays (reusable hygiene; the surviving MCP entry point keeps it).
- `src/serve.ts`, `src/demo.ts` — ✅ stay; both drive the **MCP wire path**, so they keep working
  but do **not** exercise the new Spectrum path → a parallel Spectrum smoke harness is new work (§5).
- `src/mcp/auth.ts`, `api/mcp.ts` — ✅ stay as the **second entry point**: the MCP transport runs
  unchanged alongside the new Spectrum loop. This is what §6 "coexist" concretely means.
- `api/cron.ts` — ⚠️ **changes:** today it ticks the scheduler, which pushes via the single
  `POKE_API_KEY` owner. Layer-1 must resolve a **per-user** delivery target (§4d) here.
- `api/healthz.ts`, `api/inngest.ts`, `api/_store.ts` — ✅ stay unchanged.

**Reuse estimate: the capability code (~the 13 tools + council + store + scheduler) carries
over ~wholesale.** The honest caveat is that this is reuse of *capabilities*, not of the
*system* — see §5.

---

## 3. What **changes** (swap behind an existing seam)

### 3a. Outbound delivery: `src/poke/index.ts` → a Spectrum delivery client
The outbound path is already behind a clean interface:
```ts
export interface PokeClient { push(instruction: string): Promise<PushResult>; }
```
Today `HttpPokeClient.push()` POSTs an **instruction** ("Send me a reminder that says…") to
Poke's inbound API, because Poke *acts on* it. In Layer-1 there is no second assistant —
you send the **actual message** to the user via `space.send(...)`.

- **Add** `SpectrumDelivery` implementing the same shape, but it sends *verbatim* text/payloads,
  not instructions. The "phrase as an instruction to Poke" rephrasing logic is **deleted**, not ported.
- Proactive sends need a **target**: a stored Spectrum `space`/chat GUID per user (§4).
- Keep `MockPokeClient` (rename → `MockDelivery`) for tests/demo. ✅ the interface seam means
  callers (scheduler, async council) don't change.
- ⚠️ **Interface caveat (Loop-1):** today's port is `push(instruction: **string**)`. That carries
  plain verbatim text cleanly, but it **cannot carry a poll/effect/card payload**. The seam is clean
  for the text-first phase (§3b); the moment rich payloads land you must **widen the interface** (add
  a `pushPayload(...)` method or a typed union). So §3a and §3b are *sequenced*, not simultaneous.

### 3b. Rendering: `src/render.ts` text-only → payload renderer
`render.ts` is by its own header *"Pure formatters: store entities → the human-facing **text Poke
relays to the user**."*
Extend (don't replace) it to emit Spectrum payloads where it helps:
- `renderBacklogList` → text today; could become a **list** payload later (keep text first).
- council verdict → text (already good); optionally a **poll** for "which option?" decisions.
- reminders → text + optional **message effect** on the fire.
- Keep every function returning a plain-text fallback so non-iMessage / pre-iOS-26 still works.
**Scope discipline: ship text-first; add payloads per-flow afterward.** Payloads are upside,
not a blocker for a working agent.

---

## 4. What is **net-new** (the real work)

### 4a. `src/spectrum/app.ts` — the runtime loop _(small)_
```ts
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const app = await Spectrum({
  projectId: config.spectrumProjectId,
  projectSecret: config.spectrumProjectSecret,
  providers: [imessage.config()],
});
for await (const [space, message] of app.messages) {
  await space.responding(async () => { await route(space, message); });
}
```
Boot, stream, hand each message to the router. **One caveat the snippet hides (Loop-1):** before
`route(...)` can run, this file must rebuild the `ToolContext` wiring that
`http/core.ts:makeToolContextFactory` does today (store + model + delivery + step + async-council).
Budget **~1 day, not ½.** *(The `spectrum-ts/providers/imessage` import subpath and the
`app.messages` async-iterator / `space.responding` / `space.send` calls were marked "assumed" in
v1; Loop-3 web-verification against Photon's live sources **confirmed** all of them — this is real
shape, not pseudocode. See §7.8.)*

**Loop-2 — the loop replies to _everything_, so it must carry over what the MCP entry point gave for
free:** (1) `http/ratelimit.ts` + a per-user cost ceiling (the snippet drops both — anyone who can text
the line can run up LLM spend); (2) **group-thread / not-addressed-to-me** handling (don't answer every
message in a group); (3) a hard **out-of-domain fallback** (§4b) — most inbound won't map to a tool.

### 4b. `src/spectrum/router.ts` — **the natural-language brain (THE big piece)** _(large)_
This is the function Poke performs for you today and that **does not exist anywhere in the
codebase** (verified: zero NL-routing code). It must turn an inbound free-text message into a
`{name, arguments}` tool call (or a plain chat reply), then run the existing handler.

Recommended **MVP** implementation: a **single Claude tool-use call** over the (now small — see §8)
set of active tool schemas, returning either a `{name, arguments}` call or a plain reply. Smallest
correct version, and — deliberately, per "don't overdesign" — *not* a multi-stage router for Phase A.
- ⚠️ **Out-of-domain replies are first-class, not an afterthought (Loop-2).** Once you own the line you
  receive *everything* — "lol", "what's the weather", a photo, an off-script question. The dominant
  inbound category is **not** tool-shaped. The router's default branch must be a graceful conversational
  reply, never a dead bubble or "I can't do that." On a consumer line *this fallback IS the product
  surface* — it's what made Poke feel alive, and the easiest thing to get wrong.
- Council is **always an explicit branch**, never something tool-use stumbles into — it's 7 LLM calls
  (§8); require an unambiguous "convene the council" before paying that.
- **Production upgrade (Phase B, not MVP):** if cost/latency on a multi-user line bites, split into a
  cheap fast-path classifier for the ~3–4 high-frequency verbs that escalates to full tool-use only on
  low confidence. Noted here so it's a *deliberate later optimization*, not a gap.
- ⚠️ **The existing `Model` port is text-only (Loop-1).** `complete(req) → string` (`model/types.ts`)
  and `ClaudeModel` keeps only `block.type === "text"` (`model/claude.ts`) — it passes no `tools` and
  returns no `tool_use`. So the router **cannot reuse the port as-is**: extend it with a tool-use
  method (e.g. `completeWithTools`) or call `@anthropic-ai/sdk` directly. The model *config/wiring*
  is reusable; the *interface* is net-new. This is the line between "wire up existing pieces" and
  "extend the core abstraction."
- Must reproduce Poke's normalization duties — e.g. *"convert natural time → ISO-8601 UTC
  before calling `set_reminder`"* (today that instruction lives in `mcp/server.ts:INSTRUCTIONS`).
- Must carry **per-conversation memory** (Poke held this). Minimum: last-N turns per space.
- Cost/latency: **every inbound message now hits an LLM.** Budget for it (§7).
Estimate: **2–4 days** for a solid first version incl. tool-use wiring + memory + tests.

### 4c. `src/spectrum/identity.ts` — space → user_id _(small)_
Today `makeToolContext(auth.userId)` is fed by Poke's injected `x-poke-user-id`. Replace with
a deterministic map from the Spectrum `space`/handle (phone/email) → your `user_id`, persisted
so the same person keeps the same backlog. ~½ day.

### 4d. Store: **two** additive tables _(small)_
- `pc_spectrum_space (user_id, space_guid, last_seen)` so the scheduler/async-council can find a
  **target** to push to (replaces "POKE_API_KEY → its owner").
- `pc_spectrum_turn (user_id, space_guid, role, text, at)` (or equivalent) for the **per-conversation
  memory** the router needs (§4b). In-process memory is lost on a serverless freeze — the same reason
  `durable/*` exists — so on the serverless path this must be durable, not a variable. (Loop-1: v1
  forgot memory needed a home.)

Additive migrations; all `pc_`-prefixed tables already auto-create. ~½ day (was ¼ — second table + reads).

### 4e. Config _(trivial)_
Add `spectrumProjectId`, `spectrumProjectSecret` (Cloud) **or** an imessage-kit local flag.
Keep `ANTHROPIC_API_KEY`, `DATABASE_URL`. Drop nothing (MCP mode can coexist — §6). ~¼ day.

---

## 5. Honest effort calibration

The prior "days, in-stack" was **directionally right but optimistic at the bottom of the range.**

| Piece | Effort |
|---|---|
| `app.ts` loop (+ context-factory wiring, rate-limit, group/fallback guards) | ~1d |
| **`router.ts` (single tool-use call + memory + out-of-domain fallback)** | **2–4d** |
| `identity.ts` + 2 store tables (space + memory) | ~1d |
| `SpectrumDelivery` swap | ~0.5d |
| render: text-first + native texture (effect, tapback, one poll) | ~1d |
| Spectrum Cloud provisioning + e2e on a real phone | ~1d (+ account, user-gated) |
| tests (router intents, out-of-domain fallback, identity, delivery) | ~1d |
| **— default "done" subtotal (works when _I_ drive it)** | **~1 wk** |
| router eval loop (tune until a _stranger's_ phone is safe) — **off the default path** | +2–4d, open-ended |
| **Total only if stranger-ready** | **~2 wks** |

**The ~65% "engine reuse" claim holds for the _capability_ code and is misleading for the
_system_:** the orchestration brain that made poke-conduit feel smart was Poke's, and it's
net-new here. Reuse is high; "almost done" is false.

**Default to the 1-week build (Loop-3).** For *both* goals the right "done" is **"works when I
drive it,"** not "hand a stranger the number." Goal-2 (you want the experience) is satisfied the
moment the agent texts *you* first with native texture. Goal-1 (the job) is shown in a **recorded
demo you drive** — a recruiter never types into your line, so stranger-grade robustness buys the
artifact nothing. That moves the open-ended **router eval loop off the critical path** (do it only
if you ever expose the line publicly) and is the single biggest schedule saver in this doc.

**Schedule-killer (Loop-2), now scoped:** the most likely overrun is the **router eval loop** —
mis-routes on a consumer chat are silent and embarrassing, and "stranger-ready" tuning is
open-ended. But per the line above it's **not on the default path**, and now that §7.8 is verified
it's only weakly correlated with SDK risk. State which "done" you're pricing before quoting a date.

### 5a. Shippability — the honest job-artifact comparison (Loop-3)

| Artifact | How a recruiter consumes it | Effort | Job-proof strength |
|---|---|---|---|
| poke-conduit (today) | public repo + live `/mcp` URL + green CI | done | strong, linkable |
| poke-amb-bridge (today) | public repo + live URL + 84 tests | done | strong, linkable |
| Spectrum agent (this doc) | **a Loom + a repo** (the line itself is ephemeral/credentialed) | ~1 wk | medium, **not linkable** |
| _Alt:_ 1-page memo + Loom on *"how I'd port poke-conduit to Spectrum"* | a doc + a video | **~½ day** | medium, linkable — **no code/ToS risk** |

The alt row is the real opportunity-cost check: if the *only* goal were the job, a half-day teardown
memo + this very migration map delivers most of the signal at ~5% of the cost. Build the agent
because **you want the experience** (goal-2); treat the job value as a bonus (§10).

---

## 6. Two transport options (pick per phase)

### Option A — `imessage-kit` **local mode** (demo-grade, ~$0)
Runs on Kevin's Mac, reads the Messages DB, sends via AppleScript (from the
`chat-adapter-imessage` skill). **Fastest path to a live agent-as-contact**, no Photon account.
- ➖ Must run on an always-on Mac; uses a real Apple ID identity; **local mode can't create
  chats and `nativeContactCard()` throws** (per docs) — fine for replying, limited for onboarding.
- ➖ Single identity → no real multi-user.
- ✅ Zero cost, zero approval, today.
- ⛔ **Safety rule (Loop-3): never run the local spike on Kevin's primary Apple ID.** AppleScript
  automation of iMessage is in Apple's gray area; an automated send loop on your personal account
  risks your *real* identity (rate-flagging, account action). Use a **burner Apple ID on a spare
  device/VM** for any local experiment. One line, large blast radius.

### Option B — **Spectrum Cloud** managed line (product-grade)
Provisioned number, agent has its own identity, edge delivery, scaling, contact-card onboarding,
mini-app cards. Free tier = **shared** line pool (no dedicated/branded number); dedicated = paid.
- ✅ Real agent-as-contact, multi-user, full payload set.
- ➖ Account + (for a branded number) spend; ToS/data considerations (§7).

**Recommended (revised by Loop-2): go straight to Option B (Spectrum Cloud) for Phase A.** Local mode
demos the *wrong* loop for both goals — it can't provision a real line or send a contact card, the two
things that *define* "agent-as-contact," and an AppleScript-on-a-Mac demo reads to a Photon engineer as
"didn't actually use the product." Demote Option A to an optional **day-one throwaway spike** to learn
the SDK's message-loop shape *while the Cloud account is provisioned* (account setup is the one
user-gated blocker — start it first). The router/tools/store/delivery seam is transport-independent, so
the spike's learnings carry straight over.

---

## 7. Risks / open questions (for the loops to attack)

1. **Router quality & cost.** Every message → an LLM tool-use call. Mis-routes ("did they
   mean add_note or set_reminder?") are the new failure surface Poke used to own. Needs an
   eval set, not just unit tests.
2. **iMessage automation ToS.** Local AppleScript and managed-line iMessage both operate in
   Apple's gray area for programmatic iMessage. Spectrum commercializes it; for a personal
   demo, understand the account-risk before pointing it at Kevin's primary Apple ID.
3. **iOS 26 dependency** for polls / mini-app cards / backgrounds. Confirm the demo device.
4. **What you lose by leaving Poke.** Poke is more than a relay (cross-app actions, its own
   memory, its assistant UX). Going standalone means reimplementing or doing without those.
   Is the goal "replace Poke" or "a second proof artifact"? That changes scope a lot.
5. **Multi-user** only real on Option B; Option A is single-identity.
6. **Confabulation lesson (load-bearing):** there is **no existing `SpectrumAdapter`** and no
   interactive-payload layer (verified: `spectrum` appears **nowhere in `src/`** — only in the
   design-spec non-goals and this doc; zero adapter/interactive code). Budget for §4 as genuine
   new work, not glue.
7. **Runtime-model shift (serverless → long-lived listener).** Today the whole deploy is serverless
   edge (`api/*` on Vercel; `durable/inngest.ts` exists *specifically* to survive function freezes).
   The `for await (… of app.messages)` loop is a **long-lived process** — Option A runs it as a
   persistent Node process on Kevin's Mac; Option B runs it on Spectrum's infra. This is a real
   architectural change, not a config swap, and it changes how proactive / async-council delivery works.
8. **Spectrum API specifics — source-verified (build research), two doc-level errors corrected.**
   `space.send(...)`, the `spectrum-ts/providers/imessage` import subpath, the `app.messages`
   async-iterator loop (yields a **2-tuple `[space, message]`**), and `space.responding(...)` were
   marked "assumed" in v1; a build-time check **against the cloned `spectrum-ts@5.0.0` source**
   (not just docs) confirmed them. The same source check **falsified two specifics the Loop-3 web
   pass had marked "confirmed"** — these would not have compiled:
   - **Polls:** there is **no `imessage(space).sendPoll({question, options})`.** The real call is
     `space.send(poll(title, options))` (`import { poll } from "spectrum-ts"`); the field is `title`,
     2–10 options. (The `sendPoll` shape lives in Photon's prose/press, not the SDK.)
   - **Tapbacks:** there is **no `imessage.tapbacks.love`.** React with a **raw emoji string** —
     `message.react("👍")` (or `message.react(Emoji.love)`). Native set: ❤️ 👍 👎 😂 ‼️ ❓.

   Other source-confirmed load-bearing facts now baked into the plan: inbound text is
   `message.content.text` (not `message.text`); sender identity is `message.sender?.id` (**guard
   undefined**); group vs 1:1 is `space.type` (`"dm"|"group"`) with **no built-in "addressed-to-me"**
   flag; effects via `effect(text, imessage.effect.message.<name>)` (13 names, incl. `sparkles`,
   `spotlight`, `celebration`); **no `sticker()`** helper (use `attachment()`); the boot is an
   **async factory** `await Spectrum({ projectId, projectSecret, providers })` (creds **optional** —
   `terminal`/`local` providers run with none); and tests have a first-class **`definePlatform`**
   in-memory-provider path (`@spectrum-ts/test-support` exists but assumes `bun:test`, so this build
   uses `definePlatform` + structural fakes under **Vitest**). Residual risk is version-drift only —
   re-check at build time, but §4 snippets and the plan are **source shape, not pseudocode.**
9. **Out-of-domain is the dominant inbound category (Loop-2).** On the MCP path Poke only forwarded
   tool-shaped intents; the moment you own the line you receive *everything*, and most maps to no tool.
   A line that goes silent or says "I can't" on half your texts feels broken (torpedoes goal 2), and an
   engineer typing something off-script into a dead bubble torpedoes goal 1. The fallback turn (§4b) is
   the product, not a nicety.
10. **The loop replies to everything (Loop-2).** No group-thread / not-addressed-to-me handling and no
    rate/cost ceiling are carried into §4a from the MCP entry point. Anyone who can text the line can run
    up LLM spend; in a group the agent answers every message. Both must be ported, not assumed.

---

## 8. Phased plan

- **Phase A — "the agent texts you first" (Spectrum Cloud, ~2 wks to stranger-ready):** real
  provisioned line + **contact-card onboarding**, `app.ts` (with rate-limit + fallback guards) +
  `router.ts` (single tool-use call + graceful out-of-domain reply) + `identity.ts` + `SpectrumDelivery`,
  leading with **native texture, not capability count**:
  1. **proactive reminder that fires as a real push _with a message effect_** — the single most
     "agent-as-contact" moment (an unprompted text from your agent); `scheduler.ts` already fires it.
  2. **backlog add / list / complete with a _tapback_ to mark done** — high-frequency, two-way native
     interaction, not just text.
  3. **one decision rendered as a _native poll_** (iOS 26) — texture a web app can't replicate.
  Success = you save the number as a contact and it texts *you* first, with effects/tapbacks/a poll —
  and replies gracefully when you go off-script. **Council is intentionally NOT here** (see Phase B).
  Tests: router intents + out-of-domain fallback + identity + delivery mock.
- **Phase B — depth & richness (optional, ~2–3d):** the reusable win here is the **async
  proactive-delivery pattern** — a slow task whose result arrives as an *unprompted* message minutes
  later (the code already supports async delivery). Demonstrate it with **one** long-running flow and
  widen the delivery interface for payloads (§3a). **Council itself is *not* required here (Loop-3):**
  it already runs — better and inspectably — inside the surviving MCP server, so re-porting all 7 LLM
  calls onto the line is redundant effort for a demo. If you want a depth showpiece, wire the
  *async-delivery pattern* and point it at the existing council job; don't rebuild the council. Add a
  mini-app card only if it earns its keep.
- **Phase C — native tray icon (out of scope here):** separate Swift project; only if a goal
  explicitly needs the literal drawer app.

---

## 9. Non-goals (explicit)

- The native iMessage App Extension / app-tray icon (Layer 2).
- **AMB / Apple Messages for Business.** Wrong Apple product for this experience — the
  screenshots are consumer iMessage; AMB interactive messages render only in business chats
  behind Apple approval + an MSP. `poke-amb-bridge` stays its own thing.
- WhatsApp/Telegram providers (Spectrum supports them; not needed for the goal).
- Replacing Poke wholesale (unless §7.4 is answered "yes").

---

## 10. Decision this doc enables

After three review loops, the decision is **not** "is this worth 2 weeks for a job artifact." Loop 3
severed that framing (see §0.5). The honest decision is:

> **"Do I want the *experience* of an agent on my own iMessage line — one that texts me first with
> native texture — enough to spend ~1 week building it (driven-demo grade)? The job value is a
> *bonus*, not the reason."**

**Goals, un-fused (correcting Loop-2).** An earlier draft of this doc claimed Phase A makes "goals 1
and 2 the same demo." Loop 3 showed that's the doc's central rationalization, so:
- **Goal 2 (you want the Spectrum experience) is PRIMARY and fully served** by the ~1-week driven
  build: a number you save as a contact, that texts *you* first, with an effect / tapback / poll.
  This is the thing the user actually asked for — *"the experience that Photon built."*
- **Goal 1 (the Poke/Interaction job) is MARGINAL and framing-dependent.** It's a *third* proof of an
  already-twice-proven thesis (§0.5C), it **doesn't ship as a link** (§0.5B / §5a), and it's built on
  infra adjacent to Poke's own moat (§0.5A). The strongest job move per hour is the §5a **½-day memo +
  Loom**, not the build. If you build, the job benefit is real only *if* you frame the stack
  deliberately *and* record a clean driven demo.

**Success criterion (goal-2 — explicitly not a shareable job artifact):** you save the number as a
contact and it texts *you* first — with an effect on a fired reminder, a tapback to complete a task,
one native poll — and replies gracefully when you go off-script. That is a win worth having on its own
terms. Whether it also advances the job is a *separate, weaker, framing-gated* question — don't let
the build's appeal smuggle in a job rationale it hasn't earned.

---

## 11. Review log (what each loop changed)

This doc was refined by three sequential adversarial loops; each saw the prior loop's edits, and the
pen stayed with the author between loops (agents returned findings, not commits).

- **Loop 1 — Correctness.** Verified every load-bearing technical claim against the repo: the
  tool/agent/store/model layers are transport-agnostic and reuse cleanly. Caught that v1 **omitted the
  `http/core.ts` context-factory wiring**, the **text-only `Model` port** (can't do tool-use as-is),
  the **`PokeClient.push(string)` payload limit**, and that **per-conversation memory needed a durable
  home**. Folded into §2/§3/§4.
- **Loop 2 — Approach.** Re-aimed the plan at the actual goal: **Cloud-first** (demoted local mode to a
  throwaway spike, §6), **native texture over capability count** (§8 Phase A leads with a proactive
  effect + tapback + poll), **out-of-domain reply as the product surface** (§4b/§7.9), and flagged the
  **router eval loop as the schedule-killer** (§5). It recommended a two-tier router; that was
  **deliberately not taken** as the MVP (violates "don't overdesign" for a single-user demo) and is
  recorded instead as a Phase-B optimization (§4b).
- **Loop 3 — Red-team.** Argued the strongest "build-smaller" case and won on the structural points:
  added **§0.5 counter-case**, **severed goals 1 and 2** (§10), **re-priced to the ~1-week driven-demo
  default** with the eval loop off the critical path (§5), **cut council from required Phase-B scope**
  (§8), added the **burner-Apple-ID safety rule** (§6) and the **§5a shippability comparison**. Its one
  overstatement — *"Photon is a direct competitor to Poke"* — was **caught and corrected before it
  entered the doc**: web-verification showed they're *adjacent players at different layers* (consumer
  app vs. infra), so §0.5A frames the optics accurately ("manageable, not lethal") rather than as
  endorsement of a rival. The same verification **upgraded the §4a/§7.8 Spectrum-API caveats from
  "assumed" to "verified."**

**Net effect.** v1 was a confident "~2-week port that serves both goals." v2 is an honest **~1-week
goal-2-primary build** with a named counter-case, a verified API surface, a scoped schedule, and a job
rationale demoted to a framing-dependent bonus. The disagreement between loops (Loop 3 reversing Loop
2's goal-fusion) is preserved on purpose — that's the review working, not noise.
