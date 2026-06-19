// src/spectrum/delivery.ts
import type { PokeClient, PushResult } from "../poke/index";
import type { Store } from "../store/types";
import type { SpaceLike, SpectrumPayloads } from "./types";

/**
 * OUTBOUND for the standalone agent: conduit → the user's own iMessage line.
 * Implements the same PokeClient seam the scheduler/tools call, but instead of
 * phrasing a message as an instruction to a second assistant, it sends the
 * VERBATIM text to the right person via `space.send`.
 *
 * Multi-tenant: every push must name a userId. We look up that user's chat GUID
 * and resolve it to a live Space. `resolveSpace` returns undefined for a space
 * this process hasn't heard from yet (cold cross-process delivery is Phase-B —
 * it needs the SDK's space-get; see app.ts).
 */
export class SpectrumDelivery implements PokeClient {
  constructor(
    private deps: {
      store: Store;
      resolveSpace: (spaceId: string) => SpaceLike | undefined;
      payloads: SpectrumPayloads;
    },
  ) {}

  async push(instruction: string, opts?: { userId?: string; kind?: string }): Promise<PushResult> {
    const userId = opts?.userId;
    if (!userId) return { ok: false, status: 0 };

    const mapping = await this.deps.store.getSpectrumSpace(userId);
    if (!mapping) return { ok: false, status: 0 };

    const space = this.deps.resolveSpace(mapping.space_id);
    if (!space) return { ok: false, status: 0 };

    const content =
      opts?.kind === "reminder"
        ? this.deps.payloads.effect(instruction, "spotlight")
        : this.deps.payloads.text(instruction);
    // Report a failed send as ok:false (same as HttpPokeClient does for a non-2xx),
    // never throw: the scheduler fires due triggers in a loop with no try/catch, so a
    // throw here would block every OTHER tenant's reminders in the same batch.
    try {
      await space.send(content);
    } catch {
      return { ok: false, status: 0 };
    }
    return { ok: true, status: 200 };
  }
}
