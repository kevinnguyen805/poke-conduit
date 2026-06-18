import { handleMcp } from "../src/http/core";
import { getStore } from "./_store";

// The MCP endpoint Poke calls. Plain Streamable-HTTP JSON-RPC as an edge Web
// handler — no SDK (the surface is tiny and the bridge proved this is exactly
// what Poke's client speaks). Auth enforcement is governed by MCP_AUTH_ENFORCE.
export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  return handleMcp(req, { store: await getStore() });
}
