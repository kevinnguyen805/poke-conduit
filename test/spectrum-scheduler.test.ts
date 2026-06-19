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
    expect(poke.calls[0]!.instruction).toBe("stand up and stretch"); // not "Send me a reminder…"
    expect(poke.calls[0]!.opts).toEqual({ userId: "spectrum:+1555", kind: "reminder" });
  });

  it("defaults to the Poke instruction phrasing when no phrase is supplied", async () => {
    await store.addTrigger({ user_id: "u1", text: "buy milk", fire_at: "2026-06-19T09:00:00.000Z" });
    const poke = new CapturingClient();
    await runScheduler(store, poke, "2026-06-19T10:00:00.000Z");
    expect(poke.calls[0]!.instruction).toBe("Send me a reminder now that says: buy milk");
    // Opts must flow on the default/legacy path too, not only when a custom phrase
    // is injected. kind is "reminder" because the store defaults it (addTrigger: ?? "reminder").
    expect(poke.calls[0]!.opts).toEqual({ userId: "u1", kind: "reminder" });
  });
});
