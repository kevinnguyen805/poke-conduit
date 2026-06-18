# poke-conduit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Test ordering:** Per the user's documented preference, tests are written **immediately after** each unit's implementation (not failing-test-first), paired within the same task and committed together. Coverage target: unit + feature + e2e, with explicit failure logs.

**Goal:** Build a durable, Poke-compatible multi-agent MCP backend ("the brain Poke consults") that is fully tested and demo'able locally, and deployable to Vercel + Neon + Inngest.

**Architecture:** Poke calls a single MCP server over HTTP. Fast tools (backlog/status/recipes/reminders) run inline against Postgres. The council runs as durable steps (Inngest in prod, `LocalStep` in tests/demo) and pushes its synthesis back to the user through Poke's inbound API. A `Step` injection seam makes durability testable without the Inngest runtime; a single `SqlStore` runs on both `pg-mem` (tests) and Neon (prod).

**Tech Stack:** TypeScript / Node 20 / ESM · `@anthropic-ai/sdk` · `@neondatabase/serverless` + `pg-mem` · `@vercel/node` · `zod` · `vitest` + `tsx`.

> **As-built note (2026-06-18):** `@modelcontextprotocol/sdk` and `inngest` were dropped during the
> build (see the spec's "Build addendum"). The MCP server is hand-rolled JSON-RPC (edge-compatible,
> fully testable); the council runs inline under `LocalStep` within Vercel's 300 s budget, and the
> scheduler is **Vercel Cron** — so `api/inngest.ts` became **`api/cron.ts`** and there is no
> `inngest.json`. The `Step` seam + `fromInngestStep` adapter remain as the documented upgrade path.

---

## File structure

```
api/            mcp.ts · inngest.ts · healthz.ts
src/
  config.ts
  ids.ts                         newId(prefix)
  store/  types.ts · schema.ts · sql.ts (SqlStore) · pgmem.ts · pg.ts · index.ts
  model/  index.ts (Model) · mock.ts · claude.ts
  durable/ step.ts (Step, LocalStep) · scheduler.ts
  poke/   inbound.ts (PokeClient, HttpPokeClient, MockPokeClient)
  agents/ personas.ts · worker.ts · council.ts · orchestrator.ts
  render.ts
  tools/  backlog.ts · reminders.ts · status.ts · recipes.ts · council.ts · index.ts
  mcp/    auth.ts · server.ts
  http/   core.ts
  serve.ts · demo.ts
test/     <unit + feature + e2e>.test.ts
```

---

## Task 1: Scaffold

**Files:** Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/config.ts`, `src/ids.ts`, `.env.example`.

- [ ] **package.json** (type module; scripts: `test`=`vitest run`, `test:watch`, `typecheck`=`tsc --noEmit`, `demo`=`tsx src/demo.ts`, `serve`=`tsx src/serve.ts`). Deps: `@modelcontextprotocol/sdk@^1.29.0`, `@anthropic-ai/sdk@^0.32`, `inngest@^3`, `@neondatabase/serverless@^0.10.4`, `zod@^3.25`. Dev: `@types/node@^20`, `pg-mem@^3`, `tsx@^4.19`, `typescript@^5.6`, `vitest@^2.1`, `@vercel/node@^3`.
- [ ] **tsconfig.json**: target ES2022, module NodeNext, moduleResolution NodeNext, strict true, noEmit true, esModuleInterop, skipLibCheck.
- [ ] **vitest.config.ts**: `globals:true`, `environment:'node'`.
- [ ] **src/ids.ts**: `export const newId = (p: string) => \`${p}_${Math.random().toString(36).slice(2,10)}${Date.now().toString(36)}\`;`
- [ ] **src/config.ts**: read env per spec §9 with the defaults below; `personaModel` default `"claude-haiku-4-5-20251001"`, `synthModel` default `"claude-fable-5"` (revisit via claude-api skill in Task 3), `pokeInboundUrl` default `https://poke.com/api/v1/inbound/api-message`, `port` default `7411`.
- [ ] `npm install`, then **commit**: `chore: scaffold poke-conduit`.

---

## Task 2: Store (SqlStore on pg-mem + Neon)

**Files:** Create `src/store/types.ts`, `schema.ts`, `sql.ts`, `pgmem.ts`, `pg.ts`, `index.ts`; Test `test/store.test.ts`.

- [ ] **types.ts** — entity types + `Exec` + `Store`:

```ts
export type BacklogStatus = "open" | "done";
export interface BacklogItem { id: string; user_id: string; text: string; status: BacklogStatus; pinned: boolean; tags: string; created_at: Date; completed_at: Date | null; }
export interface Recipe { id: string; user_id: string; name: string; prompt: string; integrations: string; enabled: boolean; created_at: Date; }
export type StatusKind = "active" | "dnd" | "deep_work";
export interface Status { user_id: string; status: StatusKind; note: string; until: Date | null; updated_at: Date; }
export type Recurrence = "none" | "daily";
export interface Trigger { id: string; user_id: string; kind: string; text: string; fire_at: Date; recurrence: Recurrence; status: "pending" | "fired"; created_at: Date; }
export type RunStatus = "running" | "done" | "error";
export interface Run { id: string; user_id: string; kind: string; status: RunStatus; input: string; output: string; created_at: Date; finished_at: Date | null; }
export type BacklogFilter = "open" | "pinned" | "done" | "all";

export type Exec = (text: string, params?: unknown[]) => Promise<Record<string, any>[]>;

export interface Store {
  init(): Promise<void>;
  addBacklog(i: { user_id: string; text: string; tags?: string }): Promise<BacklogItem>;
  listBacklog(userId: string, filter: BacklogFilter): Promise<BacklogItem[]>;
  resolveRef(userId: string, ref: number | string): Promise<BacklogItem | null>;
  completeBacklog(userId: string, id: string): Promise<BacklogItem | null>;
  pinBacklog(userId: string, id: string, pinned: boolean): Promise<BacklogItem | null>;
  listRecipes(userId: string): Promise<Recipe[]>;
  installRecipe(r: { user_id: string; name: string; prompt?: string; integrations?: string; enabled?: boolean }): Promise<Recipe>;
  getStatus(userId: string): Promise<Status>;
  setStatus(s: { user_id: string; status: StatusKind; note?: string; until?: Date | null }): Promise<Status>;
  addTrigger(t: { user_id: string; kind?: string; text: string; fire_at: Date; recurrence?: Recurrence }): Promise<Trigger>;
  dueTriggers(now: Date): Promise<Trigger[]>;
  markTriggerFired(id: string, rearmTo?: Date): Promise<void>;
  createRun(r: { id: string; user_id: string; kind: string; input: string }): Promise<Run>;
  finishRun(id: string, output: string): Promise<boolean>;
  errorRun(id: string, output: string): Promise<void>;
  getRun(userId: string, id: string): Promise<Run | null>;
}
```

- [ ] **schema.ts** — `export const SCHEMA_SQL = \`...\`` with the five `pc_` tables from spec §8; `export async function applySchema(exec: Exec) { for (const stmt of SCHEMA_SQL.split(';').map(s=>s.trim()).filter(Boolean)) await exec(stmt); }`.
- [ ] **sql.ts** — `export class SqlStore implements Store` over an injected `Exec`. Notes: `resolveRef` — if `ref` is a number or numeric string, fetch `listBacklog(userId,"open")` (ordered `pinned DESC, created_at ASC`) and index 1-based; else `SELECT * WHERE id=$1 AND user_id=$2`. `finishRun` runs `UPDATE pc_runs SET status='done', output=$2, finished_at=now() WHERE id=$1 AND status='running'` and returns `rowCount>0` (idempotency guard) — since `Exec` returns rows, use `RETURNING id` and return `rows.length>0`. Map DB rows → typed objects (coerce `created_at` etc. to `Date`, booleans).
- [ ] **pgmem.ts** — `export async function makePgMemStore(): Promise<Store>` using `newDb()` → `db.adapters.createPg()` → `new Pool()`; `Exec = (t,p)=> pool.query(t,p).then(r=>r.rows)`; `await applySchema(exec)`; return `new SqlStore(exec)`.
- [ ] **pg.ts** — `export function makeNeonStore(url: string): Store` using `neon(url)`; `Exec = (t,p)=> sql.query(t,p)`; return `new SqlStore(exec)` (caller runs `init()` which calls `applySchema`).
- [ ] **index.ts** — re-export; `export async function makeStore(): Promise<Store>` → Neon if `config.databaseUrl`, else pg-mem (for local serve without a DB).
- [ ] **test/store.test.ts** — against `makePgMemStore()`: add 3 backlog items → `listBacklog open` returns 3 in pinned/created order; `resolveRef(1)` returns the first; `resolveRef("<id>")` returns by id; `pinBacklog` moves item to front; `completeBacklog` flips status + sets `completed_at` + drops from `open` filter; recipes install/list; status default `active` then `setStatus`; triggers add → `dueTriggers(future)` includes it, `dueTriggers(past)` excludes future ones; `markTriggerFired` flips to `fired`; `createRun`→`finishRun` returns `true` first time, `false` second time (idempotency). Each assertion logs `expected/actual` on failure.
- [ ] Run `npx vitest run test/store.test.ts` → PASS. **Commit**: `feat(store): SqlStore over pg-mem/Neon with idempotent run finalize`.

---

## Task 3: Model (Mock + Claude)

**Files:** Create `src/model/index.ts`, `mock.ts`, `claude.ts`; Test `test/model.test.ts`.

- [ ] **index.ts**:

```ts
export interface ModelMessage { role: "user" | "assistant"; content: string; }
export interface CompleteOpts { system: string; messages: ModelMessage[]; model?: string; maxTokens?: number; }
export interface Model { complete(opts: CompleteOpts): Promise<string>; }
```

- [ ] **mock.ts** — `export class MockModel implements Model`: deterministic. If `system` contains `"SYNTHESIS"`, return `\`SYNTHESIS of ${countPovs(messages)} views: <merged first lines>\``; else parse a `LABEL:` token the personas put at the top of their system prompt and return `\`${label}: take on "${lastUserText}"\``. Pure, no network.
- [ ] **claude.ts** — `export class ClaudeModel implements Model` using `@anthropic-ai/sdk`: `new Anthropic({ apiKey })`; `complete()` → `client.messages.create({ model: opts.model ?? config.synthModel, max_tokens: opts.maxTokens ?? 1024, system: opts.system, messages: opts.messages })` and join text blocks. **Before writing this file, invoke the `claude-api` skill** to confirm current model ids, the SDK call shape, and pricing for the persona/synth tiers; adjust `config.ts` defaults accordingly.
- [ ] `export function makeModel(): Model` → `ClaudeModel` if `config.anthropicApiKey`, else `MockModel`.
- [ ] **test/model.test.ts** — MockModel: persona-style system → output contains the label + the question substring; synthesis system → output starts `SYNTHESIS of`. (ClaudeModel not unit-tested; covered by live demo path.) **Commit**: `feat(model): Model interface, deterministic MockModel, Claude adapter`.

---

## Task 4: Durable Step + Scheduler + PokeClient

**Files:** Create `src/durable/step.ts`, `scheduler.ts`, `src/poke/inbound.ts`; Test `test/durable.test.ts`, `test/poke.test.ts`.

- [ ] **step.ts**:

```ts
export interface Step { run<T>(id: string, fn: () => Promise<T>): Promise<T>; }
export class LocalStep implements Step {
  readonly calls: string[] = [];
  private memo = new Map<string, unknown>();
  async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.memo.has(id)) return this.memo.get(id) as T;
    this.calls.push(id);
    const v = await fn();
    this.memo.set(id, v);
    return v;
  }
}
```

- [ ] **poke/inbound.ts**:

```ts
export interface PokeClient { notifyUser(userId: string, instruction: string): Promise<void>; }
export class HttpPokeClient implements PokeClient {
  constructor(private apiKey: string, private url: string) {}
  async notifyUser(_userId: string, instruction: string): Promise<void> {
    const res = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ message: instruction }) });
    if (!res.ok) throw new Error(`poke inbound ${res.status}`);
  }
}
export class MockPokeClient implements PokeClient {
  readonly sent: { userId: string; instruction: string }[] = [];
  async notifyUser(userId: string, instruction: string): Promise<void> { this.sent.push({ userId, instruction }); }
}
```

- [ ] **scheduler.ts**:

```ts
export interface SchedulerDeps { store: Store; poke: PokeClient; }
export function reminderInstruction(text: string): string { return `Remind me: ${text}`; }
export async function runScheduler(deps: SchedulerDeps, now: Date): Promise<{ fired: string[] }> {
  const due = await deps.store.dueTriggers(now);
  const fired: string[] = [];
  for (const t of due) {
    await deps.poke.notifyUser(t.user_id, reminderInstruction(t.text));
    await deps.store.markTriggerFired(t.id, t.recurrence === "daily" ? new Date(t.fire_at.getTime() + 86_400_000) : undefined);
    fired.push(t.id);
  }
  return { fired };
}
```

- [ ] **test/durable.test.ts** — `LocalStep.run` executes fn once, records id in `calls`; second call with same id returns memoized value and does **not** re-push. `runScheduler`: with a due trigger → MockPokeClient.sent has 1 entry containing the reminder text, trigger marked `fired`; a daily trigger re-arms `fire_at` +1d and is not due again at the same `now`.
- [ ] **test/poke.test.ts** — MockPokeClient records `notifyUser`. **Commit**: `feat(durable): Step seam, scheduler, Poke inbound client`.

---

## Task 5: Agents (personas, worker, council, orchestrator)

**Files:** Create `src/agents/personas.ts`, `worker.ts`, `council.ts`, `orchestrator.ts`; Test `test/council.test.ts`.

- [ ] **personas.ts** — `export interface Persona { name: string; system: string; }` and `export const DEFAULT_PANEL: Persona[]` with four personas. Each `system` starts `LABEL: <name>\n` (so MockModel can echo it) then the stance: `builder` (optimistic, ship-it, opportunities), `skeptic` (failure modes, risks), `operator` (sequencing, what to do first), `user-advocate` (end-user impact). `export const SYNTH_SYSTEM = "SYNTHESIS. You merge multiple advisor viewpoints into one decisive recommendation with the key tradeoff named."` `export function resolvePanel(names?: string[]): Persona[]` → filter DEFAULT_PANEL by names or return all.
- [ ] **worker.ts**:

```ts
export interface Pov { persona: string; content?: string; error?: string; }
export async function runPersona(model: Model, step: Step, p: Persona, question: string): Promise<Pov> {
  try {
    const content = await step.run(`persona:${p.name}`, () => model.complete({ system: p.system, messages: [{ role: "user", content: question }], model: config.personaModel }));
    return { persona: p.name, content };
  } catch (e) { return { persona: p.name, error: String(e) }; }
}
```

- [ ] **council.ts**:

```ts
export interface CouncilDeps { model: Model; store: Store; poke: PokeClient; }
export function synthPrompt(question: string, povs: Pov[]): string {
  return `Question: ${question}\n\nAdvisor views:\n` + povs.map(p => `- ${p.persona}: ${p.content}`).join("\n");
}
export function councilPushInstruction(question: string, synthesis: string): string {
  return `Share this council result with me — Question: "${question}". Recommendation: ${synthesis}`;
}
export async function runCouncil(deps: CouncilDeps, step: Step, args: { runId: string; userId: string; question: string; personas?: string[]; deliver: "push" | "return"; }): Promise<Run> {
  const panel = resolvePanel(args.personas);
  const povs: Pov[] = [];
  for (const p of panel) povs.push(await runPersona(deps.model, step, p, args.question));
  const good = povs.filter(p => p.content);
  const synthesis = good.length === 0 ? "All advisors failed to respond." : await step.run("synthesis", () => deps.model.complete({ system: SYNTH_SYSTEM, messages: [{ role: "user", content: synthPrompt(args.question, good) }], model: config.synthModel }));
  const ok = await deps.store.finishRun(args.runId, JSON.stringify({ synthesis, povs }));
  if (ok && args.deliver === "push") await deps.poke.notifyUser(args.userId, councilPushInstruction(args.question, synthesis));
  return (await deps.store.getRun(args.userId, args.runId))!;
}
```

- [ ] **orchestrator.ts** — `export async function convene(deps, args: { userId; question; personas?; deliver }): Promise<Run>`: `const runId = newId("run"); await deps.store.createRun({ id: runId, user_id: args.userId, kind: "council", input: JSON.stringify({ question: args.question }) }); return runCouncil(deps, new LocalStep(), { runId, ...args });`. (Inline path used by serve/demo/tests; `api/inngest.ts` substitutes Inngest's step in prod.)
- [ ] **test/council.test.ts** — with MockModel + pg-mem + MockPokeClient: `convene({deliver:"return"})` → run.status `done`, output JSON has 4 povs all with `content`, synthesis starts `SYNTHESIS of 4`. `deliver:"push"` → MockPokeClient.sent has 1 entry containing the synthesis. Partial failure: a model that throws for `skeptic` → run still `done`, povs has 3 content + 1 error, synthesis from 3. LocalStep idempotency: re-running synthesis step id returns memo. **Commit**: `feat(agents): persona panel, worker, council with graceful degradation, orchestrator`.

---

## Task 6: Render + Tools + MCP auth + MCP server + Poke client wiring

**Files:** Create `src/render.ts`, `src/tools/{backlog,reminders,status,recipes,council,index}.ts`, `src/mcp/{auth,server}.ts`, `src/http/core.ts`; Test `test/tools.test.ts`, `test/mcp-auth.test.ts`, `test/mcp-server.test.ts`.

- [ ] **render.ts** — `renderBacklog(items, header?)` → header + numbered lines `\`${i+1}. ${pin}${text}${doneMark}${tags}\``; `renderStatus(s)` → `\`🟢/🟠/🔵 Agent status: ${status}${note}${until}\``; `renderCouncil(run)` → labeled POVs + `Recommendation:` synthesis; `renderRecipes(list)`.
- [ ] **tools/*.ts** — each exports an async fn `(deps, userId, args) => Promise<string>`. `deps: { store, model, poke }`. `backlog.ts`: `addToBacklog`, `listBacklog`, `completeItem` (resolveRef → completeBacklog; error string if not found), `pinItem`. `reminders.ts`: `scheduleReminder` (parse `fire_at` ISO → addTrigger; return confirmation). `status.ts`: `setStatus`, `getStatus`. `recipes.ts`: `listRecipes`, `installRecipe`. `council.ts`: `conveneCouncil` — `deliver:"return"` → `await convene(...)` then `renderCouncil(run)`; `deliver:"push"` → `convene(...)` started, return `\`Convening the council on "${q}" — I'll text you the recommendation. (run ${run.id})\`` (in MVP inline runtime the run completes before returning, but the message models the async UX; the pushed copy still fires); `getResult` → getRun → render or `still working`.
- [ ] **tools/index.ts** — `export const TOOL_DEFS` array: `{ name, description, schema (zod), handler }` for all 11 tools (spec §4). This is the single registry the MCP server and demo both consume.
- [ ] **mcp/auth.ts** — `export function authorize(headers: Record<string,string|undefined>): { ok: true; userId: string } | { ok: false; status: number; error: string }`. If `config.mcpAuthEnforce`: require `authorization: Bearer <config.mcpBearerKey>` OR `x-poke-key: <config.mcpBearerKey>`; else allow. `userId = headers["x-poke-user-id"] ?? "local-user"`. (Ported from bridge.)
- [ ] **mcp/server.ts** — `export function buildMcpServer(deps)` using `@modelcontextprotocol/sdk` `McpServer`; register each `TOOL_DEFS` entry with its zod schema; handler calls the tool fn with `deps` + the request's `userId` (threaded from auth). `export async function handleMcpHttp(req, res, deps)` using `StreamableHTTPServerTransport`, gated by `authorize()` (return 401 JSON-RPC error `-32001` on deny — matches bridge).
- [ ] **http/core.ts** — small helpers: read raw body, send JSON, method routing (port the minimal bits from the bridge's `src/http/core.ts`).
- [ ] **test/tools.test.ts** — feature tests through `TOOL_DEFS` handlers on pg-mem + MockModel + MockPokeClient: add/list/complete/pin render correctly; `scheduleReminder` creates a due-able trigger; `set/getStatus`; recipes; `conveneCouncil(return)` renders synthesis; `conveneCouncil(push)` → MockPokeClient.sent grows.
- [ ] **test/mcp-auth.test.ts** — enforce on + no header → `{ok:false,status:401}`; correct Bearer → `{ok:true,userId}`; `x-poke-user-id` flows to `userId`.
- [ ] **test/mcp-server.test.ts** — build server, list tools → all 11 present; invoke `add_to_backlog` via the server's tool-call path → text content contains the item. **Commit**: `feat(mcp): tools registry, auth, MCP server, render`.

---

## Task 7: Vercel functions + local serve

**Files:** Create `api/mcp.ts`, `api/inngest.ts`, `api/healthz.ts`, `src/serve.ts`, `vercel.json`, `inngest.json`.

- [ ] **api/healthz.ts** — `{ ok: true, service: "poke-conduit", ts }`.
- [ ] **api/mcp.ts** — Vercel handler → `handleMcpHttp(req, res, makeDeps())` where `makeDeps()` builds `{ store: await makeStore(), model: makeModel(), poke: makePoke() }`.
- [ ] **api/inngest.ts** — `import { Inngest } from "inngest"; const inngest = new Inngest({ id: "poke-conduit" });`
  - `councilFn`: `inngest.createFunction({ id: "council" }, { event: "conduit/council.requested" }, async ({ event, step }) => runCouncil(deps, step, event.data))` — Inngest's `step` satisfies the `Step` interface.
  - `schedulerFn`: `inngest.createFunction({ id: "scheduler" }, { cron: "* * * * *" }, async ({ step }) => step.run("tick", () => runScheduler(deps, new Date())))`.
  - `export default serve({ client: inngest, functions: [councilFn, schedulerFn] })` (`inngest/vercel`).
- [ ] **serve.ts** — node `http.createServer` routing `GET /healthz`, `POST /mcp` (→ handleMcpHttp), `ALL /api/inngest` (→ inngest serve handler for the local Dev Server). Listen on `config.port`. Log the URL + whether live Claude is on.
- [ ] **vercel.json** — functions for `api/*.ts` (Node runtime), rewrites `/mcp`→`/api/mcp`, `/healthz`→`/api/healthz`, `/api/inngest` passthrough.
- [ ] Run `npm run typecheck` → clean. **Commit**: `feat(api): Vercel mcp/inngest/healthz functions + local serve`.

---

## Task 8: End-to-end demo

**Files:** Create `src/demo.ts`; Test (the demo IS the e2e — it asserts and exits non-zero on failure).

- [ ] **demo.ts** — build `deps` with pg-mem + `makeModel()` (live if `ANTHROPIC_API_KEY`, else Mock) + MockPokeClient. A tiny `assert(label, cond, detail)` that prints `PASS ✓ label` or `FAIL ✗ label — ${detail}` and records failures. Narrate + assert the loop:
  1. `add_to_backlog` ×3 → assert list shows 3.
  2. `pin_item ref=2` → assert item 2 now first.
  3. `complete_item ref=1` → assert open list shows 2.
  4. `convene_council({question, deliver:"return"})` → assert synthesis non-empty; print the rendered council.
  5. `schedule_reminder({text, fire_at: now-1s})` then `runScheduler(deps, new Date())` → assert MockPokeClient.sent contains the reminder text.
  6. `convene_council({deliver:"push"})` → assert a push with the synthesis was captured.
  7. `get_result(run_id)` → assert status done.
  Print final `--- N passed, M failed ---`; `process.exit(M>0?1:0)`. Print the "set ANTHROPIC_API_KEY to run the council live" hint when on Mock.
- [ ] Run `npm run demo` → all PASS, exit 0. Run full `npm test` → green. Run `npm run typecheck` → clean. **Commit**: `feat(demo): narrated end-to-end demo with assertions`.

---

## Task 9: Docs + deploy + final report

**Files:** Create `README.md`, `DEPLOY.md`.

- [ ] **README.md** — what it is (the Poke-brain inversion), architecture diagram, `npm install/test/demo/serve`, the tool surface table, the two-credentials note, what's mocked, link to the spec.
- [ ] **DEPLOY.md** — exact steps from spec §12 (Vercel link/deploy, Neon `DATABASE_URL` reuse with `pc_` prefix, Inngest keys, Poke `mcp add`), each as a copy-paste command.
- [ ] **Commit** docs.
- [ ] **Attempt deploy**: `cd ~/dev/poke-conduit && vercel --version`; if authed, `vercel link`/`vercel deploy` and capture URL; verify `GET /healthz`. If blocked on login/secrets, stop and document the one remaining command. Deploy is **not** a blocker for done.
- [ ] **Final report** to the user: what was built, test/demo output, deploy state, how to point Poke at it.

---

## Self-review

- **Spec coverage:** §3 architecture → Tasks 2–7; §4 tools (11) → Task 6 `TOOL_DEFS` + Task 8 exercises each; §5 agents → Task 5; §6 durability (Step/idempotency/scheduler) → Tasks 4–5 + Task 7 Inngest; §7 two credentials → `authorize` (Task 6) + PokeClient (Task 4); §8 data model → Task 2 `schema.ts`; §10 tests → Tasks 2–8; §11 demo → Task 8; §12 deploy → Task 9. No gaps.
- **Placeholders:** none — interfaces, schema, and key code are inline; model ids are concrete defaults (revisited via claude-api skill in Task 3).
- **Type consistency:** `Store`, `Model`, `Step`, `PokeClient`, `Pov`, `Run` names/signatures are used identically across Tasks 2–8; `resolveRef` (not `getBacklogByRef`), `finishRun→boolean`, `runScheduler(deps, now)`, `runCouncil(deps, step, args)`, `convene(deps, args)`, `TOOL_DEFS` are consistent throughout.
