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
import type { RateLimiter } from "./ratelimit";

/**
 * Web-standard (Request → Response) core, reused verbatim by the Vercel
 * functions and the local Node server. Holds the request plumbing (method
 * routing, SSE negotiation, auth) so neither entry point repeats it.
 */
export interface CoreDeps {
  store: Store;
  model?: Model;
  poke?: PokeClient;
  /** Throttle POST /mcp. Omit to disable (tests/demo that don't exercise it). */
  rateLimiter?: RateLimiter;
  /** Run work after responding (async council). Defaults to fire-and-forget. */
  background?: ToolContext["background"];
  /** Durable async-council dispatcher (Inngest). Omit → inline best-effort. */
  dispatchAsyncCouncil?: ToolContext["dispatchAsyncCouncil"];
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
    dispatchAsyncCouncil: deps.dispatchAsyncCouncil,
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

/** Client IP for rate-limit keying (Vercel sets x-forwarded-for at the edge). */
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

/**
 * The non-POST branches of the MCP endpoint, isolated so an edge entry point can
 * answer a GET probe WITHOUT constructing a Store. In production a browser hit to
 * /mcp has no database to reach — eagerly building the store there is exactly why
 * a bare GET used to return 500. GET now yields friendly server info instead.
 */
export function mcpInfoResponse(req: Request): Response {
  if (req.method === "GET") {
    if (wantsSse(req)) return new Response("No server-initiated stream", { status: 405 });
    return json({
      ...SERVER_INFO,
      status: "ok",
      transport: "Streamable HTTP — POST JSON-RPC 2.0 to this URL.",
      docs: "/",
    });
  }
  return json({ error: "method not allowed" }, 405);
}

/** The MCP endpoint: GET → server info, POST → JSON-RPC. */
export async function handleMcp(req: Request, deps: CoreDeps): Promise<Response> {
  if (req.method !== "POST") return mcpInfoResponse(req);

  // Auth is header-only — resolve it up front: it keys the rate limiter, then
  // is handed to the dispatcher.
  const auth = extractAuth((n) => req.headers.get(n));

  // Fixed-window throttle BEFORE parsing the body, so a flood pays the cheapest
  // possible price. Keyed per Poke user when one is injected, else per client IP.
  if (deps.rateLimiter) {
    const who = auth.hasUserId ? `u:${auth.userId}` : `ip:${clientIp(req)}`;
    const { allowed } = await deps.rateLimiter.hit(
      `mcp:${who}`,
      config.mcpRateMax,
      config.mcpRateWindowSec,
    );
    if (!allowed) {
      return json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32029, message: "Rate limit exceeded — slow down and retry shortly." },
        },
        429,
      );
    }
  }

  let msg: any;
  try {
    msg = await req.json();
  } catch {
    return rpcResponse(req, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }

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
