# Spectrum iMessage Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn poke-conduit's tool library into a **standalone consumer-iMessage agent** on Photon's Spectrum SDK — its own iMessage line, agent-as-contact, that *texts you first* (a reminder with an effect), takes a tapback to complete a task, and renders one native poll — with a natural-language router as its brain (no Poke in front of it).

**Architecture:** A new **additive** app under `src/spectrum/` that *imports* the existing `tools/`, `store/`, `model/`, and `scheduler`. A structural-interface seam (`SpaceLike`/`MessageLike`/`SpectrumPayloads`) keeps the whole testable core **free of the SDK and of credentials** — only one file (`app.ts`) imports `spectrum-ts` and boots the line. An injectable `RouterModel` (Claude tool-use in prod, a deterministic `MockRouterModel` offline) maps each inbound text to one tool call or a conversational reply. Delivery and the scheduler are widened **backward-compatibly** so the same `PokeClient` seam drives either Poke (instruction-phrased) or Spectrum (verbatim, multi-tenant). The existing MCP server stays untouched as its own proof.

**Tech Stack:** TypeScript (ESM, `"type":"module"`), `spectrum-ts@5.0.0` (+ `spectrum-ts/providers/imessage`, `/providers/terminal`), `@anthropic-ai/sdk@^0.74.0` (router tool-use), existing `Store`/`Model`/tools, **Vitest** (`definePlatform`/structural fakes — **not** `@spectrum-ts/test-support`, which assumes `bun:test`), pg-mem for store tests.

---

## Corrections baked in from build research (read once)

The migration map's web-level "verified" API was overturned at the source level (cloned `spectrum-ts@5.0.0`). These are the load-bearing facts the code below uses — they differ from Photon's prose/press:

- **Polls:** `space.send(poll(title, options))` — `import { poll } from "spectrum-ts"`. There is **no** `imessage(space).sendPoll({question})`. Field is `title`; 2–10 options.
- **Tapbacks:** `message.react("👍")` — a **raw emoji string**. There is **no** `imessage.tapbacks.love`. Native set: ❤️ 👍 👎 😂 ‼️ ❓.
- **Inbound text:** `message.content.text` (not `message.text`). Branch on `message.content.type` (`"text"` | `"poll_option"` | …).
- **Sender identity:** `message.sender?.id` — **guard undefined**.
- **DM vs group:** `space.type` (`"dm"` | `"group"`). No built-in "addressed-to-me" flag.
- **Effects:** `effect(text, imessage.effect.message.<name>)` — `import { effect, imessage } from "spectrum-ts/providers/imessage"`. Names incl. `sparkles`, `spotlight`, `celebration`.
- **Boot:** `await Spectrum({ projectId, projectSecret, providers })` — async factory; creds **optional** (terminal/local run with none). Inbound loop: `for await (const [space, message] of app.messages)`.
- **Send target for proactive push:** persist `space.id` per user; this build resolves it from an **in-process live-space map** (a reminder set in a session is delivered by the same long-lived process). Cross-process cold delivery (SDK space-get) is Phase-B and explicitly flagged.

---

## File Structure

**New (all under `src/spectrum/`, SDK-free unless noted):**

| File | Responsibility |
|---|---|
| `types.ts` | Structural `SpaceLike`/`MessageLike`/`InboundContent`, `SpectrumPayloads`, `ChatTurn`, `RouteDecision`, `PollSpec`, `SpectrumDeps`. Types only. |
| `payloads.ts` | `tagPayloads` — SDK-free content factory returning tagged plain objects (tests + offline). |
| `identity.ts` | `resolveUserId(senderId)` — deterministic `sender.id` → `user_id`. |
| `context.ts` | `makeSpectrumToolContext(deps)` — builds the per-user `ToolContext` (replicates the MCP wiring; `poke` = SpectrumDelivery). |
| `router.ts` | `RouterModel` iface, `ROUTER_SYSTEM`, `toApiMessages`, `MockRouterModel` (offline brain), `ClaudeRouterModel` (tool-use), `makeRouterModel()`. |
| `tools.ts` | `prioritizeTool` (poll surface) + `SPECTRUM_TOOLS` (Phase-A toolset; council excluded). |
| `delivery.ts` | `SpectrumDelivery implements PokeClient` — multi-tenant verbatim send via `space.send` (effect for reminders). |
| `handler.ts` | `handleInbound(deps, space, message)` — the integrator: guards, identity, memory, route, run tool, deliver (tapback/poll/text), poll-vote. |
| `deps.ts` | `buildSpectrumDeps(opts)` — SDK-free assembly of `SpectrumDeps`. |
| `app.ts` | **(SDK)** `realPayloads`, live-space map, `runSpectrum()` boot + message loop + scheduler tick. |
| `run.ts` | **(SDK)** CLI entry: `argv` → `runSpectrum({ provider })`. |

**Modified (shared, backward-compatible):**

| File | Change |
|---|---|
| `src/config.ts` | Add `spectrumProjectId`, `spectrumProjectSecret`. |
| `src/store/schema.ts` | Add `pc_spectrum_space`, `pc_spectrum_turn` to `TABLES`. |
| `src/store/types.ts` | Add `SpectrumSpace`/`SpectrumTurn` + 4 `Store` methods. |
| `src/store/sql.ts` | Implement the 4 methods on `SqlStore`. |
| `src/poke/index.ts` | Widen `PokeClient.push(instruction, opts?)` (both impls accept+ignore opts). |
| `src/scheduler.ts` | Widen `runScheduler(store, poke, now, phrase?)`; pass `{ userId, kind }` to push. |
| `package.json` | Add `"spectrum"` script + `spectrum-ts` dep. |

**Tests (Vitest, `test/`):** `spectrum-store`, `spectrum-identity`, `spectrum-router`, `spectrum-scheduler`, `spectrum-delivery`, `spectrum-tools`, `spectrum-deps`, `spectrum-handler`.

**Docs:** `docs/SPECTRUM.md` (Cloud provisioning + run + driven-demo script).

---

### Task 1: Scaffolding — config keys + structural types

**Files:**
- Modify: `src/config.ts`
- Create: `src/spectrum/types.ts`
- Create: `src/spectrum/payloads.ts`
- Test: `test/spectrum-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/spectrum-config.test.ts
import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { tagPayloads } from "../src/spectrum/payloads";

describe("spectrum config + payloads", () => {
  it("exposes spectrum credential keys (empty by default)", () => {
    expect(config.spectrumProjectId).toBe("");
    expect(config.spectrumProjectSecret).toBe("");
  });

  it("tagPayloads returns inspectable tagged objects (SDK-free)", () => {
    expect(tagPayloads.text("hi")).toEqual({ kind: "text", text: "hi" });
    expect(tagPayloads.effect("yo", "spotlight")).toEqual({ kind: "effect", text: "yo", effect: "spotlight" });
    expect(tagPayloads.poll("Pick", ["a", "b"])).toEqual({ kind: "poll", title: "Pick", options: ["a", "b"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spectrum-config.test.ts`
Expected: FAIL — `config.spectrumProjectId` undefined / cannot find module `../src/spectrum/payloads`.

- [ ] **Step 3: Add config keys**

In `src/config.ts`, add inside the `config` object after the `pokeInboundUrl` block (before the `/** INBOUND MCP auth ... */` comment):

```ts
  /** Spectrum Cloud creds (app.photon.codes → project Settings). Empty → terminal/offline only. */
  spectrumProjectId: process.env.SPECTRUM_PROJECT_ID ?? "",
  spectrumProjectSecret: process.env.SPECTRUM_PROJECT_SECRET ?? "",
```

- [ ] **Step 4: Create the structural types**

```ts
// src/spectrum/types.ts
import type { RateLimiter } from "../http/ratelimit";
import type { Store } from "../store/types";
import type { ToolContext, ToolDef } from "../tools/types";

/** Inbound content variants we handle (structural subset of the SDK union). */
export type InboundContent =
  | { type: "text"; text: string }
  | { type: "poll_option"; option: string }
  | { type: string; [k: string]: unknown };

/** Structural subset of spectrum-ts `Message` — only what we touch. `any` params keep the real SDK type assignable. */
export interface MessageLike {
  content: InboundContent;
  sender?: { id?: string };
  react(reaction: string): Promise<any>;
}

/** Structural subset of spectrum-ts `Space`. */
export interface SpaceLike {
  id: string;
  type?: "dm" | "group";
  send(content: any): Promise<any>;
}

/** Transport-agnostic content factories (real wraps the SDK; tagPayloads fakes for tests). */
export interface SpectrumPayloads {
  text(s: string): unknown;
  effect(s: string, effect: string): unknown;
  poll(title: string, options: string[]): unknown;
}

/** A native-poll request a tool can emit via ToolResult.data.poll. */
export interface PollSpec {
  title: string;
  options: string[];
}

/** One turn of stored conversation memory. */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/** The router's decision for one inbound turn. */
export interface RouteDecision {
  kind: "tool" | "reply";
  name?: string;
  arguments?: Record<string, unknown>;
  text?: string;
}

/** Minimal router contract — injectable so tests use a deterministic mock. */
export interface RouterModel {
  decide(input: { system: string; messages: ChatTurn[]; tools: ToolDef[] }): Promise<RouteDecision>;
}

/** Everything `handleInbound` needs — all injectable. */
export interface SpectrumDeps {
  store: Store;
  tools: ToolDef[];
  makeToolContext: (userId: string) => ToolContext;
  router: RouterModel;
  payloads: SpectrumPayloads;
  rateLimiter: RateLimiter;
  rateMax: number;
  rateWindowSec: number;
}
```

- [ ] **Step 5: Create tagPayloads**

```ts
// src/spectrum/payloads.ts
import type { SpectrumPayloads } from "./types";

/**
 * SDK-free content factory: returns tagged plain objects instead of real
 * ContentBuilders. Used by tests (assert on the tag) and the offline harness.
 * The real, SDK-backed factory lives in app.ts (`realPayloads`).
 */
export const tagPayloads: SpectrumPayloads = {
  text: (s) => ({ kind: "text", text: s }),
  effect: (s, effect) => ({ kind: "effect", text: s, effect }),
  poll: (title, options) => ({ kind: "poll", title, options }),
};
```

- [ ] **Step 6: Run test + typecheck to verify pass**

Run: `npx vitest run test/spectrum-config.test.ts && npm run typecheck`
Expected: PASS (2 tests) + clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/spectrum/types.ts src/spectrum/payloads.ts test/spectrum-config.test.ts
git commit -m "feat(spectrum): scaffold config keys + structural types + tagPayloads"
```

---

### Task 2: Store — two spectrum tables + methods

**Files:**
- Modify: `src/store/schema.ts`
- Modify: `src/store/types.ts`
- Modify: `src/store/sql.ts`
- Test: `test/spectrum-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/spectrum-store.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { makePgMemStore } from "../src/store/pgmem";
import type { Store } from "../src/store/types";

const U = "spectrum:+15551234567";
const S = "chat-guid-abc";

describe("spectrum store", () => {
  let store: Store;
  beforeEach(async () => {
    store = await makePgMemStore();
    await store.init();
  });

  it("upserts a space mapping (latest space_id wins, one row per user)", async () => {
    await store.upsertSpectrumSpace({ user_id: U, space_id: S });
    await store.upsertSpectrumSpace({ user_id: U, space_id: "chat-guid-new" });
    const got = await store.getSpectrumSpace(U);
    expect(got?.space_id).toBe("chat-guid-new");
    expect(await store.getSpectrumSpace("spectrum:nobody")).toBeNull();
  });

  it("appends turns and returns the most-recent N in chronological order", async () => {
    for (let i = 1; i <= 12; i++) {
      await store.appendSpectrumTurn({
        user_id: U,
        space_id: S,
        role: i % 2 ? "user" : "assistant",
        text: `m${i}`,
        at: `2026-06-19T00:00:${String(i).padStart(2, "0")}.000Z`,
      });
    }
    const recent = await store.recentSpectrumTurns(U, 10);
    expect(recent.length).toBe(10);
    expect(recent[0].text).toBe("m3"); // oldest of the last 10
    expect(recent[9].text).toBe("m12"); // newest
    expect(recent[9].role).toBe("assistant");
  });

  it("scopes turns by user", async () => {
    await store.appendSpectrumTurn({ user_id: U, space_id: S, role: "user", text: "mine" });
    await store.appendSpectrumTurn({ user_id: "spectrum:other", space_id: "x", role: "user", text: "theirs" });
    const recent = await store.recentSpectrumTurns(U, 10);
    expect(recent.map((t) => t.text)).toEqual(["mine"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spectrum-store.test.ts`
Expected: FAIL — `store.upsertSpectrumSpace is not a function`.

- [ ] **Step 3: Add the two tables to the schema**

In `src/store/schema.ts`, append these two entries to the `TABLES` array (after the `pc_rate_limits` table, before the closing `]`):

```ts
  `CREATE TABLE IF NOT EXISTS pc_spectrum_space (
    user_id text PRIMARY KEY,
    space_id text NOT NULL,
    last_seen text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pc_spectrum_turn (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    space_id text NOT NULL,
    role text NOT NULL,
    text text NOT NULL,
    at text NOT NULL
  )`,
```

- [ ] **Step 4: Add entities + methods to the Store contract**

In `src/store/types.ts`, add these interfaces after the `Run` interface (before `BacklogFilter`):

```ts
export interface SpectrumSpace {
  user_id: string;
  space_id: string;
  last_seen: string; // ISO
}
export interface SpectrumTurn {
  role: "user" | "assistant";
  text: string;
}
```

In the same file, add these methods to the `Store` interface (after `getRun(...)`, before the closing `}`):

```ts
  /** Map a user to their current Spectrum chat GUID (latest wins). */
  upsertSpectrumSpace(s: { user_id: string; space_id: string }): Promise<void>;
  getSpectrumSpace(userId: string): Promise<SpectrumSpace | null>;
  /** Append one conversation turn (memory). `at` defaults to now; tests may pass it for deterministic order. */
  appendSpectrumTurn(t: {
    user_id: string;
    space_id: string;
    role: "user" | "assistant";
    text: string;
    at?: string;
  }): Promise<void>;
  /** Most-recent `limit` turns for a user, chronological (oldest→newest). */
  recentSpectrumTurns(userId: string, limit: number): Promise<SpectrumTurn[]>;
```

- [ ] **Step 5: Implement the methods on SqlStore**

In `src/store/sql.ts`, first extend the type import to include the new entities — change the import block's type list to add `SpectrumSpace` and `SpectrumTurn`:

```ts
import type {
  BacklogFilter,
  BacklogItem,
  Recipe,
  Recurrence,
  Run,
  SpectrumSpace,
  SpectrumTurn,
  Sql,
  Status,
  StatusKind,
  Store,
  Trigger,
} from "./types";
```

Then add these methods inside the `SqlStore` class, just before the final closing `}` of the class (after `getRun`):

```ts
  // ---- spectrum ----
  async upsertSpectrumSpace(s: { user_id: string; space_id: string }): Promise<void> {
    await this.sql(
      `INSERT INTO pc_spectrum_space (user_id, space_id, last_seen)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET
         space_id=EXCLUDED.space_id, last_seen=EXCLUDED.last_seen`,
      [s.user_id, s.space_id, nowIso()],
    );
  }

  async getSpectrumSpace(userId: string): Promise<SpectrumSpace | null> {
    const r = await this.sql(`SELECT * FROM pc_spectrum_space WHERE user_id=$1`, [userId]);
    if (!r.rowCount) return null;
    const row = r.rows[0];
    return { user_id: row.user_id, space_id: row.space_id, last_seen: row.last_seen };
  }

  async appendSpectrumTurn(t: {
    user_id: string;
    space_id: string;
    role: "user" | "assistant";
    text: string;
    at?: string;
  }): Promise<void> {
    await this.sql(
      `INSERT INTO pc_spectrum_turn (id, user_id, space_id, role, text, at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [newId("turn"), t.user_id, t.space_id, t.role, t.text, t.at ?? nowIso()],
    );
  }

  async recentSpectrumTurns(userId: string, limit: number): Promise<SpectrumTurn[]> {
    const r = await this.sql(
      `SELECT role, text FROM pc_spectrum_turn WHERE user_id=$1 ORDER BY at DESC, id DESC LIMIT $2`,
      [userId, limit],
    );
    return r.rows.map((x) => ({ role: x.role as "user" | "assistant", text: x.text })).reverse();
  }
```

- [ ] **Step 6: Run test + typecheck to verify pass**

Run: `npx vitest run test/spectrum-store.test.ts && npm run typecheck`
Expected: PASS (3 tests) + clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add src/store/schema.ts src/store/types.ts src/store/sql.ts test/spectrum-store.test.ts
git commit -m "feat(spectrum): add pc_spectrum_space + pc_spectrum_turn store methods"
```

---

### Task 3: Identity — sender → user_id

**Files:**
- Create: `src/spectrum/identity.ts`
- Test: `test/spectrum-identity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/spectrum-identity.test.ts
import { describe, expect, it } from "vitest";
import { resolveUserId } from "../src/spectrum/identity";

describe("resolveUserId", () => {
  it("namespaces a sender handle deterministically", () => {
    expect(resolveUserId("+15551234567")).toBe("spectrum:+15551234567");
    expect(resolveUserId("kevin@example.com")).toBe("spectrum:kevin@example.com");
  });

  it("is stable across calls (same handle → same id)", () => {
    expect(resolveUserId("+15551234567")).toBe(resolveUserId("+15551234567"));
  });

  it("returns null for a missing handle", () => {
    expect(resolveUserId(undefined)).toBeNull();
    expect(resolveUserId("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spectrum-identity.test.ts`
Expected: FAIL — cannot find module `../src/spectrum/identity`.

- [ ] **Step 3: Implement**

```ts
// src/spectrum/identity.ts

/**
 * Map a Spectrum sender handle (phone/email from `message.sender?.id`) to a
 * stable, namespaced user_id. The `spectrum:` prefix keeps these rows from ever
 * colliding with Poke-injected user ids in the shared pc_* tables.
 * Returns null when the handle is absent (sender can be undefined in some events).
 */
export function resolveUserId(senderId: string | undefined): string | null {
  if (!senderId) return null;
  return `spectrum:${senderId}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/spectrum-identity.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/spectrum/identity.ts test/spectrum-identity.test.ts
git commit -m "feat(spectrum): deterministic sender → user_id identity"
```

---

### Task 4: Router — message assembly + offline + Claude tool-use

**Files:**
- Create: `src/spectrum/router.ts`
- Test: `test/spectrum-router.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/spectrum-router.test.ts
import { describe, expect, it } from "vitest";
import { backlogTools } from "../src/tools/backlog";
import { reminderTools } from "../src/tools/reminders";
import { MockRouterModel, toApiMessages } from "../src/spectrum/router";
import type { ChatTurn } from "../src/spectrum/types";

const TOOLS = [...backlogTools, ...reminderTools];
const decide = (text: string, history: ChatTurn[] = []) => {
  const messages: ChatTurn[] = [...history, { role: "user", text }];
  return new MockRouterModel().decide({ system: "", messages, tools: TOOLS });
};

describe("toApiMessages", () => {
  it("drops leading assistant turns and merges consecutive same-role turns", () => {
    const turns: ChatTurn[] = [
      { role: "assistant", text: "hi there" }, // leading assistant → dropped
      { role: "user", text: "a" },
      { role: "user", text: "b" }, // consecutive user → merged
      { role: "assistant", text: "ok" },
    ];
    expect(toApiMessages(turns)).toEqual([
      { role: "user", text: "a\nb" },
      { role: "assistant", text: "ok" },
    ]);
  });

  it("returns [] for empty or all-assistant input", () => {
    expect(toApiMessages([])).toEqual([]);
    expect(toApiMessages([{ role: "assistant", text: "x" }])).toEqual([]);
  });
});

describe("MockRouterModel (offline brain)", () => {
  it("routes a save intent to add_note", async () => {
    const d = await decide("save this article to read later");
    expect(d.kind).toBe("tool");
    expect(d.name).toBe("add_note");
    expect(typeof d.arguments?.text).toBe("string");
  });

  it("routes a list intent to list_backlog", async () => {
    const d = await decide("what's on my list?");
    expect(d).toMatchObject({ kind: "tool", name: "list_backlog" });
  });

  it("routes a completion intent to complete_note with a parsed ref", async () => {
    const d = await decide("mark 2 done");
    expect(d).toMatchObject({ kind: "tool", name: "complete_note" });
    expect(d.arguments?.ref).toBe(2);
  });

  it("routes a reminder intent to set_reminder with a fire_at", async () => {
    const d = await decide("remind me to call the dentist tomorrow");
    expect(d).toMatchObject({ kind: "tool", name: "set_reminder" });
    expect(typeof d.arguments?.fire_at).toBe("string");
    expect(String(d.arguments?.text)).toContain("call the dentist");
  });

  it("falls back to a conversational reply for out-of-domain text", async () => {
    const d = await decide("what do you think about the weather today");
    expect(d.kind).toBe("reply");
    expect(d.text && d.text.length).toBeGreaterThan(0);
  });

  it("never routes to a tool that isn't in the provided list", async () => {
    // prioritize is not in TOOLS here → a 'which first' ask must fall back to reply
    const d = await decide("which should I do first?");
    expect(d.kind).toBe("reply");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spectrum-router.test.ts`
Expected: FAIL — cannot find module `../src/spectrum/router`.

- [ ] **Step 3: Implement the router**

```ts
// src/spectrum/router.ts
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import type { ToolDef } from "../tools/types";
import type { ChatTurn, RouteDecision, RouterModel } from "./types";

/** System prompt for the NL brain. Terse: tools self-describe via their schemas. */
export const ROUTER_SYSTEM =
  "You are the user's personal second-brain agent, reachable over iMessage. You can save " +
  "notes, track a backlog, set proactive reminders, manage availability, run saved recipes, " +
  "and help the user prioritize. When a message clearly maps to one of your tools, call exactly " +
  "that one tool. For reminders, convert the user's natural time (e.g. 'tomorrow 9am') into an " +
  "absolute ISO-8601 UTC timestamp yourself. If the message is small talk, a question, or maps to " +
  "no tool, DO NOT call a tool — reply briefly and warmly in one or two sentences. Never invent a tool.";

/**
 * Normalize stored turns into a valid Anthropic message list: drop leading
 * assistant turns (the API must start with `user`) and merge consecutive
 * same-role turns (the API requires strict alternation).
 */
export function toApiMessages(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    if (out.length === 0 && t.role !== "user") continue; // skip leading assistant
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.text = `${last.text}\n${t.text}`;
    else out.push({ role: t.role, text: t.text });
  }
  return out;
}

/**
 * Deterministic offline brain — keyword routing. Used in tests, `npm run demo`-
 * style offline runs, and whenever ANTHROPIC_API_KEY is unset. Intentionally
 * simple: real intent understanding is ClaudeRouterModel's job.
 */
export class MockRouterModel implements RouterModel {
  async decide(input: { system: string; messages: ChatTurn[]; tools: ToolDef[] }): Promise<RouteDecision> {
    const last = [...input.messages].reverse().find((m) => m.role === "user")?.text ?? "";
    const t = last.toLowerCase();
    const has = (name: string) => input.tools.some((x) => x.name === name);

    if (/\b(remind|reminder|alert me)\b/.test(t) && has("set_reminder")) {
      const text = last.replace(/.*remind me (to )?/i, "").trim() || last;
      return { kind: "tool", name: "set_reminder", arguments: { text, fire_at: "2026-06-20T16:00:00.000Z" } };
    }
    if (/\b(my )?(reminders|alerts)\b/.test(t) && has("list_reminders")) {
      return { kind: "tool", name: "list_reminders", arguments: {} };
    }
    if (/\b(prioriti[sz]e|which (one |should )|what should i (do|focus))\b/.test(t) && has("prioritize")) {
      return { kind: "tool", name: "prioritize", arguments: {} };
    }
    if (/\b(list|what'?s on|show me)\b/.test(t) && /\b(list|backlog|notes?|todos?|queue)\b/.test(t) && has("list_backlog")) {
      return { kind: "tool", name: "list_backlog", arguments: {} };
    }
    if (/\b(done|completed?|finished?|mark)\b/.test(t) && has("complete_note")) {
      const m = t.match(/\b(\d+)\b/);
      return { kind: "tool", name: "complete_note", arguments: { ref: m ? Number(m[1]) : 1 } };
    }
    if (/\b(save|add|note|remember|jot|queue)\b/.test(t) && has("add_note")) {
      const text = last.replace(/.*\b(save|add|note|remember|jot|queue)( this)?( to (my )?(list|backlog))?:?\s*/i, "").trim() || last;
      return { kind: "tool", name: "add_note", arguments: { text } };
    }
    return {
      kind: "reply",
      text: `Got it — "${last}". I can save notes, track your backlog, set reminders, and help you prioritize. What would you like?`,
    };
  }
}

/** Real brain: one Claude tool-use call over the tool schemas. */
export class ClaudeRouterModel implements RouterModel {
  private client: Anthropic;
  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async decide(input: { system: string; messages: ChatTurn[]; tools: ToolDef[] }): Promise<RouteDecision> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: input.system,
      tools: input.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })) as Anthropic.Tool[],
      messages: toApiMessages(input.messages).map((m) => ({ role: m.role, content: m.text })),
    });
    const toolUse = res.content.find((b) => b.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      return {
        kind: "tool",
        name: toolUse.name,
        arguments: (toolUse.input ?? {}) as Record<string, unknown>,
      };
    }
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return { kind: "reply", text: text || "I'm here — what do you need?" };
  }
}

/** Real brain when ANTHROPIC_API_KEY is set; else the deterministic offline mock. */
export function makeRouterModel(): RouterModel {
  return config.anthropicApiKey
    ? new ClaudeRouterModel(config.anthropicApiKey, config.synthModel)
    : new MockRouterModel();
}
```

- [ ] **Step 4: Run test + typecheck to verify pass**

Run: `npx vitest run test/spectrum-router.test.ts && npm run typecheck`
Expected: PASS (8 tests) + clean typecheck.

> If typecheck errors on `as Anthropic.Tool[]` (SDK type-path drift across `@anthropic-ai/sdk` minors), change that single cast to `as any`. The runtime shape (`{name, description, input_schema}`) is correct regardless.

- [ ] **Step 5: Commit**

```bash
git add src/spectrum/router.ts test/spectrum-router.test.ts
git commit -m "feat(spectrum): NL router — message normalization + offline + Claude tool-use"
```

---

### Task 5: Scheduler — widen for verbatim, multi-tenant delivery

**Files:**
- Modify: `src/poke/index.ts`
- Modify: `src/scheduler.ts`
- Test: `test/spectrum-scheduler.test.ts` (plus re-run the existing `test/scheduler.test.ts` for regression)

- [ ] **Step 1: Write the failing test**

```ts
// test/spectrum-scheduler.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import type { PokeClient, PushResult } from "../src/poke/index";
import { runScheduler } from "../src/scheduler";
import { makePgMemStore } from "../src/store/pgmem";
import type { Store, Trigger } from "../src/store/types";

/** Records (text, opts) so we can assert the verbatim phrase + per-user target. */
class CapturingClient implements PokeClient {
  readonly calls: { instruction: string; opts?: { userId?: string; kind?: string } }[] = [];
  async push(instruction: string, opts?: { userId?: string; kind?: string }): Promise<PushResult> {
    this.calls.push({ instruction, opts });
    return { ok: true, status: 200 };
  }
}

const verbatim = (t: Trigger) => t.text; // Spectrum sends the real text, not an instruction

describe("runScheduler with a custom phrase + per-user opts", () => {
  let store: Store;
  beforeEach(async () => {
    store = await makePgMemStore();
    await store.init();
  });

  it("delivers the verbatim trigger text and passes {userId, kind} to push", async () => {
    await store.addTrigger({ user_id: "spectrum:+1555", kind: "reminder", text: "stand up and stretch", fire_at: "2026-06-19T09:00:00.000Z" });
    const poke = new CapturingClient();
    const res = await runScheduler(store, poke, "2026-06-19T10:00:00.000Z", verbatim);

    expect(res.fired.length).toBe(1);
    expect(poke.calls[0].instruction).toBe("stand up and stretch"); // not "Send me a reminder…"
    expect(poke.calls[0].opts).toEqual({ userId: "spectrum:+1555", kind: "reminder" });
  });

  it("defaults to the Poke instruction phrasing when no phrase is supplied", async () => {
    await store.addTrigger({ user_id: "u1", text: "buy milk", fire_at: "2026-06-19T09:00:00.000Z" });
    const poke = new CapturingClient();
    await runScheduler(store, poke, "2026-06-19T10:00:00.000Z");
    expect(poke.calls[0].instruction).toBe("Send me a reminder now that says: buy milk");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spectrum-scheduler.test.ts`
Expected: FAIL — TS error: `runScheduler` takes 3 args / `push` takes 1 arg (opts not in signature).

- [ ] **Step 3: Widen the PokeClient seam (backward-compatible)**

In `src/poke/index.ts`, change the `PokeClient` interface:

```ts
export interface PokeClient {
  push(instruction: string, opts?: { userId?: string; kind?: string }): Promise<PushResult>;
}
```

Change `HttpPokeClient.push` to accept and ignore the opts (Poke infers the user from the key, single-tenant):

```ts
  async push(instruction: string, _opts?: { userId?: string; kind?: string }): Promise<PushResult> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ message: instruction }),
    });
    return { ok: res.ok, status: res.status };
  }
```

Change `MockPokeClient.push` likewise (keep recording the instruction string — existing tests assert on `.pushes`):

```ts
  async push(instruction: string, _opts?: { userId?: string; kind?: string }): Promise<PushResult> {
    this.pushes.push(instruction);
    return { ok: true, status: 200 };
  }
```

- [ ] **Step 4: Widen runScheduler with an injectable phrase**

In `src/scheduler.ts`, change the `runScheduler` signature and the push call:

```ts
export async function runScheduler(
  store: Store,
  poke: PokeClient,
  now: string,
  phrase: (t: Trigger) => string = proactiveInstruction,
): Promise<SchedulerResult> {
  const due = await store.dueTriggers(now);
  const fired: FiredTrigger[] = [];
  for (const t of due) {
    const res = await poke.push(phrase(t), { userId: t.user_id, kind: t.kind });
    if (t.recurrence === "daily") {
      await store.markTriggerFired(t.id, nextDaily(t.fire_at, now));
    } else {
      await store.markTriggerFired(t.id);
    }
    fired.push({ id: t.id, text: t.text, pushed: res.ok });
  }
  return { fired };
}
```

- [ ] **Step 5: Run both scheduler test files + typecheck**

Run: `npx vitest run test/spectrum-scheduler.test.ts test/scheduler.test.ts && npm run typecheck`
Expected: PASS (new file: 2 tests; existing `scheduler.test.ts`: 11 tests still green — the default phrase preserves Poke behavior) + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/poke/index.ts src/scheduler.ts test/spectrum-scheduler.test.ts
git commit -m "feat(spectrum): widen PokeClient.push + runScheduler for verbatim multi-tenant delivery"
```

---

### Task 6: Delivery — SpectrumDelivery (multi-tenant verbatim send)

**Files:**
- Create: `src/spectrum/delivery.ts`
- Test: `test/spectrum-delivery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/spectrum-delivery.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { SpectrumDelivery } from "../src/spectrum/delivery";
import { tagPayloads } from "../src/spectrum/payloads";
import { makePgMemStore } from "../src/store/pgmem";
import type { Store } from "../src/store/types";
import type { SpaceLike } from "../src/spectrum/types";

function fakeSpace(id: string) {
  const sent: unknown[] = [];
  const space: SpaceLike = { id, type: "dm", send: async (c) => { sent.push(c); } };
  return { space, sent };
}

describe("SpectrumDelivery", () => {
  let store: Store;
  beforeEach(async () => {
    store = await makePgMemStore();
    await store.init();
  });

  it("sends a reminder verbatim with an effect to the user's live space", async () => {
    const { space, sent } = fakeSpace("guid-1");
    await store.upsertSpectrumSpace({ user_id: "spectrum:+1555", space_id: "guid-1" });
    const delivery = new SpectrumDelivery({
      store,
      resolveSpace: (id) => (id === "guid-1" ? space : undefined),
      payloads: tagPayloads,
    });

    const res = await delivery.push("stretch break", { userId: "spectrum:+1555", kind: "reminder" });
    expect(res.ok).toBe(true);
    expect(sent[0]).toEqual({ kind: "effect", text: "stretch break", effect: "spotlight" });
  });

  it("sends non-reminder pushes as plain text", async () => {
    const { space, sent } = fakeSpace("guid-1");
    await store.upsertSpectrumSpace({ user_id: "u", space_id: "guid-1" });
    const delivery = new SpectrumDelivery({ store, resolveSpace: () => space, payloads: tagPayloads });
    await delivery.push("the verdict is in", { userId: "u", kind: "council" });
    expect(sent[0]).toEqual({ kind: "text", text: "the verdict is in" });
  });

  it("fails closed (ok:false) without a userId, an unknown user, or a cold (non-live) space", async () => {
    const delivery = new SpectrumDelivery({ store, resolveSpace: () => undefined, payloads: tagPayloads });
    expect((await delivery.push("x")).ok).toBe(false); // no userId
    expect((await delivery.push("x", { userId: "ghost" })).ok).toBe(false); // no mapping
    await store.upsertSpectrumSpace({ user_id: "u", space_id: "guid-cold" });
    expect((await delivery.push("x", { userId: "u" })).ok).toBe(false); // mapping exists but space not live
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spectrum-delivery.test.ts`
Expected: FAIL — cannot find module `../src/spectrum/delivery`.

- [ ] **Step 3: Implement SpectrumDelivery**

```ts
// src/spectrum/delivery.ts
import type { PokeClient, PushResult } from "../poke/index";
import type { Store } from "../store/types";
import type { SpaceLike, SpectrumPayloads } from "./types";

/**
 * OUTBOUND for the standalone agent: conduit → the user's own iMessage line.
 * Implements the same PokeClient seam the scheduler/tools call, but instead of
 * phrasing a message as an instruction to a second assistant, it sends the
 * VERBATIM text to the right person via `space.send`.
 *
 * Multi-tenant: every push must name a userId. We look up that user's chat GUID
 * and resolve it to a live Space. `resolveSpace` returns undefined for a space
 * this process hasn't heard from yet (cold cross-process delivery is Phase-B —
 * it needs the SDK's space-get; see app.ts).
 */
export class SpectrumDelivery implements PokeClient {
  constructor(
    private deps: {
      store: Store;
      resolveSpace: (spaceId: string) => SpaceLike | undefined;
      payloads: SpectrumPayloads;
    },
  ) {}

  async push(instruction: string, opts?: { userId?: string; kind?: string }): Promise<PushResult> {
    const userId = opts?.userId;
    if (!userId) return { ok: false, status: 0 };

    const mapping = await this.deps.store.getSpectrumSpace(userId);
    if (!mapping) return { ok: false, status: 0 };

    const space = this.deps.resolveSpace(mapping.space_id);
    if (!space) return { ok: false, status: 0 };

    const content =
      opts?.kind === "reminder"
        ? this.deps.payloads.effect(instruction, "spotlight")
        : this.deps.payloads.text(instruction);
    await space.send(content);
    return { ok: true, status: 200 };
  }
}
```

- [ ] **Step 4: Run test + typecheck to verify pass**

Run: `npx vitest run test/spectrum-delivery.test.ts && npm run typecheck`
Expected: PASS (3 tests) + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/spectrum/delivery.ts test/spectrum-delivery.test.ts
git commit -m "feat(spectrum): SpectrumDelivery — multi-tenant verbatim send (effect for reminders)"
```

---

### Task 7: Toolset — prioritize tool + SPECTRUM_TOOLS

**Files:**
- Create: `src/spectrum/tools.ts`
- Test: `test/spectrum-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/spectrum-tools.test.ts
import { describe, expect, it } from "vitest";
import { LocalStep } from "../src/durable/step";
import { MockModel } from "../src/model/mock";
import { MockPokeClient } from "../src/poke/index";
import { makePgMemStore } from "../src/store/pgmem";
import type { Store } from "../src/store/types";
import type { ToolContext } from "../src/tools/types";
import { prioritizeTool, SPECTRUM_TOOLS } from "../src/spectrum/tools";

async function ctxFor(store: Store, userId: string): Promise<ToolContext> {
  return {
    store,
    model: new MockModel(),
    makeStep: () => new LocalStep(),
    poke: new MockPokeClient(),
    userId,
    personaModel: "claude-haiku-4-5-20251001",
    synthModel: "claude-opus-4-8",
    background: (_l, fn) => { void fn(); },
  };
}

describe("SPECTRUM_TOOLS", () => {
  it("includes the Phase-A surface and excludes council", () => {
    const names = SPECTRUM_TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "add_note", "list_backlog", "complete_note", "pin_note",
        "set_reminder", "list_reminders", "get_status", "set_status",
        "list_recipes", "run_recipe", "prioritize",
      ]),
    );
    expect(names).not.toContain("ask_council");
    expect(names).not.toContain("council_status");
  });
});

describe("prioritizeTool", () => {
  it("emits a poll of open backlog items as ToolResult.data.poll", async () => {
    const store = await makePgMemStore();
    await store.init();
    const ctx = await ctxFor(store, "u");
    await store.addBacklog({ user_id: "u", text: "ship the spectrum app" });
    await store.addBacklog({ user_id: "u", text: "write the demo script" });

    const res = await prioritizeTool.handler({}, ctx);
    const poll = (res.data as { poll?: { title: string; options: string[] } }).poll;
    expect(poll?.options).toEqual(["ship the spectrum app", "write the demo script"]);
    expect(poll?.title).toContain("first");
  });

  it("returns plain text (no poll) when fewer than two items are open", async () => {
    const store = await makePgMemStore();
    await store.init();
    const ctx = await ctxFor(store, "u");
    const empty = await prioritizeTool.handler({}, ctx);
    expect(empty.data).toBeUndefined();
    await store.addBacklog({ user_id: "u", text: "only one" });
    const one = await prioritizeTool.handler({}, ctx);
    expect(one.data).toBeUndefined();
    expect(one.text).toContain("only one");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spectrum-tools.test.ts`
Expected: FAIL — cannot find module `../src/spectrum/tools`.

- [ ] **Step 3: Implement the toolset**

```ts
// src/spectrum/tools.ts
import { z } from "zod";
import { findTool } from "../tools/index";
import type { ToolDef } from "../tools/types";
import type { PollSpec } from "./types";

/**
 * Render the user's open backlog as a native poll so they can tap to choose what
 * to do next. The handler stays transport-agnostic: it emits `data.poll`; the
 * Spectrum app turns that into `space.send(poll(...))`. Falls back to text when
 * a poll wouldn't make sense (0 or 1 open item).
 */
export const prioritizeTool: ToolDef = {
  name: "prioritize",
  description:
    "Render the user's open backlog as a poll so they can pick what to work on first. " +
    "Only call when the user asks which item to do first, or for help prioritizing/choosing.",
  inputSchema: { type: "object", properties: {} },
  zod: z.object({}),
  requiresAuth: true,
  async handler(_args, ctx) {
    const open = await ctx.store.listBacklog(ctx.userId, "open");
    if (open.length === 0) return { text: "Your backlog is empty — nothing to prioritize." };
    if (open.length === 1) return { text: `Only one open item: "${open[0].text}". Start there.` };
    const options = open.slice(0, 4).map((it) => it.text.slice(0, 80)); // polls: 2–10 options, keep tight
    const poll: PollSpec = { title: "Which should we tackle first?", options };
    return { text: poll.title, data: { poll } };
  },
};

/** Names from the shared library that make sense on a self-driven line (council is Phase-B). */
const REUSED = [
  "add_note", "list_backlog", "complete_note", "pin_note",
  "set_reminder", "list_reminders",
  "get_status", "set_status",
  "list_recipes", "run_recipe",
];

/** The tool surface the router chooses from on the Spectrum line. */
export const SPECTRUM_TOOLS: ToolDef[] = [
  ...REUSED.map((name) => {
    const tool = findTool(name);
    if (!tool) throw new Error(`SPECTRUM_TOOLS: missing tool '${name}'`);
    return tool;
  }),
  prioritizeTool,
];
```

- [ ] **Step 4: Run test + typecheck to verify pass**

Run: `npx vitest run test/spectrum-tools.test.ts && npm run typecheck`
Expected: PASS (3 tests) + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/spectrum/tools.ts test/spectrum-tools.test.ts
git commit -m "feat(spectrum): prioritize poll tool + curated SPECTRUM_TOOLS (council excluded)"
```

---

### Task 8: Context + deps assembly (SDK-free)

**Files:**
- Create: `src/spectrum/context.ts`
- Create: `src/spectrum/deps.ts`
- Test: `test/spectrum-deps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/spectrum-deps.test.ts
import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "../src/http/ratelimit";
import { MockModel } from "../src/model/mock";
import { MockPokeClient } from "../src/poke/index";
import { tagPayloads } from "../src/spectrum/payloads";
import { MockRouterModel } from "../src/spectrum/router";
import { makeSpectrumToolContext } from "../src/spectrum/context";
import { buildSpectrumDeps } from "../src/spectrum/deps";
import { makePgMemStore } from "../src/store/pgmem";

describe("makeSpectrumToolContext", () => {
  it("builds a ToolContext whose tools run against the store (add_note works end to end)", async () => {
    const store = await makePgMemStore();
    await store.init();
    const make = makeSpectrumToolContext({
      store,
      model: new MockModel(),
      poke: new MockPokeClient(),
      personaModel: "p",
      synthModel: "s",
    });
    const ctx = make("spectrum:+1");
    expect(ctx.userId).toBe("spectrum:+1");
    const item = await ctx.store.addBacklog({ user_id: ctx.userId, text: "hi" });
    expect(item.text).toBe("hi");
    expect(typeof ctx.makeStep).toBe("function");
  });
});

describe("buildSpectrumDeps", () => {
  it("assembles deps with SPECTRUM_TOOLS and a working makeToolContext", async () => {
    const store = await makePgMemStore();
    await store.init();
    const deps = buildSpectrumDeps({
      store,
      model: new MockModel(),
      poke: new MockPokeClient(),
      router: new MockRouterModel(),
      payloads: tagPayloads,
      rateLimiter: new InMemoryRateLimiter(),
      rateMax: 60,
      rateWindowSec: 60,
    });
    expect(deps.tools.some((t) => t.name === "prioritize")).toBe(true);
    expect(deps.rateMax).toBe(60);
    expect(deps.makeToolContext("u").userId).toBe("u");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spectrum-deps.test.ts`
Expected: FAIL — cannot find module `../src/spectrum/context`.

- [ ] **Step 3: Implement the context factory**

```ts
// src/spectrum/context.ts
import { LocalStep } from "../durable/step";
import type { Model } from "../model/types";
import type { PokeClient } from "../poke/index";
import type { Store } from "../store/types";
import type { ToolContext } from "../tools/types";

export interface SpectrumContextDeps {
  store: Store;
  model: Model;
  poke: PokeClient;
  personaModel: string;
  synthModel: string;
}

/**
 * Build the per-user ToolContext the existing tool handlers expect. Mirrors the
 * MCP server's wiring (src/http/core.ts) but with `poke` = SpectrumDelivery and
 * a fire-and-forget `background`. Phase-A omits dispatchAsyncCouncil (council is
 * not on the Spectrum line yet).
 */
export function makeSpectrumToolContext(deps: SpectrumContextDeps): (userId: string) => ToolContext {
  return (userId: string) => ({
    store: deps.store,
    model: deps.model,
    makeStep: () => new LocalStep(),
    poke: deps.poke,
    userId,
    personaModel: deps.personaModel,
    synthModel: deps.synthModel,
    background: (_label, fn) => {
      void fn().catch(() => {});
    },
  });
}
```

- [ ] **Step 4: Implement the deps assembler**

```ts
// src/spectrum/deps.ts
import { config } from "../config";
import { InMemoryRateLimiter, type RateLimiter } from "../http/ratelimit";
import type { Model } from "../model/types";
import type { PokeClient } from "../poke/index";
import type { Store } from "../store/types";
import { makeSpectrumToolContext } from "./context";
import { SPECTRUM_TOOLS } from "./tools";
import type { RouterModel, SpectrumDeps, SpectrumPayloads } from "./types";

/**
 * SDK-free assembly of everything handleInbound needs. Kept apart from app.ts so
 * its test never imports spectrum-ts. The boot (app.ts) calls this with the
 * SDK-backed payloads + a SpectrumDelivery.
 */
export function buildSpectrumDeps(opts: {
  store: Store;
  model: Model;
  poke: PokeClient;
  router: RouterModel;
  payloads: SpectrumPayloads;
  rateLimiter?: RateLimiter;
  rateMax: number;
  rateWindowSec: number;
}): SpectrumDeps {
  return {
    store: opts.store,
    tools: SPECTRUM_TOOLS,
    makeToolContext: makeSpectrumToolContext({
      store: opts.store,
      model: opts.model,
      poke: opts.poke,
      personaModel: config.personaModel,
      synthModel: config.synthModel,
    }),
    router: opts.router,
    payloads: opts.payloads,
    rateLimiter: opts.rateLimiter ?? new InMemoryRateLimiter(),
    rateMax: opts.rateMax,
    rateWindowSec: opts.rateWindowSec,
  };
}
```

- [ ] **Step 5: Run test + typecheck to verify pass**

Run: `npx vitest run test/spectrum-deps.test.ts && npm run typecheck`
Expected: PASS (2 tests) + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/spectrum/context.ts src/spectrum/deps.ts test/spectrum-deps.test.ts
git commit -m "feat(spectrum): SDK-free ToolContext + deps assembly"
```

---

### Task 9: Inbound handler — the integrator

**Files:**
- Create: `src/spectrum/handler.ts`
- Test: `test/spectrum-handler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/spectrum-handler.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "../src/http/ratelimit";
import { MockModel } from "../src/model/mock";
import { MockPokeClient } from "../src/poke/index";
import { buildSpectrumDeps } from "../src/spectrum/deps";
import { handleInbound } from "../src/spectrum/handler";
import { tagPayloads } from "../src/spectrum/payloads";
import { MockRouterModel } from "../src/spectrum/router";
import { makePgMemStore } from "../src/store/pgmem";
import type { Store } from "../src/store/types";
import type { MessageLike, SpaceLike, SpectrumDeps } from "../src/spectrum/types";

function fakeSpace(id: string, type: "dm" | "group" = "dm") {
  const sent: any[] = [];
  const space: SpaceLike = { id, type, send: async (c) => { sent.push(c); } };
  return { space, sent };
}
function textMsg(text: string, sender = "+1555") {
  const reacts: string[] = [];
  const msg: MessageLike = {
    content: { type: "text", text },
    sender: { id: sender },
    react: async (r) => { reacts.push(r); },
  };
  return { msg, reacts };
}

async function makeDeps(store: Store, rateMax = 60): Promise<SpectrumDeps> {
  return buildSpectrumDeps({
    store,
    model: new MockModel(),
    poke: new MockPokeClient(),
    router: new MockRouterModel(),
    payloads: tagPayloads,
    rateLimiter: new InMemoryRateLimiter(),
    rateMax,
    rateWindowSec: 60,
  });
}

describe("handleInbound", () => {
  let store: Store;
  beforeEach(async () => {
    store = await makePgMemStore();
    await store.init();
  });

  it("runs the routed tool, persists the space + both turns, and replies with text", async () => {
    const deps = await makeDeps(store);
    const { space, sent } = fakeSpace("guid-1");
    const { msg } = textMsg("save the spectrum launch checklist");
    await handleInbound(deps, space, msg);

    const open = await store.listBacklog("spectrum:+1555", "open");
    expect(open.length).toBe(1);
    expect(sent[0]).toMatchObject({ kind: "text" });
    expect(String(sent[0].text)).toContain("backlog");

    expect((await store.getSpectrumSpace("spectrum:+1555"))?.space_id).toBe("guid-1");
    const turns = await store.recentSpectrumTurns("spectrum:+1555", 10);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("reacts with a tapback when completing a note", async () => {
    const deps = await makeDeps(store);
    await store.addBacklog({ user_id: "spectrum:+1555", text: "finish me" });
    const { space, sent } = fakeSpace("guid-1");
    const { msg, reacts } = textMsg("mark 1 done");
    await handleInbound(deps, space, msg);

    expect(reacts).toContain("👍");
    expect((await store.listBacklog("spectrum:+1555", "done")).length).toBe(1);
    expect(String(sent[0].text)).toContain("Done");
  });

  it("renders a native poll when the user asks to prioritize", async () => {
    const deps = await makeDeps(store);
    await store.addBacklog({ user_id: "spectrum:+1555", text: "task A" });
    await store.addBacklog({ user_id: "spectrum:+1555", text: "task B" });
    const { space, sent } = fakeSpace("guid-1");
    const { msg } = textMsg("which should I do first?");
    await handleInbound(deps, space, msg);

    expect(sent[0]).toMatchObject({ kind: "poll" });
    expect(sent[0].options).toEqual(["task A", "task B"]);
  });

  it("replies conversationally on out-of-domain text (the product surface)", async () => {
    const deps = await makeDeps(store);
    const { space, sent } = fakeSpace("guid-1");
    const { msg } = textMsg("how's your day going");
    await handleInbound(deps, space, msg);
    expect(sent[0]).toMatchObject({ kind: "text" });
    expect(String(sent[0].text).length).toBeGreaterThan(0);
  });

  it("ignores group messages in Phase A", async () => {
    const deps = await makeDeps(store);
    const { space, sent } = fakeSpace("group-1", "group");
    const { msg } = textMsg("save this");
    await handleInbound(deps, space, msg);
    expect(sent.length).toBe(0);
  });

  it("ignores messages with no resolvable sender", async () => {
    const deps = await makeDeps(store);
    const { space, sent } = fakeSpace("guid-1");
    const msg: MessageLike = { content: { type: "text", text: "hi" }, sender: undefined, react: async () => {} };
    await handleInbound(deps, space, msg);
    expect(sent.length).toBe(0);
  });

  it("throttles past the rate ceiling with a gentle message", async () => {
    const deps = await makeDeps(store, 1); // max 1/window
    const { space, sent } = fakeSpace("guid-1");
    await handleInbound(deps, space, textMsg("save one").msg);
    await handleInbound(deps, space, textMsg("save two").msg);
    expect(String(sent[1].text).toLowerCase()).toContain("one sec");
    // only the first message created a backlog item
    expect((await store.listBacklog("spectrum:+1555", "open")).length).toBe(1);
  });

  it("pins the chosen item when a poll vote arrives", async () => {
    const deps = await makeDeps(store);
    await store.addBacklog({ user_id: "spectrum:+1555", text: "task A" });
    await store.addBacklog({ user_id: "spectrum:+1555", text: "task B" });
    const { space, sent } = fakeSpace("guid-1");
    const voteMsg: MessageLike = {
      content: { type: "poll_option", option: "task B" },
      sender: { id: "+1555" },
      react: async () => {},
    };
    await handleInbound(deps, space, voteMsg);

    const pinned = await store.listBacklog("spectrum:+1555", "pinned");
    expect(pinned.map((i) => i.text)).toContain("task B");
    expect(String(sent[0].text)).toContain("task B");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spectrum-handler.test.ts`
Expected: FAIL — cannot find module `../src/spectrum/handler`.

- [ ] **Step 3: Implement the handler**

```ts
// src/spectrum/handler.ts
import { findTool } from "../tools/index";
import type { ToolResult } from "../tools/types";
import { resolveUserId } from "./identity";
import { ROUTER_SYSTEM } from "./router";
import type { MessageLike, PollSpec, SpaceLike, SpectrumDeps } from "./types";

/** Did a backlog tool fail to find/complete the referenced item? (don't tapback on a miss) */
function isMiss(text: string): boolean {
  return text.startsWith("I couldn't") || text.startsWith("Couldn't");
}

/** Turn a ToolResult into the right native surface: tapback / poll / text. */
async function deliverResult(
  space: SpaceLike,
  message: MessageLike,
  result: ToolResult,
  toolName: string,
  deps: SpectrumDeps,
): Promise<void> {
  if (toolName === "complete_note" && !isMiss(result.text)) {
    try {
      await message.react("👍"); // native tapback on the user's message
    } catch {
      // react() can be unsupported (e.g. local-mode provider) — the text below still lands.
    }
  }
  const poll = (result.data as { poll?: PollSpec } | undefined)?.poll;
  if (poll && poll.options.length >= 2) {
    await space.send(deps.payloads.poll(poll.title, poll.options));
    return;
  }
  await space.send(deps.payloads.text(result.text));
}

/** A poll vote: pin the chosen open item (best-effort title match) and confirm. */
async function handlePollVote(deps: SpectrumDeps, space: SpaceLike, userId: string, option: string): Promise<void> {
  const open = await deps.store.listBacklog(userId, "open");
  const chosen = open.find((i) => i.text.slice(0, 80) === option) ?? open.find((i) => i.text === option);
  if (!chosen) {
    await space.send(deps.payloads.text("Thanks — noted."));
    return;
  }
  await deps.store.pinBacklog(userId, chosen.id, true);
  await space.send(deps.payloads.text(`On it — pinned "${chosen.text}" to the top. Let's start there.`));
}

/**
 * Handle one inbound message end to end. Pure of the SDK: `space`/`message` are
 * the structural SpaceLike/MessageLike, so this is fully unit-testable with fakes.
 *
 * Flow: text/vote guard → DM-only guard → sender guard → identity + remember
 * space → rate guard → append user turn → route over recent memory → run the
 * matched tool (or reply) → deliver with native texture → append assistant turn.
 */
export async function handleInbound(deps: SpectrumDeps, space: SpaceLike, message: MessageLike): Promise<void> {
  // Phase A: 1:1 only (no group mention-detection yet).
  if (space.type && space.type !== "dm") return;

  const senderId = message.sender?.id;
  const userId = resolveUserId(senderId);
  if (!userId) return;

  await deps.store.upsertSpectrumSpace({ user_id: userId, space_id: space.id });

  // Poll vote → its own lightweight branch (no LLM, no rate cost).
  if (message.content.type === "poll_option") {
    const option = String((message.content as { option?: unknown }).option ?? "");
    await handlePollVote(deps, space, userId, option);
    return;
  }

  // Everything else we handle is text.
  if (message.content.type !== "text") return;
  const text = String((message.content as { text?: unknown }).text ?? "").trim();
  if (!text) return;

  // Per-user rate ceiling — every inbound costs an LLM call, so cap loops/floods.
  const limit = await deps.rateLimiter.hit(`spectrum:${userId}`, deps.rateMax, deps.rateWindowSec);
  if (!limit.allowed) {
    await space.send(deps.payloads.text("One sec — give me a moment to catch up, then try again."));
    return;
  }

  await deps.store.appendSpectrumTurn({ user_id: userId, space_id: space.id, role: "user", text });
  const history = await deps.store.recentSpectrumTurns(userId, 10);
  const decision = await deps.router.decide({ system: ROUTER_SYSTEM, messages: history, tools: deps.tools });

  let assistantText: string;
  if (decision.kind === "tool" && decision.name) {
    const tool = findTool(decision.name) ?? deps.tools.find((t) => t.name === decision.name);
    if (!tool) {
      assistantText = "Hmm — I blanked on how to do that. Mind rephrasing?";
      await space.send(deps.payloads.text(assistantText));
    } else {
      const ctx = deps.makeToolContext(userId);
      const result = await tool.handler(decision.arguments ?? {}, ctx);
      await deliverResult(space, message, result, decision.name, deps);
      assistantText = result.text;
    }
  } else {
    assistantText = decision.text ?? "I'm here — what do you need?";
    await space.send(deps.payloads.text(assistantText));
  }

  await deps.store.appendSpectrumTurn({ user_id: userId, space_id: space.id, role: "assistant", text: assistantText });
}
```

> **Build-time verify:** the inbound poll-vote field. Source research found `content.type === "poll_option"`; this code reads `content.option`. If the SDK names it differently (`content.text` / `content.title` / an index), adjust the one `(message.content as {...}).option` read. The structural fake in the test pins the contract we expect.

- [ ] **Step 4: Run test + typecheck to verify pass**

Run: `npx vitest run test/spectrum-handler.test.ts && npm run typecheck`
Expected: PASS (8 tests) + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/spectrum/handler.ts test/spectrum-handler.test.ts
git commit -m "feat(spectrum): inbound handler — route, run, deliver (tapback/poll/text), poll-vote"
```

---

### Task 10: Boot + loop + CLI entry (the SDK adapter)

**Files:**
- Modify: `package.json` (dep + script)
- Create: `src/spectrum/app.ts`
- Create: `src/spectrum/run.ts`
- Test: manual (no unit test — this is the SDK-boundary integration file; its logic is covered by Tasks 6–9)

- [ ] **Step 1: Add the dependency + run script**

Run:

```bash
npm install spectrum-ts
```

Expected: adds `spectrum-ts@5.x` (pulls `@photon-ai/advanced-imessage`, `@photon-ai/imessage-kit`, zod). If install fails on a transitive native module, retry with `npm install spectrum-ts --omit=optional`; the Cloud/terminal paths used here don't need the local-mode native bits.

In `package.json`, add to the `"scripts"` block:

```json
    "spectrum": "tsx src/spectrum/run.ts",
```

- [ ] **Step 2: Implement the SDK adapter (app.ts)**

```ts
// src/spectrum/app.ts
import { Spectrum } from "spectrum-ts";
import { poll as sdkPoll, text as sdkText } from "spectrum-ts";
import { effect as sdkEffect, imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { config } from "../config";
import { makeModel } from "../model/index";
import { runScheduler } from "../scheduler";
import { makeStore } from "../store/index";
import type { Trigger } from "../store/types";
import { SpectrumDelivery } from "./delivery";
import { buildSpectrumDeps } from "./deps";
import { handleInbound } from "./handler";
import { makeRouterModel } from "./router";
import type { MessageLike, SpaceLike, SpectrumPayloads } from "./types";

/** Real, SDK-backed content factory (the prod counterpart of tagPayloads). */
export const realPayloads: SpectrumPayloads = {
  text: (s) => sdkText(s),
  effect: (s, e) => {
    const table = imessage.effect.message as Record<string, unknown>;
    return sdkEffect(s, (table[e] ?? table.sparkles) as never);
  },
  poll: (title, options) => sdkPoll(title, options),
};

/** Proactive reminders are sent verbatim (with an effect via SpectrumDelivery), not as Poke instructions. */
function humanPhrase(t: Trigger): string {
  return t.kind === "resurface" ? `Resurfacing a note you saved: ${t.text}` : t.text;
}

/**
 * Boot the agent's own iMessage line and run forever. The only file that imports
 * the SDK. Provider `terminal` runs with no credentials for an offline harness;
 * `imessage` uses Spectrum Cloud (needs SPECTRUM_PROJECT_ID/SECRET).
 *
 * Proactive delivery uses an in-process live-space map: any space we've heard
 * from is sendable, so a reminder set during a session is delivered by this same
 * long-lived process. Cold cross-process delivery (resolve a stored GUID we
 * haven't seen) is Phase-B and needs the SDK's space-get.
 */
export async function runSpectrum(opts?: { provider?: "imessage" | "terminal" }): Promise<void> {
  const store = await makeStore();
  const liveSpaces = new Map<string, SpaceLike>();

  const delivery = new SpectrumDelivery({
    store,
    resolveSpace: (spaceId) => liveSpaces.get(spaceId),
    payloads: realPayloads,
  });
  const deps = buildSpectrumDeps({
    store,
    model: makeModel(),
    poke: delivery,
    router: makeRouterModel(),
    payloads: realPayloads,
    rateMax: config.mcpRateMax,
    rateWindowSec: config.mcpRateWindowSec,
  });

  const provider = opts?.provider === "terminal" ? terminal.config() : imessage.config();
  const app = await Spectrum({
    projectId: config.spectrumProjectId,
    projectSecret: config.spectrumProjectSecret,
    providers: [provider],
  });

  // Minute-resolution scheduler tick — fires due reminders to their owner's live space.
  const tick = setInterval(() => {
    void runScheduler(store, delivery, new Date().toISOString(), humanPhrase).catch((e) =>
      console.error("[spectrum] scheduler tick failed", e),
    );
  }, 60_000);

  console.log(`[spectrum] agent live on provider '${opts?.provider ?? "imessage"}' — texting back.`);
  try {
    for await (const [space, message] of app.messages) {
      // The single SDK boundary: the real Space/Message structurally satisfy our *Like views.
      const s = space as unknown as SpaceLike;
      liveSpaces.set(s.id, s);
      await (space as unknown as { responding: (fn: () => Promise<void>) => Promise<void> }).responding(() =>
        handleInbound(deps, s, message as unknown as MessageLike),
      );
    }
  } finally {
    clearInterval(tick);
  }
}
```

> **Build-time verify (2 spots):** (a) `app.messages` tuple order + `space.responding` exist as researched — if `responding` isn't present, drop the wrapper and call `handleInbound` directly (typing indicator is cosmetic). (b) `imessage.config()` for Cloud — if the SDK wants explicit options, pass them here. Neither affects the tested core.

- [ ] **Step 3: Implement the CLI entry (run.ts)**

```ts
// src/spectrum/run.ts
import { runSpectrum } from "./app";

/** `npm run spectrum` → live iMessage line; `npm run spectrum -- --terminal` → offline harness. */
const provider = process.argv.includes("--terminal") ? "terminal" : "imessage";

runSpectrum({ provider }).catch((e) => {
  console.error("[spectrum] fatal:", e);
  process.exit(1);
});
```

- [ ] **Step 4: Typecheck + full suite (no regressions)**

Run: `npm run typecheck && npm test`
Expected: clean typecheck; **all** tests pass (the original 129 + the new spectrum suites). The SDK import resolves at typecheck because `spectrum-ts` ships its own types.

> If `npm run typecheck` cannot find the `spectrum-ts/providers/*` subpath types, confirm the package installed (`ls node_modules/spectrum-ts`) and that its `package.json` `exports` map lists those subpaths; if a subpath type is missing, add `// @ts-expect-error SDK subpath types` above that one import — runtime is unaffected.

- [ ] **Step 5: Manual smoke (offline terminal provider — no credentials)**

Run: `npm run spectrum -- --terminal`
Expected: prints `[spectrum] agent live on provider 'terminal' — texting back.` and accepts typed input in the terminal harness; type `save buy milk` → it confirms a backlog add; `what's on my list?` → lists it; `which should I do first?` (after adding 2) → renders a poll. Ctrl-C to exit.

> If the terminal provider's exact entry differs from `terminal.config()`, consult `node_modules/spectrum-ts` exports; the offline harness is a convenience, not a test gate.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/spectrum/app.ts src/spectrum/run.ts
git commit -m "feat(spectrum): boot + message loop + scheduler tick + CLI entry (SDK adapter)"
```

---

### Task 11: Docs — provisioning, run, driven-demo script

**Files:**
- Create: `docs/SPECTRUM.md`

- [ ] **Step 1: Write the doc**

````markdown
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
| `SPECTRUM_PROJECT_ID` | for the live line | Spectrum Cloud project id. |
| `SPECTRUM_PROJECT_SECRET` | for the live line | Spectrum Cloud project secret. |
| `DATABASE_URL` | recommended | Neon Postgres (shared `pc_*` schema). Empty → in-memory pg-mem (state resets on restart). |
| `ANTHROPIC_API_KEY` | for the real brain | Set → ClaudeRouterModel (real NL routing). Empty → deterministic MockRouterModel (keyword routing — fine for the offline demo). |

## 3. Run
```bash
# Offline harness — no credentials, type messages in your terminal:
npm run spectrum -- --terminal

# Live iMessage line (needs SPECTRUM_PROJECT_ID/SECRET):
npm run spectrum
```

## 4. Driven-demo script (record this)
With the live line connected and your number texting the agent:
1. **"save the spectrum launch checklist"** → "Added to your backlog…".
2. **"remind me to stretch in 1 minute"** → "Reminder set for …". Wait — the
   agent **texts you first** with a 🔦 spotlight effect.
3. **"what's on my list?"** → numbered backlog.
4. **"mark 1 done"** → 👍 tapback on your message + "Done: …".
5. add a second item, then **"which should I do first?"** → a native **poll**;
   tap an option → it pins that item and replies.
6. **"how's it going?"** → a warm conversational reply (the out-of-domain surface).

## Architecture (one screen)
- `app.ts` — the only SDK file: boots `Spectrum(...)`, streams `app.messages`,
  keeps a live-space map, ticks the scheduler.
- `handler.ts` — routes each inbound via `router.ts`, runs a tool with a rebuilt
  `ToolContext`, delivers with native texture; SDK-free + fully unit-tested.
- `delivery.ts` — `SpectrumDelivery` (the `PokeClient` seam) sends verbatim,
  multi-tenant, with an effect for reminders.
- Reused unchanged: `tools/`, `store/`, `model/`, `scheduler` (widened, backward-compatible).
````

- [ ] **Step 2: Commit**

```bash
git add docs/SPECTRUM.md
git commit -m "docs(spectrum): provisioning, run modes, and the driven-demo script"
```

---

## Self-Review

**1. Spec coverage** (against the migration map's locked ~1-week scope):

| Map scope item | Task |
|---|---|
| `src/spectrum/app.ts` (runtime loop) | Task 10 |
| `src/spectrum/router.ts` (the NL brain) | Task 4 |
| `src/spectrum/identity.ts` (space→user_id) | Task 3 |
| two store tables | Task 2 |
| `SpectrumDelivery` client | Task 6 |
| text-first render + one effect / one tapback / one poll | Tasks 6 (effect), 9 (tapback, poll) |
| out-of-domain reply as a product surface | Task 9 (reply branch) |
| per-user delivery target on the scheduler | Task 5 |
| config keys | Task 1 |
| tests (Vitest, definePlatform/structural fakes, not bun:test) | every task |
| **Out of scope (correctly absent):** council on the line, two-tier router, router eval loop, mini-app cards, group chat | — (council excluded in Task 7; noted in Task 11) |

No gaps. Every map deliverable maps to a task; every excluded item is deliberately excluded and documented.

**2. Placeholder scan:** No "TBD"/"implement later"/"add error handling"/"similar to Task N". Every code step shows complete code. The three **build-time-verify** notes (poll-vote field name; `app.send`/`responding` shape; SDK subpath types) are *flagged unknowns at the SDK boundary*, each with an explicit fallback and each isolated from the tested core — not placeholders in the implementation.

**3. Type consistency** (checked across tasks):
- `RouteDecision`, `RouterModel`, `ChatTurn`, `PollSpec`, `SpaceLike`, `MessageLike`, `SpectrumPayloads`, `SpectrumDeps` — all defined once in `types.ts` (Task 1); imported everywhere else.
- `SpectrumDeps` fields produced by `buildSpectrumDeps` (Task 8) exactly match what `handleInbound` consumes (Task 9): `store`, `tools`, `makeToolContext`, `router`, `payloads`, `rateLimiter`, `rateMax`, `rateWindowSec`.
- `PokeClient.push(instruction, opts?)` widened identically in the interface + both impls (Task 5) and implemented by `SpectrumDelivery` (Task 6); `runScheduler` calls it with `{ userId, kind }` (Task 5).
- Store methods `upsertSpectrumSpace` / `getSpectrumSpace` / `appendSpectrumTurn` / `recentSpectrumTurns` — same names/signatures in the `Store` interface (Task 2), the `SqlStore` impl (Task 2), and all call sites (Tasks 6, 9).
- `prioritize` tool name is referenced in `MockRouterModel` routing (Task 4), defined in `tools.ts` (Task 7), and asserted in the handler poll test (Task 9) — consistent.
- Tool arg shapes used by `MockRouterModel` match the real schemas: `add_note {text}`, `complete_note {ref}`, `set_reminder {text, fire_at}`, `list_backlog {}`, `list_reminders {}` — all verified against `src/tools/*`.

**4. Ordering / dependency sanity:** Each task's tests depend only on files from earlier tasks (1→types, 2→store, 3→identity, 4→router, 5→scheduler+poke, 6→delivery, 7→tools, 8→context/deps, 9→handler, 10→boot, 11→docs). A subagent can execute strictly in order.

One refinement applied during review: `MockRouterModel`'s `set_reminder` `fire_at` fixture uses `2026-06-20` (a future date relative to the build) so the offline demo's reminder is genuinely "upcoming," not already-past.
