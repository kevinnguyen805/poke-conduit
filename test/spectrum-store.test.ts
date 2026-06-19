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
    expect(recent[0]!.text).toBe("m3"); // oldest of the last 10
    expect(recent[9]!.text).toBe("m12"); // newest
    expect(recent[9]!.role).toBe("assistant");
  });

  it("scopes turns by user", async () => {
    await store.appendSpectrumTurn({ user_id: U, space_id: S, role: "user", text: "mine" });
    await store.appendSpectrumTurn({ user_id: "spectrum:other", space_id: "x", role: "user", text: "theirs" });
    const recent = await store.recentSpectrumTurns(U, 10);
    expect(recent.map((t) => t.text)).toEqual(["mine"]);
  });
});
