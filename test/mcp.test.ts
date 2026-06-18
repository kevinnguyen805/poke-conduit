import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { handleMcp, mcpInfoResponse, type CoreDeps } from "../src/http/core";
import type { RateLimiter } from "../src/http/ratelimit";
import { MockModel } from "../src/model/mock";
import { MockPokeClient } from "../src/poke/index";
import { makePgMemStore } from "../src/store/pgmem";

async function deps(over: Partial<CoreDeps> = {}): Promise<CoreDeps> {
  const store = await makePgMemStore();
  await store.init();
  return { store, model: new MockModel(), poke: new MockPokeClient(), ...over };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Parse a JSON-RPC response body. `Response.json()` is typed `unknown` here
 *  (undici types via @vercel/node), so funnel reads through one cast. */
function readJson(res: Response): Promise<any> {
  return res.json() as Promise<any>;
}

const rpc = (method: string, params?: unknown, id: unknown = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params !== undefined ? { params } : {}),
});

describe("handleMcp — lifecycle", () => {
  it("GET returns server info with a transport hint and docs pointer", async () => {
    const res = await handleMcp(new Request("http://localhost/mcp", { method: "GET" }), await deps());
    const body = await readJson(res);
    expect(body.name).toBe("poke-conduit");
    expect(body.status).toBe("ok");
    expect(body.transport).toContain("POST");
    expect(body.docs).toBe("/");
  });

  it("mcpInfoResponse answers a GET without a Store (prod GET probe → no 500) and 405s other non-POST", async () => {
    // No deps/store passed — the whole point of the helper: a bare GET in prod
    // (no DATABASE_URL) must not construct a store.
    const get = mcpInfoResponse(new Request("http://localhost/mcp", { method: "GET" }));
    expect(get.status).toBe(200);
    expect((await readJson(get)).status).toBe("ok");
    const put = mcpInfoResponse(new Request("http://localhost/mcp", { method: "PUT" }));
    expect(put.status).toBe(405);
  });

  it("initialize advertises serverInfo and onboarding instructions", async () => {
    const res = await handleMcp(post(rpc("initialize", { protocolVersion: "2025-06-18" })), await deps());
    const body = await readJson(res);
    expect(body.result.serverInfo.name).toBe("poke-conduit");
    expect(body.result.instructions).toContain("council");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("tools/list returns the full 13-tool surface", async () => {
    const res = await handleMcp(post(rpc("tools/list")), await deps());
    const body = await readJson(res);
    const names: string[] = body.result.tools.map((t: { name: string }) => t.name);
    expect(names.length).toBe(13);
    for (const n of ["add_note", "list_backlog", "ask_council", "set_reminder", "set_status", "install_recipe", "run_recipe"]) {
      expect(names).toContain(n);
    }
  });

  it("ping returns an empty result", async () => {
    const res = await handleMcp(post(rpc("ping")), await deps());
    expect((await readJson(res)).result).toEqual({});
  });

  it("notifications answer 202 with no body", async () => {
    const res = await handleMcp(post(rpc("notifications/initialized", undefined, undefined)), await deps());
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });
});

describe("handleMcp — tools/call", () => {
  it("round-trips add_note and persists under the injected user id", async () => {
    const d = await deps();
    const res = await handleMcp(
      post(rpc("tools/call", { name: "add_note", arguments: { text: "buy milk" } }), { "x-poke-user-id": "u_9" }),
      d,
    );
    const body = await readJson(res);
    expect(body.result.content[0].text).toContain("buy milk");

    const items = await d.store.listBacklog("u_9", "open");
    expect(items.length).toBe(1);
    expect(items[0]?.text).toBe("buy milk");
  });

  it("runs ask_council end-to-end (deliver=return)", async () => {
    const res = await handleMcp(
      post(rpc("tools/call", { name: "ask_council", arguments: { question: "Refactor or rewrite?" } }), {
        "x-poke-user-id": "u_c",
      }),
      await deps(),
    );
    const body = await readJson(res);
    expect(body.result.content[0].text).toContain("Refactor or rewrite?");
    expect(body.result.structuredContent.run_id).toMatch(/^run_/);
  });

  it("rejects unknown tools and bad arguments with -32602", async () => {
    const unknown = await handleMcp(post(rpc("tools/call", { name: "nope", arguments: {} })), await deps());
    expect((await readJson(unknown)).error.code).toBe(-32602);

    const badArgs = await handleMcp(
      post(rpc("tools/call", { name: "add_note", arguments: {} }), { "x-poke-user-id": "u_1" }),
      await deps(),
    );
    const body = await readJson(badArgs);
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain("Invalid arguments");
  });
});

describe("handleMcp — auth gate", () => {
  it("blocks a fully-anonymous call with -32001 when enforcing", async () => {
    const res = await handleMcp(
      post(rpc("tools/call", { name: "add_note", arguments: { text: "x" } })),
      await deps({ enforceAuth: true }),
    );
    const body = await readJson(res);
    expect(body.error.code).toBe(-32001);
  });

  it("admits a Poke-injected uid even when enforcing", async () => {
    const res = await handleMcp(
      post(rpc("tools/call", { name: "add_note", arguments: { text: "ok" } }), { "x-poke-user-id": "u_5" }),
      await deps({ enforceAuth: true }),
    );
    const body = await readJson(res);
    expect(body.result.content[0].text).toContain("ok");
  });
});

describe("handleMcp — transport", () => {
  it("frames the result as one SSE event when the client accepts it", async () => {
    const res = await handleMcp(post(rpc("ping"), { accept: "text/event-stream" }), await deps());
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text.startsWith("event: message\ndata: ")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(true);
    const data = JSON.parse(text.slice("event: message\ndata: ".length).trimEnd());
    expect(data.result).toEqual({});
  });

  it("returns -32700 on a malformed JSON body", async () => {
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const body = await readJson(await handleMcp(req, await deps()));
    expect(body.error.code).toBe(-32700);
  });

  it("returns -32601 for an unknown method", async () => {
    const body = await readJson(await handleMcp(post(rpc("does/not/exist")), await deps()));
    expect(body.error.code).toBe(-32601);
  });
});

describe("handleMcp — rate limit", () => {
  /** A limiter we fully control: allow the first `cap` hits, then block. */
  function cappedLimiter(cap: number, seen?: Array<{ key: string; max: number; windowSec: number }>): RateLimiter {
    let n = 0;
    return {
      async hit(key, max, windowSec) {
        seen?.push({ key, max, windowSec });
        n += 1;
        return { allowed: n <= cap, count: n };
      },
    };
  }

  it("returns 429 with a JSON-RPC error once the limiter blocks", async () => {
    const d = await deps({ rateLimiter: cappedLimiter(2) });
    expect((await handleMcp(post(rpc("ping")), d)).status).toBe(200);
    expect((await handleMcp(post(rpc("ping")), d)).status).toBe(200);
    const blocked = await handleMcp(post(rpc("ping")), d);
    expect(blocked.status).toBe(429);
    const body = await readJson(blocked);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.code).toBe(-32029);
    expect(body.error.message).toContain("Rate limit");
  });

  it("keys by Poke user id when present, else first-hop client IP, with configured limits", async () => {
    const seen: Array<{ key: string; max: number; windowSec: number }> = [];
    const d = await deps({ rateLimiter: cappedLimiter(99, seen) });
    await handleMcp(post(rpc("ping"), { "x-poke-user-id": "u_42" }), d);
    await handleMcp(post(rpc("ping"), { "x-forwarded-for": "9.9.9.9, 1.1.1.1" }), d);
    expect(seen[0]?.key).toBe("mcp:u:u_42");
    expect(seen[1]?.key).toBe("mcp:ip:9.9.9.9");
    expect(seen[0]?.max).toBe(config.mcpRateMax);
    expect(seen[0]?.windowSec).toBe(config.mcpRateWindowSec);
  });

  it("does not rate-limit GET (server info needs no throttle)", async () => {
    let hits = 0;
    const rateLimiter: RateLimiter = {
      async hit() {
        hits += 1;
        return { allowed: false, count: 1 };
      },
    };
    const res = await handleMcp(new Request("http://localhost/mcp", { method: "GET" }), await deps({ rateLimiter }));
    expect(res.status).toBe(200); // not 429
    expect(hits).toBe(0); // limiter never consulted for GET
  });
});
