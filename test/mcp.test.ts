import { describe, expect, it } from "vitest";
import { handleMcp, type CoreDeps } from "../src/http/core";
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
  it("GET returns server info", async () => {
    const res = await handleMcp(new Request("http://localhost/mcp", { method: "GET" }), await deps());
    const body = await readJson(res);
    expect(body.name).toBe("poke-conduit");
    expect(body.status).toBe("ok");
  });

  it("initialize advertises serverInfo and onboarding instructions", async () => {
    const res = await handleMcp(post(rpc("initialize", { protocolVersion: "2025-06-18" })), await deps());
    const body = await readJson(res);
    expect(body.result.serverInfo.name).toBe("poke-conduit");
    expect(body.result.instructions).toContain("council");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("tools/list returns the full 12-tool surface", async () => {
    const res = await handleMcp(post(rpc("tools/list")), await deps());
    const body = await readJson(res);
    const names: string[] = body.result.tools.map((t: { name: string }) => t.name);
    expect(names.length).toBe(12);
    for (const n of ["add_note", "list_backlog", "ask_council", "set_reminder", "set_status", "install_recipe"]) {
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
