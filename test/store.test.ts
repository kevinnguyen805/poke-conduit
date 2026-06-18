import { beforeEach, describe, expect, it } from "vitest";
import { makePgMemStore } from "../src/store/pgmem";
import type { Store } from "../src/store/types";

const U = "user_abc";
const OTHER = "user_xyz";

let store: Store;
beforeEach(async () => {
  store = await makePgMemStore();
  await store.init();
});

describe("backlog", () => {
  it("adds items and lists them open in insertion order", async () => {
    await store.addBacklog({ user_id: U, text: "first" });
    await store.addBacklog({ user_id: U, text: "second" });
    await store.addBacklog({ user_id: U, text: "third" });

    const open = await store.listBacklog(U, "open");
    expect(open.map((i) => i.text)).toEqual(["first", "second", "third"]);
    expect(open.every((i) => i.status === "open" && i.pinned === false)).toBe(true);
  });

  it("scopes lists by user", async () => {
    await store.addBacklog({ user_id: U, text: "mine" });
    await store.addBacklog({ user_id: OTHER, text: "theirs" });
    expect((await store.listBacklog(U, "open")).map((i) => i.text)).toEqual(["mine"]);
    expect((await store.listBacklog(OTHER, "open")).map((i) => i.text)).toEqual(["theirs"]);
  });

  it("floats pinned items to the top of the open list", async () => {
    await store.addBacklog({ user_id: U, text: "a" });
    const b = await store.addBacklog({ user_id: U, text: "b" });
    await store.addBacklog({ user_id: U, text: "c" });

    await store.pinBacklog(U, b.id, true);
    const open = await store.listBacklog(U, "open");
    expect(open[0]?.text).toBe("b");
    expect(open[0]?.pinned).toBe(true);
    expect((await store.listBacklog(U, "pinned")).map((i) => i.text)).toEqual(["b"]);
  });

  it("completing an item moves it from open to done", async () => {
    const a = await store.addBacklog({ user_id: U, text: "a" });
    await store.addBacklog({ user_id: U, text: "b" });

    const done = await store.completeBacklog(U, a.id);
    expect(done?.status).toBe("done");
    expect(done?.completed_at).toBeTruthy();

    expect((await store.listBacklog(U, "open")).map((i) => i.text)).toEqual(["b"]);
    expect((await store.listBacklog(U, "done")).map((i) => i.text)).toEqual(["a"]);
  });

  it("resolveRef handles 1-based index, stable id, and misses", async () => {
    const a = await store.addBacklog({ user_id: U, text: "a" });
    await store.addBacklog({ user_id: U, text: "b" });

    expect((await store.resolveRef(U, 1))?.id).toBe(a.id);
    expect((await store.resolveRef(U, "2"))?.text).toBe("b"); // numeric string → index
    expect((await store.resolveRef(U, a.id))?.text).toBe("a"); // stable id
    expect(await store.resolveRef(U, 99)).toBeNull(); // out of range
    expect(await store.resolveRef(U, "bk_nope")).toBeNull(); // unknown id
    expect(await store.resolveRef(OTHER, a.id)).toBeNull(); // wrong owner
  });

  it("cannot complete another user's item", async () => {
    const a = await store.addBacklog({ user_id: U, text: "a" });
    expect(await store.completeBacklog(OTHER, a.id)).toBeNull();
    expect((await store.listBacklog(U, "open")).length).toBe(1);
  });
});

describe("recipes", () => {
  it("installs and lists recipes per user", async () => {
    await store.installRecipe({ user_id: U, name: "Morning Brief", prompt: "summarize inbox" });
    await store.installRecipe({ user_id: U, name: "EOD", enabled: false });
    const recipes = await store.listRecipes(U);
    expect(recipes.map((r) => r.name)).toEqual(["Morning Brief", "EOD"]);
    expect(recipes[0]?.enabled).toBe(true);
    expect(recipes[1]?.enabled).toBe(false);
    expect(await store.listRecipes(OTHER)).toEqual([]);
  });
});

describe("status", () => {
  it("defaults to active when unset", async () => {
    const s = await store.getStatus(U);
    expect(s.status).toBe("active");
    expect(s.note).toBe("");
  });

  it("upserts in place rather than duplicating", async () => {
    await store.setStatus({ user_id: U, status: "dnd", note: "heads-down" });
    let s = await store.getStatus(U);
    expect(s.status).toBe("dnd");
    expect(s.note).toBe("heads-down");

    await store.setStatus({ user_id: U, status: "deep_work", until: "2026-06-18T21:00:00.000Z" });
    s = await store.getStatus(U);
    expect(s.status).toBe("deep_work");
    expect(s.until).toBe("2026-06-18T21:00:00.000Z");
    expect(s.note).toBe(""); // overwritten, not merged
  });
});

describe("triggers", () => {
  it("returns only pending triggers whose fire_at <= now, in fire order", async () => {
    await store.addTrigger({ user_id: U, text: "early", fire_at: "2026-06-18T08:00:00.000Z" });
    await store.addTrigger({ user_id: U, text: "late", fire_at: "2026-06-18T20:00:00.000Z" });

    const due = await store.dueTriggers("2026-06-18T09:00:00.000Z");
    expect(due.map((t) => t.text)).toEqual(["early"]);

    const allDue = await store.dueTriggers("2026-06-18T23:00:00.000Z");
    expect(allDue.map((t) => t.text)).toEqual(["early", "late"]);
  });

  it("markTriggerFired without rearm removes it from the due set", async () => {
    const t = await store.addTrigger({ user_id: U, text: "once", fire_at: "2026-06-18T08:00:00.000Z" });
    await store.markTriggerFired(t.id);
    expect(await store.dueTriggers("2026-06-18T09:00:00.000Z")).toEqual([]);
  });

  it("markTriggerFired with rearm keeps it pending at the new fire_at", async () => {
    const t = await store.addTrigger({
      user_id: U,
      text: "daily",
      fire_at: "2026-06-18T08:00:00.000Z",
      recurrence: "daily",
    });
    await store.markTriggerFired(t.id, "2026-06-19T08:00:00.000Z");

    // Not due at original time anymore...
    expect(await store.dueTriggers("2026-06-18T09:00:00.000Z")).toEqual([]);
    // ...but due again the next day.
    const next = await store.dueTriggers("2026-06-19T09:00:00.000Z");
    expect(next.map((t) => t.text)).toEqual(["daily"]);
  });
});

describe("runs (idempotent finalize)", () => {
  it("createRun → getRun shows a running record", async () => {
    await store.createRun({ id: "run_1", user_id: U, kind: "council", input: '{"q":"hi"}' });
    const r = await store.getRun(U, "run_1");
    expect(r?.status).toBe("running");
    expect(r?.input).toBe('{"q":"hi"}');
    expect(r?.finished_at).toBeNull();
  });

  it("finishRun transitions running→done exactly once (CAS idempotency)", async () => {
    await store.createRun({ id: "run_2", user_id: U, kind: "council", input: "{}" });

    const first = await store.finishRun("run_2", '{"answer":"42"}');
    const second = await store.finishRun("run_2", '{"answer":"different"}');
    expect(first).toBe(true); // only the winning call flips the row
    expect(second).toBe(false);

    const r = await store.getRun(U, "run_2");
    expect(r?.status).toBe("done");
    expect(r?.output).toBe('{"answer":"42"}'); // losing call did not overwrite
    expect(r?.finished_at).toBeTruthy();
  });

  it("errorRun marks a run errored", async () => {
    await store.createRun({ id: "run_3", user_id: U, kind: "council", input: "{}" });
    await store.errorRun("run_3", '{"error":"boom"}');
    const r = await store.getRun(U, "run_3");
    expect(r?.status).toBe("error");
    expect(r?.output).toBe('{"error":"boom"}');
  });

  it("getRun is scoped to the owner", async () => {
    await store.createRun({ id: "run_4", user_id: U, kind: "council", input: "{}" });
    expect(await store.getRun(OTHER, "run_4")).toBeNull();
  });
});
