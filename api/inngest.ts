import { getInngestServeHandler } from "../src/durable/inngest";
import { getStore } from "./_store";

// OPTIONAL durable-async endpoint. Inngest calls back here to introspect and run
// the council function. Until `inngest` is installed AND `INNGEST_EVENT_KEY` is
// set, `getInngestServeHandler` returns null and this answers 404 — the inert
// default. Async council then runs via the in-process inline fallback.
export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const serve = await getInngestServeHandler(getStore);
  if (!serve) {
    return new Response(JSON.stringify({ error: "inngest not configured" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  return serve(req);
}
