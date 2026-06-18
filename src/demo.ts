/**
 * Narrated end-to-end demo. Drives the product through the SAME wire path Poke
 * uses — JSON-RPC over handleMcp(Request) → Response — against an in-memory
 * store, so it's hermetic and repeatable. Every scene asserts; the run exits
 * non-zero if any assertion fails (so it doubles as a smoke test in CI).
 *
 *   npm run demo
 *
 * Model: real Claude when ANTHROPIC_API_KEY is set (the council genuinely
 * deliberates), else the deterministic MockModel. Poke is ALWAYS mocked here —
 * the demo never sends a real message.
 */
import { config } from "./config";
import { handleCron, handleMcp, type CoreDeps } from "./http/core";
import { makeModel, modelMode } from "./model/index";
import { MockPokeClient } from "./poke/index";
import { makePgMemStore } from "./store/pgmem";

// ---- tiny narration + assertion harness ----
const BAR = "─".repeat(64);
let passed = 0;
let failed = 0;

function scene(title: string): void {
  console.log(`\n${BAR}\n  ${title}\n${BAR}`);
}
function say(line: string): void {
  console.log(line);
}
/** What Poke would relay to the user, indented so it reads as a chat bubble. */
function user(text: string): void {
  console.log(text.split("\n").map((l) => `    │ ${l}`).join("\n"));
}
function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗ FAIL:"} ${label}`);
  if (ok) passed++;
  else failed++;
}

// ---- shared in-process wiring (one store, one mock Poke, deferred background) ----
const poke = new MockPokeClient();
const background: Promise<void>[] = [];
let deps: CoreDeps;
let rpcId = 0;

function drainBackground(): Promise<unknown> {
  return Promise.all(background);
}

interface ToolReply {
  text: string;
  data?: Record<string, unknown>;
}

/** Call a tool over the real MCP wire and return its user-facing text + data. */
async function callTool(name: string, args: Record<string, unknown>, userId = "demo-user"): Promise<ToolReply> {
  const req = new Request("http://demo/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-poke-user-id": userId },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const res = await handleMcp(req, deps);
  const body = (await res.json()) as any;
  if (body.error) throw new Error(`${name} → ${body.error.code} ${body.error.message}`);
  return { text: body.result.content[0].text, data: body.result.structuredContent };
}

async function rpc(method: string, params?: unknown): Promise<any> {
  const req = new Request("http://demo/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, ...(params !== undefined ? { params } : {}) }),
  });
  return (await (await handleMcp(req, deps)).json()) as any;
}

async function main(): Promise<void> {
  const store = await makePgMemStore();
  await store.init();
  deps = { store, model: makeModel(), poke, background: (_label, fn) => background.push(fn()) };

  scene("poke-conduit — the durable brain Poke consults");
  const live = modelMode() === "claude";
  say(`  model:  ${live ? "claude (live)" : "mock (deterministic, offline)"}`);
  say(`  store:  pg-mem (in-memory, ephemeral)`);
  say(`  poke:   mock (no real messages are sent)`);
  if (!live) {
    say("");
    say("  Council is running on the mock model. To see it deliberate with real");
    say("  Claude, set a key and re-run:");
    say("      export ANTHROPIC_API_KEY=sk-ant-...");
    say("      npm run demo");
  }

  // ---- handshake ----
  scene("1 · Handshake (what Poke sees on connect)");
  const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
  check("initialize returns serverInfo", init.result?.serverInfo?.name === "poke-conduit");
  check("onboarding instructions are advertised", typeof init.result?.instructions === "string");
  const tools = (await rpc("tools/list")).result.tools as { name: string }[];
  say(`  tools exposed: ${tools.map((t) => t.name).join(", ")}`);
  check("12 tools listed", tools.length === 12);

  // ---- backlog (flagship) ----
  scene("2 · Queued-notes backlog");
  say('  user: "save the durable-execution paper to read later"');
  user((await callTool("add_note", { text: "read the durable-execution paper", tags: "reading" })).text);
  await callTool("add_note", { text: "try Inngest vs Temporal for the scheduler" });
  await callTool("add_note", { text: "call the dentist" });

  say('\n  user: "what\'s on my list?"');
  const list1 = await callTool("list_backlog", {});
  user(list1.text);
  check("backlog has 3 open items", list1.data?.count === 3);

  say('\n  user: "pin the dentist one"');
  user((await callTool("pin_note", { ref: "3" })).text);
  const list2 = await callTool("list_backlog", {});
  user(list2.text);
  check("pinned item floats to ref 1 with a 📌", list2.text.startsWith("1. 📌 call the dentist"));

  say('\n  user: "done with the dentist call"');
  user((await callTool("complete_note", { ref: "1" })).text);
  const list3 = await callTool("list_backlog", {});
  check("2 open items remain after completing one", list3.data?.count === 2);

  // ---- council (the wow) ----
  scene("3 · Council — multi-agent deliberation (deliver=return)");
  say('  user: "should we ship the MVP Friday or take another week to harden it?"');
  if (live) say("  (convening Builder · Skeptic · Operator · User-Advocate, then synthesizing…)");
  const verdict = await callTool("ask_council", {
    question: "Ship the MVP Friday, or take another week to harden it?",
  });
  user(verdict.text);
  check("synthesis names the question", verdict.text.includes("Ship the MVP Friday"));
  check("the room shows all four panelists", ["The Builder", "The Skeptic", "The Operator", "The User Advocate"].every((n) => verdict.text.includes(n)));
  const runId = verdict.data?.run_id as string;
  check("run id returned", typeof runId === "string" && runId.startsWith("run_"));

  scene("4 · Council — async delivery (returns now, pushes later)");
  say('  user: "convene the council on whether to adopt a usage-based pricing model — get back to me"');
  const before = poke.pushes.length;
  const queued = await callTool("ask_council", {
    question: "Should we move to usage-based pricing?",
    deliver: "async",
  });
  user(queued.text);
  check("returns immediately (nothing pushed yet)", poke.pushes.length === before);
  say("  …deliberating in the background…");
  await drainBackground();
  check("verdict was pushed to the user via Poke", poke.pushes.length === before + 1);
  if (poke.pushes.length > before) {
    say("\n  Poke proactively messages the user:");
    user(poke.pushes[poke.pushes.length - 1] ?? "");
  }
  const statusReply = await callTool("council_status", { run_id: queued.data?.run_id as string });
  check("council_status reports the finished run", statusReply.data?.status === "done");

  // ---- reminders + scheduler (durability differentiator) ----
  scene("5 · Proactive reminders + the scheduler tick");
  say('  user: "remind me to review the on-call runbook every morning"');
  user((await callTool("set_reminder", { text: "review the on-call runbook", fire_at: "2020-01-01T09:00:00.000Z", recurrence: "daily" })).text);
  say('  user: "and remind me about the board sync next week"');
  user((await callTool("set_reminder", { text: "board sync prep", fire_at: "2999-01-01T17:00:00.000Z" })).text);

  const reminders = await callTool("list_reminders", {});
  say("\n  upcoming reminders:");
  user(reminders.text);
  check("two reminders pending", reminders.data?.count === 2);

  say("\n  [Vercel Cron hits /api/cron] — fire everything due now:");
  const pushesBeforeCron = poke.pushes.length;
  const cron = await handleCron(deps);
  const fired = ((await cron.json()) as any).fired as { text: string }[];
  say(`  scheduler fired ${fired.length} trigger(s): ${fired.map((f) => `"${f.text}"`).join(", ")}`);
  check("the past-due daily reminder fired", fired.some((f) => f.text === "review the on-call runbook"));
  check("the future reminder did NOT fire", !fired.some((f) => f.text === "board sync prep"));
  check("firing pushed a proactive message", poke.pushes.length === pushesBeforeCron + 1);
  check("daily reminder re-armed (still pending)", (await callTool("list_reminders", {})).text.includes("review the on-call runbook"));

  // ---- status / DND ----
  scene("6 · Availability / focus");
  user((await callTool("get_status", {})).text);
  say('\n  user: "I\'m heading into a deep work block until 5pm"');
  user((await callTool("set_status", { status: "deep_work", note: "shipping the release", until: "2026-06-18T17:00:00.000Z" })).text);
  const st = await callTool("get_status", {});
  check("status now reflects deep work", st.data?.status === "deep_work");

  // ---- recipes ----
  scene("7 · Saved recipes");
  user((await callTool("list_recipes", {})).text);
  say('\n  user: "save a recipe called \'morning brief\' that summarizes my overnight saves"');
  user((await callTool("install_recipe", { name: "morning brief", prompt: "Summarize everything I saved overnight." })).text);
  const recipes = await callTool("list_recipes", {});
  user(recipes.text);
  check("the new recipe is listed", recipes.text.includes("morning brief"));

  // ---- tally ----
  scene("Result");
  say(`  ${passed} passed · ${failed} failed`);
  if (failed > 0) {
    say("  DEMO FAILED");
    process.exit(1);
  }
  say("  All scenes passed. poke-conduit is working end-to-end.");
  if (!config.databaseUrl) say("  (ran on pg-mem — set DATABASE_URL to run against Neon)");
}

main().catch((e) => {
  console.error("\nDEMO ERROR:", e);
  process.exit(1);
});
