// src/spectrum/context.ts
import { LocalStep } from "../durable/step";
import type { Model } from "../model/types";
import type { PokeClient } from "../poke/index";
import type { Store } from "../store/types";
import type { ToolContext } from "../tools/types";

export interface SpectrumContextDeps {
  store: Store;
  model: Model;
  poke: PokeClient;
  personaModel: string;
  synthModel: string;
}

/**
 * Build the per-user ToolContext the existing tool handlers expect. Mirrors the
 * MCP server's wiring (src/http/core.ts) but with `poke` = SpectrumDelivery and
 * a fire-and-forget `background`. Phase-A omits dispatchAsyncCouncil (council is
 * not on the Spectrum line yet).
 */
export function makeSpectrumToolContext(deps: SpectrumContextDeps): (userId: string) => ToolContext {
  return (userId: string) => ({
    store: deps.store,
    model: deps.model,
    makeStep: () => new LocalStep(),
    poke: deps.poke,
    userId,
    personaModel: deps.personaModel,
    synthModel: deps.synthModel,
    // Fire-and-forget, but log failures with the label the same way the MCP
    // server's defaultBackground does (src/http/core.ts) — a swallowed council
    // push on the Spectrum line would otherwise vanish with no trace. The
    // `spectrum:` prefix disambiguates from the MCP surface when both run.
    background: (label, fn) => {
      void fn().catch((e) => console.error(`[spectrum:bg ${label}]`, e));
    },
  });
}
