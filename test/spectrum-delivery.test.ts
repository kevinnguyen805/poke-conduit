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

  it("reports ok:false (does not throw) when the live space's send rejects", async () => {
    await store.upsertSpectrumSpace({ user_id: "u", space_id: "guid-1" });
    const throwingSpace: SpaceLike = {
      id: "guid-1",
      type: "dm",
      send: async () => {
        throw new Error("network down");
      },
    };
    const delivery = new SpectrumDelivery({ store, resolveSpace: () => throwingSpace, payloads: tagPayloads });
    const res = await delivery.push("ping", { userId: "u", kind: "reminder" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
  });
});
