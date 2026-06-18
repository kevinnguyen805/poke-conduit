import { handleCron } from "../src/http/core";
import { getStore } from "./_store";

// The scheduler tick. Vercel Cron invokes this on a schedule (see vercel.json);
// it fires every due reminder and pushes it to the user via Poke's inbound API.
// Replaces the originally-planned Inngest scheduler — the council fits Vercel's
// 300s budget, so nothing here needs an external durability runtime.
export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  // Vercel sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set.
  // If configured, reject anything else so the scheduler can't be triggered publicly.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return handleCron({ store: await getStore() });
}
