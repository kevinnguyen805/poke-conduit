/**
 * The durability seam. Council/orchestration logic is written against `Step`
 * once and runs under either implementation:
 *   - LocalStep  → tests + offline demo (in-process, memoized)
 *   - Inngest    → prod (Inngest's `step.run` provides real durability/retries)
 *
 * Both honor the same contract: a step identified by `id` runs at most once;
 * a replay (or a concurrent call with the same id) returns the first result.
 */
export interface Step {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * In-process durable step. Memoizes the *promise* per id, so concurrent calls
 * with the same id share one execution — idempotent under both replay and
 * concurrency, mirroring Inngest's step semantics closely enough to test
 * council logic without the Inngest runtime.
 */
export class LocalStep implements Step {
  private memo = new Map<string, Promise<unknown>>();

  run<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.memo.get(id);
    if (existing) return existing as Promise<T>;
    const p = fn();
    this.memo.set(id, p);
    return p;
  }
}

/**
 * Adapt Inngest's step object (passed into an Inngest function handler) to the
 * `Step` port. Kept dependency-free here — the inngest function supplies the
 * object; we only need its `run(id, fn)` method.
 */
export function fromInngestStep(step: {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}): Step {
  return { run: (id, fn) => step.run(id, fn) };
}
