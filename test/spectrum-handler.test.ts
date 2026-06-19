// test/spectrum-handler.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "../src/http/ratelimit";
import { MockModel } from "../src/model/mock";
import { MockPokeClient } from "../src/poke/index";
import { buildSpectrumDeps } from "../src/spectrum/deps";
import { handleInbound } from "../src/spectrum/handler";
import { tagPayloads } from "../src/spectrum/payloads";
import { MockRouterModel } from "../src/spectrum/router";
import { makePgMemStore } from "../src/store/pgmem";
import type { Store } from "../src/store/types";
import type { MessageLike, RouterModel, SpaceLike, SpectrumDeps } from "../src/spectrum/types";

function fakeSpace(id: string, type: "dm" | "group" = "dm") {
  const sent: any[] = [];
  const space: SpaceLike = { id, type, send: async (c) => { sent.push(c); } };
  return { space, sent };
}
function textMsg(text: string, sender = "+1555") {
  const reacts: string[] = [];
  const msg: MessageLike = {
    content: { type: "text", text },
    sender: { id: sender },
    react: async (r) => { reacts.push(r); },
  };
  return { msg, reacts };
}

async function makeDeps(store: Store, rateMax = 60): Promise<SpectrumDeps> {
  return buildSpectrumDeps({
    store,
    model: new MockModel(),
    poke: new MockPokeClient(),
    router: new MockRouterModel(),
    payloads: tagPayloads,
    rateLimiter: new InMemoryRateLimiter(),
    rateMax,
    rateWindowSec: 60,
  });
}

/** Same wiring as makeDeps but with a custom router (to drive throw / unknown-tool paths). */
async function makeDepsRouter(store: Store, router: RouterModel): Promise<SpectrumDeps> {
  return buildSpectrumDeps({
    store,
    model: new MockModel(),
    poke: new MockPokeClient(),
    router,
    payloads: tagPayloads,
    rateLimiter: new InMemoryRateLimiter(),
    rateMax: 60,
    rateWindowSec: 60,
  });
}

describe("handleInbound", () => {
  let store: Store;
  beforeEach(async () => {
    store = await makePgMemStore();
    await store.init();
  });

  it("runs the routed tool, persists the space + both turns, and replies with text", async () => {
    const deps = await makeDeps(store);
    const { space, sent } = fakeSpace("guid-1");
    const { msg } = textMsg("save the spectrum launch checklist");
    await handleInbound(deps, space, msg);

    const open = await store.listBacklog("spectrum:+1555", "open");
    expect(open.length).toBe(1);
    expect(sent[0]).toMatchObject({ kind: "text" });
    expect(String(sent[0].text)).toContain("backlog");

    expect((await store.getSpectrumSpace("spectrum:+1555"))?.space_id).toBe("guid-1");
    const turns = await store.recentSpectrumTurns("spectrum:+1555", 10);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("reacts with a tapback when completing a note", async () => {
    const deps = await makeDeps(store);
    await store.addBacklog({ user_id: "spectrum:+1555", text: "finish me" });
    const { space, sent } = fakeSpace("guid-1");
    const { msg, reacts } = textMsg("mark 1 done");
    await handleInbound(deps, space, msg);

    expect(reacts).toContain("👍");
    expect((await store.listBacklog("spectrum:+1555", "done")).length).toBe(1);
    expect(String(sent[0].text)).toContain("Done");
  });

  it("renders a native poll when the user asks to prioritize", async () => {
    const deps = await makeDeps(store);
    await store.addBacklog({ user_id: "spectrum:+1555", text: "task A" });
    await store.addBacklog({ user_id: "spectrum:+1555", text: "task B" });
    const { space, sent } = fakeSpace("guid-1");
    const { msg } = textMsg("which should I do first?");
    await handleInbound(deps, space, msg);

    expect(sent[0]).toMatchObject({ kind: "poll" });
    expect(sent[0].options).toEqual(["task A", "task B"]);
  });

  it("replies conversationally on out-of-domain text (the product surface)", async () => {
    const deps = await makeDeps(store);
    const { space, sent } = fakeSpace("guid-1");
    const { msg } = textMsg("how's your day going");
    await handleInbound(deps, space, msg);
    expect(sent[0]).toMatchObject({ kind: "text" });
    expect(String(sent[0].text).length).toBeGreaterThan(0);
  });

  it("ignores group messages in Phase A", async () => {
    const deps = await makeDeps(store);
    const { space, sent } = fakeSpace("group-1", "group");
    const { msg } = textMsg("save this");
    await handleInbound(deps, space, msg);
    expect(sent.length).toBe(0);
  });

  it("ignores messages with no resolvable sender", async () => {
    const deps = await makeDeps(store);
    const { space, sent } = fakeSpace("guid-1");
    const msg: MessageLike = { content: { type: "text", text: "hi" }, sender: undefined, react: async () => {} };
    await handleInbound(deps, space, msg);
    expect(sent.length).toBe(0);
  });

  it("throttles past the rate ceiling with a gentle message", async () => {
    const deps = await makeDeps(store, 1); // max 1/window
    const { space, sent } = fakeSpace("guid-1");
    await handleInbound(deps, space, textMsg("save one").msg);
    await handleInbound(deps, space, textMsg("save two").msg);
    expect(String(sent[1].text).toLowerCase()).toContain("one sec");
    // only the first message created a backlog item
    expect((await store.listBacklog("spectrum:+1555", "open")).length).toBe(1);
  });

  it("pins the chosen item when a poll vote arrives", async () => {
    const deps = await makeDeps(store);
    await store.addBacklog({ user_id: "spectrum:+1555", text: "task A" });
    await store.addBacklog({ user_id: "spectrum:+1555", text: "task B" });
    const { space, sent } = fakeSpace("guid-1");
    const voteMsg: MessageLike = {
      content: { type: "poll_option", option: "task B" },
      sender: { id: "+1555" },
      react: async () => {},
    };
    await handleInbound(deps, space, voteMsg);

    const pinned = await store.listBacklog("spectrum:+1555", "pinned");
    expect(pinned.map((i) => i.text)).toContain("task B");
    expect(String(sent[0].text)).toContain("task B");
  });

  it("pins a long (ellipsized) item when its own poll option is voted", async () => {
    const deps = await makeDeps(store);
    const long = "x".repeat(100); // earliest created_at → first poll option
    await store.addBacklog({ user_id: "spectrum:+1555", text: long });
    await store.addBacklog({ user_id: "spectrum:+1555", text: "short one" });
    const { space, sent } = fakeSpace("guid-1");

    // 1) ask to prioritize → native poll; grab the (ellipsized) option the tool produced
    await handleInbound(deps, space, textMsg("which should I do first?").msg);
    expect(sent[0]).toMatchObject({ kind: "poll" });
    const option = sent[0].options[0];
    expect(option).toBe(`${"x".repeat(79)}…`); // prioritizeTool ellipsizes >80 chars

    // 2) vote that exact option → the FULL-length item must get pinned (regression: it used to miss)
    const voteMsg: MessageLike = {
      content: { type: "poll_option", option },
      sender: { id: "+1555" },
      react: async () => {},
    };
    await handleInbound(deps, space, voteMsg);
    const pinned = await store.listBacklog("spectrum:+1555", "pinned");
    expect(pinned.map((i) => i.text)).toContain(long);
  });

  it("replies gracefully (no throw) when the router names a tool that doesn't exist", async () => {
    const router: RouterModel = {
      decide: async () => ({ kind: "tool", name: "nonexistent_tool", arguments: {} }),
    };
    const deps = await makeDepsRouter(store, router);
    const { space, sent } = fakeSpace("guid-1");
    await handleInbound(deps, space, textMsg("do the impossible").msg);
    expect(sent[0]).toMatchObject({ kind: "text" });
    expect(String(sent[0].text)).toContain("blanked"); // the unknown-tool fallback line
  });

  it("never goes silent and keeps turns paired when the router throws", async () => {
    const router: RouterModel = {
      decide: async () => {
        throw new Error("anthropic down");
      },
    };
    const deps = await makeDepsRouter(store, router);
    const { space, sent } = fakeSpace("guid-1");
    await handleInbound(deps, space, textMsg("save this").msg);

    // graceful reply, not silence
    expect(sent[0]).toMatchObject({ kind: "text" });
    expect(String(sent[0].text).length).toBeGreaterThan(0);
    // the user turn is NOT orphaned — an assistant turn is still recorded
    const turns = await store.recentSpectrumTurns("spectrum:+1555", 10);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });
});
