// src/spectrum/deps.ts
import { config } from "../config";
import { InMemoryRateLimiter, type RateLimiter } from "../http/ratelimit";
import type { Model } from "../model/types";
import type { PokeClient } from "../poke/index";
import type { Store } from "../store/types";
import { makeSpectrumToolContext } from "./context";
import { SPECTRUM_TOOLS } from "./tools";
import type { RouterModel, SpectrumDeps, SpectrumPayloads } from "./types";

/**
 * SDK-free assembly of everything handleInbound needs. Kept apart from app.ts so
 * its test never imports spectrum-ts. The boot (app.ts) calls this with the
 * SDK-backed payloads + a SpectrumDelivery.
 */
export function buildSpectrumDeps(opts: {
  store: Store;
  model: Model;
  poke: PokeClient;
  router: RouterModel;
  payloads: SpectrumPayloads;
  rateLimiter?: RateLimiter;
  rateMax: number;
  rateWindowSec: number;
}): SpectrumDeps {
  return {
    store: opts.store,
    tools: SPECTRUM_TOOLS,
    makeToolContext: makeSpectrumToolContext({
      store: opts.store,
      model: opts.model,
      poke: opts.poke,
      personaModel: config.personaModel,
      synthModel: config.synthModel,
    }),
    router: opts.router,
    payloads: opts.payloads,
    rateLimiter: opts.rateLimiter ?? new InMemoryRateLimiter(),
    rateMax: opts.rateMax,
    rateWindowSec: opts.rateWindowSec,
  };
}
