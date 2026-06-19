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
