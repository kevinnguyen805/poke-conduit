import { describe, expect, it } from "vitest";
import { LocalStep } from "../src/durable/step";
import { MockModel } from "../src/model/mock";
import { MockPokeClient } from "../src/poke/index";
import { makePgMemStore } from "../src/store/pgmem";
import { findTool } from "../src/tools/index";
import type { ToolContext, ToolResult } from "../src/tools/types";

/** A live tool context over pg-mem + mock model + recording Poke, plus a
 *  background that defers (rather than drops) work so async paths are awaitable. */
async function setup() {
  const store = await makePgMemStore();
  await store.init();
  const poke = new MockPokeClient();
  const bg: Promise<void>[] = [];
  const ctx: ToolContext = {
    store,
    model: new MockModel(),
    poke,
    makeStep: () => new LocalStep(),
    userId: "u_test",
    personaModel: "persona-model",
    synthModel: "synth-model",
    background: (_label, fn) => {
      bg.push(fn());
    },
  };
  const call = (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> => {
    const tool = findTool(name);
    if (!tool) throw new Error(`no such tool: ${name}`);
    return tool.handler(args, ctx);
  };
  const drain = (): Promise<unknown> => Promise.all(bg);
  return { store, poke, ctx, call, drain };
}

describe("backlog tools", () => {
  it("adds, lists, pins, and completes items with stable 1-based refs", async () => {
    const { call } = await setup();

    const added = await call("add_note", { text: "first" });
    expect(added.text).toContain("first");
    expect(added.text).toContain("1 open");
    await call("add_note", { text: "second" });

    const list1 = await call("list_backlog", {});
    expect(list1.text).toBe("1. first\n2. second");
    expect(list1.data?.count).toBe(2);

    const pinned = await call("pin_note", { ref: "2" });
    expect(pinned.text).toContain("Pinned");
    expect(pinned.text).toContain("second");

    // Pinning reorders: the pinned item is now ref 1.
    const list2 = await call("list_backlog", {});
    expect(list2.text).toBe("1. 📌 second\n2. first");

    const done = await call("complete_note", { ref: "1" });
    expect(done.text).toContain("second");

    const open = await call("list_backlog", { filter: "open" });
    expect(open.text).toBe("1. first");
  });

  it("reports a miss for an out-of-range ref", async () => {
    const { call } = await setup();
    const res = await call("complete_note", { ref: "99" });
    expect(res.text).toContain("couldn't find");
  });

  it("scopes backlog per user", async () => {
    const { store, ctx } = await setup();
    await findTool("add_note")!.handler({ text: "mine" }, { ...ctx, userId: "u_a" });
    const other = await store.listBacklog("u_b", "open");
    expect(other.length).toBe(0);
  });
});

describe("reminder tools", () => {
  it("sets reminders and lists them soonest-first", async () => {
    const { call } = await setup();
    await call("set_reminder", { text: "later", fire_at: "2026-06-20T10:00:00.000Z" });
    await call("set_reminder", {
      text: "sooner",
      fire_at: "2026-06-19T10:00:00.000Z",
      recurrence: "daily",
    });

    const list = await call("list_reminders", {});
    const lines = list.text.split("\n");
    expect(lines[0]).toContain("sooner");
    expect(lines[0]).toContain("(daily)");
    expect(lines[1]).toContain("later");
    expect(list.data?.count).toBe(2);
  });
});

describe("status tools", () => {
  it("defaults to active, then reflects a set status", async () => {
    const { call } = await setup();
    expect((await call("get_status", {})).text).toContain("active");

    const set = await call("set_status", {
      status: "deep_work",
      note: "release",
      until: "2026-06-18T21:00:00.000Z",
    });
    expect(set.text).toContain("deep work");
    expect(set.text).toContain("release");

    const now = await call("get_status", {});
    expect(now.text).toContain("deep work");
    expect(now.data?.status).toBe("deep_work");
  });
});

describe("recipe tools", () => {
  it("installs and lists recipes", async () => {
    const { call } = await setup();
    expect((await call("list_recipes", {})).text).toBe("No recipes installed yet.");

    const inst = await call("install_recipe", { name: "morning digest", prompt: "summarize overnight" });
    expect(inst.text).toContain("morning digest");

    expect((await call("list_recipes", {})).text).toContain("morning digest");
  });
});

describe("council tools", () => {
  it("deliver=return runs inline and yields a synthesis + finished run", async () => {
    const { call, store } = await setup();
    const res = await call("ask_council", { question: "Should we ship Friday?" });

    expect(res.text).toContain("Council on: Should we ship Friday?");
    expect(res.text).toContain("— the room —");
    expect(res.text).toContain("The Builder");
    expect(res.text).toContain("The User Advocate");

    const runId = res.data?.run_id as string;
    expect(runId).toMatch(/^run_/);
    const run = await store.getRun("u_test", runId);
    expect(run?.status).toBe("done");
  });

  it("deliver=async returns immediately, then pushes the verdict", async () => {
    const { call, store, poke, drain } = await setup();
    const res = await call("ask_council", { question: "Hire now or wait?", deliver: "async" });

    expect(res.text).toContain("convening the council");
    expect(poke.pushes.length).toBe(0); // nothing pushed yet — work is deferred

    await drain();

    expect(poke.pushes.length).toBe(1);
    expect(poke.pushes[0]).toContain("Hire now or wait?");
    const run = await store.getRun("u_test", res.data?.run_id as string);
    expect(run?.status).toBe("done");
  });

  it("council_status reports a finished run and a missing one", async () => {
    const { call, drain } = await setup();
    const queued = await call("ask_council", { question: "Refactor or rewrite?", deliver: "async" });
    await drain();

    const status = await call("council_status", { run_id: queued.data?.run_id as string });
    expect(status.text).toContain("Council on: Refactor or rewrite?");
    expect(status.data?.status).toBe("done");

    const missing = await call("council_status", { run_id: "run_nope" });
    expect(missing.text).toContain("don't have");
  });
});
