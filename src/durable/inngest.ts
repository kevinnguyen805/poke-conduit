/**
 * OPTIONAL durability provider. The async council is written once against the
 * `Step` seam (see step.ts); this module is the prod adapter that runs it on
 * Inngest for true serverless durability (survives function freezes, retries
 * per step). It is the ONLY module that touches Inngest, and it is imported
 * solely by the `api/` entry points — never by core, serve, demo, or tests —
 * so Inngest never loads outside production.
 *
 * `inngest` is deliberately NOT a dependency. It's loaded through a non-literal
 * specifier so `tsc` types the import as `any` (no install needed to typecheck/
 * CI), and Node resolves it at runtime only when actually enabled. Absent the
 * package, every entry point here degrades to `null`/`false` and the caller
 * falls back to the in-process inline path. To enable: `npm install inngest`
 * and set `INNGEST_EVENT_KEY` (+ `INNGEST_SIGNING_KEY`).
 */
import { runAndDeliverCouncil } from "../agents/orchestrator";
import { makeModel } from "../model/index";
import { makePokeClient } from "../poke/index";
import type { Store } from "../store/types";
import type { AsyncCouncilJob } from "../tools/types";
import { fromInngestStep } from "./step";

/** The event the async council is dispatched on / the Inngest function triggers from. */
export const COUNCIL_EVENT = "poke-conduit/council.requested";

// Non-literal specifiers: tsc declines to resolve these (typed `any`), so the
// build needs no installed package; Node resolves them at runtime.
const INNGEST_PKG: string = "inngest";
const INNGEST_EDGE_PKG: string = "inngest/edge";

type StepLike = { run<T>(id: string, fn: () => Promise<T>): Promise<T> };

interface InngestClient {
  send(payload: { name: string; data: unknown }): Promise<unknown>;
  createFunction(
    cfg: { id: string; name?: string },
    trigger: { event: string },
    handler: (ctx: { event: { data: unknown }; step: StepLike }) => Promise<unknown>,
  ): unknown;
}
interface InngestModule {
  Inngest: new (opts: { id: string }) => InngestClient;
}
interface EdgeModule {
  serve(opts: {
    client: unknown;
    functions: unknown[];
  }): (req: Request) => Promise<Response>;
}

/** True only when an Inngest event key is configured. Checked before any import. */
export function isInngestConfigured(): boolean {
  return !!process.env.INNGEST_EVENT_KEY;
}

let cachedClient: InngestClient | null = null;

/** Lazily construct the Inngest client, or null if unconfigured / not installed. */
async function getClient(): Promise<InngestClient | null> {
  if (!isInngestConfigured()) return null;
  if (cachedClient) return cachedClient;
  try {
    const mod = (await import(INNGEST_PKG)) as InngestModule;
    cachedClient = new mod.Inngest({ id: "poke-conduit" });
    return cachedClient;
  } catch (e) {
    console.error("[inngest] package not installed; using inline council", e);
    return null;
  }
}

/**
 * Hand a council job to Inngest. Returns true iff Inngest took ownership of the
 * run; false (fast, no import) when unconfigured, or on any send failure — the
 * caller then runs the job in-process via `background`. Safe to wire
 * unconditionally in prod: it no-ops until `INNGEST_EVENT_KEY` is set.
 */
export async function dispatchCouncilViaInngest(job: AsyncCouncilJob): Promise<boolean> {
  const client = await getClient();
  if (!client) return false;
  try {
    await client.send({ name: COUNCIL_EVENT, data: job });
    return true;
  } catch (e) {
    console.error("[inngest] send failed; falling back to inline", e);
    return false;
  }
}

/**
 * Build the Inngest HTTP serve handler (the function registry Inngest calls back
 * into), or null if Inngest is unavailable. The council function rebuilds its
 * own deps from env (store, model, poke) and runs the SAME `runAndDeliverCouncil`
 * executor the inline path uses, only over Inngest's durable `step`.
 */
export async function getInngestServeHandler(
  getStore: () => Promise<Store>,
): Promise<((req: Request) => Promise<Response>) | null> {
  const client = await getClient();
  if (!client) return null;
  try {
    const edge = (await import(INNGEST_EDGE_PKG)) as EdgeModule;
    const councilFn = client.createFunction(
      { id: "council-run", name: "Async council run" },
      { event: COUNCIL_EVENT },
      async ({ event, step }) => {
        const job = event.data as AsyncCouncilJob;
        const store = await getStore();
        await runAndDeliverCouncil(
          { store, step: fromInngestStep(step), model: makeModel(), poke: makePokeClient() },
          job,
        );
        return { runId: job.runId };
      },
    );
    return edge.serve({ client, functions: [councilFn] });
  } catch (e) {
    console.error("[inngest] serve unavailable; durable async disabled", e);
    return null;
  }
}
