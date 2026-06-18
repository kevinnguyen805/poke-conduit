/**
 * Local HTTP server — the same Web (Request → Response) core the Vercel
 * functions use, wrapped in Node's http so you can run the whole product
 * locally with `npm run serve`. Routes:
 *   POST /mcp      — the JSON-RPC MCP endpoint Poke calls
 *   GET  /cron     — fire due reminders (drive it from any external scheduler)
 *   GET  /healthz  — liveness
 *
 * Unlike serverless, this process is long-lived, so the async-council
 * `background` push runs to completion here (no waitUntil needed).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config";
import { handleCron, handleMcp } from "./http/core";
import { modelMode } from "./model/index";
import { pokeMode } from "./poke/index";
import { makeStore } from "./store/index";
import type { Store } from "./store/types";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function toWebRequest(req: IncomingMessage, body: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  const init: RequestInit = { method: req.method ?? "GET", headers };
  if (req.method !== "GET" && req.method !== "HEAD" && body) init.body = body;
  return new Request(`http://localhost:${config.port}${req.url ?? "/"}`, init);
}

async function writeWebResponse(res: ServerResponse, web: Response): Promise<void> {
  res.statusCode = web.status;
  web.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(await web.text());
}

function health(): Response {
  return new Response(JSON.stringify({ ok: true, service: "poke-conduit", version: "0.1.0" }), {
    headers: { "content-type": "application/json" },
  });
}

async function route(path: string, webReq: Request, store: Store): Promise<Response> {
  if (path === "/mcp") return handleMcp(webReq, { store });
  if (path === "/cron") return handleCron({ store });
  if (path === "/healthz" || path === "/") return health();
  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

async function main(): Promise<void> {
  const store = await makeStore();
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const path = (req.url ?? "/").split("?")[0] ?? "/";
        const webReq = toWebRequest(req, await readBody(req));
        await writeWebResponse(res, await route(path, webReq, store));
      } catch (e) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: String((e as Error)?.message ?? e) }));
      }
    })();
  });

  server.listen(config.port, () => {
    console.log(`poke-conduit listening on http://localhost:${config.port}`);
    console.log(
      `  model=${modelMode()}  poke=${pokeMode()}  db=${config.databaseUrl ? "neon" : "pg-mem (ephemeral)"}`,
    );
    console.log("  POST /mcp   GET /cron   GET /healthz");
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
