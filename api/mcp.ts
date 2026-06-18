import { handleMcp, mcpInfoResponse } from "../src/http/core";
import { getRateLimiter, getStore } from "./_store";

// The MCP endpoint Poke calls. Plain Streamable-HTTP JSON-RPC as an edge Web
// handler — no SDK (the surface is tiny and the bridge proved this is exactly
// what Poke's client speaks). Auth enforcement is governed by MCP_AUTH_ENFORCE.
export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  // Only POST drives JSON-RPC and needs the DB. A GET (browser/diagnostic) is
  // answered with server info WITHOUT touching the store, so it can't 500 when
  // no DATABASE_URL is set.
  if (req.method !== "POST") return mcpInfoResponse(req);
  const [store, rateLimiter] = await Promise.all([getStore(), getRateLimiter()]);
  return handleMcp(req, { store, rateLimiter });
}
