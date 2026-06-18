import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpPokeClient, MockPokeClient, makePokeClient } from "../src/poke/index";
import { nextDaily, proactiveInstruction, runScheduler } from "../src/scheduler";
import { makePgMemStore } from "../src/store/pgmem";
import type { Store } from "../src/store/types";

const U = "user_abc";

let store: Store;
let poke: MockPokeClient;
beforeEach(async () => {
  store = await makePgMemStore();
  await store.init();
  poke = new MockPokeClient();
});

describe("runScheduler", () => {
  it("does nothing when no trigger is due", async () => {
    await store.addTrigger({ user_id: U, text: "later", fire_at: "2026-06-18T20:00:00.000Z" });
    const res = await runScheduler(store, poke, "2026-06-18T09:00:00.000Z");
    expect(res.fired).toEqual([]);
    expect(poke.pushes).toEqual([]);
  });

  it("fires a one-shot trigger, pushes once, and consumes it", async () => {
    await store.addTrigger({ user_id: U, text: "standup", fire_at: "2026-06-18T08:00:00.000Z" });
    const res = await runScheduler(store, poke, "2026-06-18T09:00:00.000Z");

    expect(res.fired.map((f) => f.text)).toEqual(["standup"]);
    expect(res.fired[0]?.pushed).toBe(true);
    expect(poke.pushes.length).toBe(1);
    expect(poke.pushes[0]).toContain("standup");

    // Consumed: a second pass at a later time fires nothing.
    const again = await runScheduler(store, poke, "2026-06-18T10:00:00.000Z");
    expect(again.fired).toEqual([]);
    expect(poke.pushes.length).toBe(1);
  });

  it("re-arms a daily trigger to the next day and fires it again", async () => {
    await store.addTrigger({
      user_id: U,
      text: "vitamins",
      fire_at: "2026-06-18T08:00:00.000Z",
      recurrence: "daily",
    });

    const day1 = await runScheduler(store, poke, "2026-06-18T09:00:00.000Z");
    expect(day1.fired.length).toBe(1);

    // Same day, later: already re-armed to tomorrow, so nothing more fires.
    const sameDay = await runScheduler(store, poke, "2026-06-18T23:00:00.000Z");
    expect(sameDay.fired).toEqual([]);

    // Next day: fires again.
    const day2 = await runScheduler(store, poke, "2026-06-19T09:00:00.000Z");
    expect(day2.fired.map((f) => f.text)).toEqual(["vitamins"]);
    expect(poke.pushes.length).toBe(2);
  });

  it("fires multiple due triggers in fire order", async () => {
    await store.addTrigger({ user_id: U, text: "B", fire_at: "2026-06-18T08:30:00.000Z" });
    await store.addTrigger({ user_id: U, text: "A", fire_at: "2026-06-18T08:00:00.000Z" });
    const res = await runScheduler(store, poke, "2026-06-18T09:00:00.000Z");
    expect(res.fired.map((f) => f.text)).toEqual(["A", "B"]);
  });
});

describe("nextDaily", () => {
  it("advances strictly past now, even across many missed days", () => {
    // fire_at is 5 days before now → should land on the first occurrence after now.
    const next = nextDaily("2026-06-13T08:00:00.000Z", "2026-06-18T09:00:00.000Z");
    expect(next).toBe("2026-06-19T08:00:00.000Z");
  });

  it("returns the very next day when now is just past fire_at", () => {
    expect(nextDaily("2026-06-18T08:00:00.000Z", "2026-06-18T08:00:01.000Z")).toBe(
      "2026-06-19T08:00:00.000Z",
    );
  });
});

describe("proactiveInstruction", () => {
  it("phrases reminders and resurfaces as instructions to Poke", () => {
    const reminder = proactiveInstruction({
      id: "t1",
      user_id: U,
      kind: "reminder",
      text: "call the dentist",
      fire_at: "x",
      recurrence: "none",
      status: "pending",
      created_at: "x",
    });
    expect(reminder).toContain("call the dentist");
    expect(reminder.toLowerCase()).toContain("reminder");

    const resurface = proactiveInstruction({
      id: "t2",
      user_id: U,
      kind: "resurface",
      text: "that article on durable execution",
      fire_at: "x",
      recurrence: "none",
      status: "pending",
      created_at: "x",
    });
    expect(resurface.toLowerCase()).toContain("resurface");
  });
});

describe("PokeClient", () => {
  it("MockPokeClient records pushes and reports ok", async () => {
    const m = new MockPokeClient();
    const r = await m.push("hello");
    expect(r).toEqual({ ok: true, status: 200 });
    expect(m.pushes).toEqual(["hello"]);
  });

  it("makePokeClient returns a usable client", async () => {
    const c = makePokeClient();
    expect(typeof c.push).toBe("function");
  });

  describe("HttpPokeClient (fetch stubbed)", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("POSTs the instruction with a Bearer key to the inbound URL", async () => {
      const calls: { url: string; init: any }[] = [];
      vi.stubGlobal("fetch", async (url: string, init: any) => {
        calls.push({ url, init });
        return { ok: true, status: 200 } as Response;
      });

      const client = new HttpPokeClient("pk_test_123", "https://poke.com/api/v1/inbound/api-message");
      const res = await client.push("Send me a reminder now that says: ship it");

      expect(res).toEqual({ ok: true, status: 200 });
      expect(calls.length).toBe(1);
      expect(calls[0]?.url).toBe("https://poke.com/api/v1/inbound/api-message");
      expect(calls[0]?.init.method).toBe("POST");
      expect(calls[0]?.init.headers.authorization).toBe("Bearer pk_test_123");
      expect(JSON.parse(calls[0]?.init.body)).toEqual({
        message: "Send me a reminder now that says: ship it",
      });
    });

    it("propagates a non-ok status", async () => {
      vi.stubGlobal("fetch", async () => ({ ok: false, status: 429 }) as Response);
      const client = new HttpPokeClient("pk", "https://poke.com/x");
      expect(await client.push("x")).toEqual({ ok: false, status: 429 });
    });
  });
});
