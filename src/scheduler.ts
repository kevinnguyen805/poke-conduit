import type { PokeClient } from "./poke/index";
import type { Store, Trigger } from "./store/types";

const DAY_MS = 86_400_000;

/** Phrase a trigger as an instruction Poke will act on (not verbatim text). */
export function proactiveInstruction(t: Trigger): string {
  if (t.kind === "resurface") {
    return `Resurface this saved note to me now if it's still useful: ${t.text}`;
  }
  return `Send me a reminder now that says: ${t.text}`;
}

/** Next daily occurrence strictly after `now`, so a missed tick fires once (no catch-up burst). */
export function nextDaily(fireAt: string, now: string): string {
  let next = new Date(fireAt).getTime();
  const nowMs = new Date(now).getTime();
  while (next <= nowMs) next += DAY_MS;
  return new Date(next).toISOString();
}

export interface FiredTrigger {
  id: string;
  text: string;
  pushed: boolean;
}
export interface SchedulerResult {
  fired: FiredTrigger[];
}

/**
 * Fire every trigger due as of `now` (ISO): push to Poke, then either re-arm
 * (daily → next future occurrence) or mark fired (one-shot). Returns what fired.
 * Pure of wall-clock: the caller supplies `now` (the cron passes the real time).
 */
export async function runScheduler(
  store: Store,
  poke: PokeClient,
  now: string,
): Promise<SchedulerResult> {
  const due = await store.dueTriggers(now);
  const fired: FiredTrigger[] = [];
  for (const t of due) {
    const res = await poke.push(proactiveInstruction(t));
    if (t.recurrence === "daily") {
      await store.markTriggerFired(t.id, nextDaily(t.fire_at, now));
    } else {
      await store.markTriggerFired(t.id);
    }
    fired.push({ id: t.id, text: t.text, pushed: res.ok });
  }
  return { fired };
}
