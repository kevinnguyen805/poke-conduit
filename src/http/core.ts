import { config } from "../config";
import { LocalStep } from "../durable/step";
import { extractAuth } from "../mcp/auth";
import { handleRpc, SERVER_INFO, type RpcDeps } from "../mcp/server";
import { makeModel } from "../model/index";
import type { Model } from "../model/types";
import { makePokeClient, type PokeClient } from "../poke/index";
import { runScheduler } from "../scheduler";
import type { Store } from "../store/types";
import type { ToolContext } from "../tools/types";

/**
 * Web-standard (Request → Response) core, reused verbatim by the Vercel
 * functions and the local Node server. Holds the request plumbing (method
 * routing, SSE negotiation, auth) so neither entry point repeats it.
 */
export interface CoreDeps {
  store: Store;
  model?: Model;
  poke?: PokeClient;
  /** Run work after responding (async council). Defaults to fire-and-forget. */
  background?: ToolContext["background"];
  /** Override config.mcpAuthEnforce (tests/local). */
  enforceAuth?: boolean;
  /** Supply the wall-clock for the scheduler (tests pass a fixed value). */
  now?: () => string;
}

function defaultBackground(label: string, fn: () => Promise<void>): void {
  void fn().catch((e) => console.error(`[bg ${label}]`, e));
}

function makeToolContextFactory(deps: CoreDeps): (userId: string) => ToolContext {
  const model = deps.model ?? makeModel();
  const poke = deps.poke ?? makePokeClient();
  const background = deps.background ?? defaultBackground;
  return (userId) => ({
    store: deps.store,
    model,
    poke,
    makeStep: () => new LocalStep(),
    userId,
    personaModel: config.personaModel,
    synthModel: config.synthModel,
    background,
  });
}

function wantsSse(req: Request): boolean {
  return (req.headers.get("accept") ?? "").includes("text/event-stream");
}
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
/** MCP Streamable HTTP: deliver the JSON-RPC result as one SSE event when the client asks for it. */
function rpcResponse(req: Request, payload: unknown): Response {
  if (!wantsSse(req)) return json(payload);
  return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}

/** The MCP endpoint: GET → server info, POST → JSON-RPC. */
export async function handleMcp(req: Request, deps: CoreDeps): Promise<Response> {
  if (req.method === "GET") {
    if (wantsSse(req)) return new Response("No server-initiated stream", { status: 405 });
    return json({ ...SERVER_INFO, status: "ok" });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let msg: any;
  try {
    msg = await req.json();
  } catch {
    return rpcResponse(req, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }

  const auth = extractAuth((n) => req.headers.get(n));
  const rpcDeps: RpcDeps = { makeToolContext: makeToolContextFactory(deps) };
  if (deps.enforceAuth !== undefined) rpcDeps.enforceAuth = deps.enforceAuth;

  const payload = await handleRpc(msg, auth, rpcDeps);
  if (payload === null) return new Response(null, { status: 202 });
  return rpcResponse(req, payload);
}

/** The scheduler endpoint (Vercel Cron / manual): fire all due triggers. */
export async function handleCron(deps: CoreDeps): Promise<Response> {
  const poke = deps.poke ?? makePokeClient();
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const result = await runScheduler(deps.store, poke, now);
  return json({ ok: true, now, fired: result.fired });
}
