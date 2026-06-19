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

  it("caps the poll at 4 options and ellipsizes item text longer than 80 chars", async () => {
    const store = await makePgMemStore();
    await store.init();
    const ctx = await ctxFor(store, "u");
    // Inserted first → earliest created_at → first in the "open" order (all unpinned).
    await store.addBacklog({ user_id: "u", text: "x".repeat(100) });
    for (let i = 0; i < 4; i++) await store.addBacklog({ user_id: "u", text: `item ${i}` });

    const res = await prioritizeTool.handler({}, ctx);
    const poll = (res.data as { poll?: { options: string[] } }).poll;
    expect(poll?.options.length).toBe(4); // capped even though 5 items are open
    expect(poll?.options[0]).toBe(`${"x".repeat(79)}…`); // long text truncated to 79 + ellipsis (80 total)
  });
});
