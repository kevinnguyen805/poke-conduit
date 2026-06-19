// src/spectrum/app.ts
import { Spectrum } from "spectrum-ts";
import { poll as sdkPoll, text as sdkText } from "spectrum-ts";
import { effect as sdkEffect, imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { config } from "../config";
import { makeModel } from "../model/index";
import { runScheduler } from "../scheduler";
import { makeStore } from "../store/index";
import type { Trigger } from "../store/types";
import { SpectrumDelivery } from "./delivery";
import { buildSpectrumDeps } from "./deps";
import { handleInbound } from "./handler";
import { makeRouterModel } from "./router";
import type { MessageLike, SpaceLike, SpectrumPayloads } from "./types";

/** Real, SDK-backed content factory (the prod counterpart of tagPayloads). */
export const realPayloads: SpectrumPayloads = {
  text: (s) => sdkText(s),
  effect: (s, e) => {
    const table = imessage.effect.message as Record<string, unknown>;
    return sdkEffect(s, (table[e] ?? table["sparkles"]) as never);
  },
  poll: (title, options) => sdkPoll(title, options),
};

/** Proactive reminders are sent verbatim (with an effect via SpectrumDelivery), not as Poke instructions. */
function humanPhrase(t: Trigger): string {
  return t.kind === "resurface" ? `Resurfacing a note you saved: ${t.text}` : t.text;
}

/**
 * Boot the agent's own iMessage line and run forever. The only file that imports
 * the SDK. BOTH providers need a real Spectrum Cloud project: `Spectrum()`
 * validates SPECTRUM_PROJECT_ID/SECRET against Cloud at construction regardless
 * of provider (verified on spectrum-ts@5.0.0 — empty creds → ZodError, fake creds
 * → SpectrumCloudError 422). `terminal` only swaps the message SOURCE to stdin
 * (a local driven-demo harness once creds are set); `imessage` binds the real line.
 *
 * Proactive delivery uses an in-process live-space map: any space we've heard
 * from is sendable, so a reminder set during a session is delivered by this same
 * long-lived process. Cold cross-process delivery (resolve a stored GUID we
 * haven't seen) is Phase-B and needs the SDK's space-get.
 */
export async function runSpectrum(opts?: { provider?: "imessage" | "terminal" }): Promise<void> {
  const store = await makeStore();
  const liveSpaces = new Map<string, SpaceLike>();

  const delivery = new SpectrumDelivery({
    store,
    resolveSpace: (spaceId) => liveSpaces.get(spaceId),
    payloads: realPayloads,
  });
  const deps = buildSpectrumDeps({
    store,
    model: makeModel(),
    poke: delivery,
    router: makeRouterModel(),
    payloads: realPayloads,
    rateMax: config.mcpRateMax,
    rateWindowSec: config.mcpRateWindowSec,
  });

  const providerName = opts?.provider ?? "imessage";
  const provider = providerName === "terminal" ? terminal.config() : imessage.config();
  const app = await Spectrum({
    projectId: config.spectrumProjectId,
    projectSecret: config.spectrumProjectSecret,
    providers: [provider],
  });

  // Minute-resolution scheduler tick — fires due reminders to their owner's live space.
  const tick = setInterval(() => {
    void runScheduler(store, delivery, new Date().toISOString(), humanPhrase).catch((e) =>
      console.error("[spectrum] scheduler tick failed", e),
    );
  }, 60_000);

  console.log(`[spectrum] agent live on provider '${providerName}' — texting back.`);
  try {
    for await (const [space, message] of app.messages) {
      // The single SDK boundary: the real Space/Message structurally satisfy our *Like views.
      const s = space as unknown as SpaceLike;
      liveSpaces.set(s.id, s);
      // NOTE: responding() is on app, not space — signature: app.responding(space, fn)
      await app.responding(space, () =>
        handleInbound(deps, s, message as unknown as MessageLike),
      );
    }
  } finally {
    clearInterval(tick);
  }
}
