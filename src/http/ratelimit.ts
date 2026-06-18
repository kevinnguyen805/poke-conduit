import type { Sql } from "../store/types";

/**
 * Fixed-window rate limiter. Async so a Postgres-backed impl drops in unchanged
 * (the same port shape `poke-amb-bridge` uses). Two implementations:
 *   - InMemoryRateLimiter — per-instance Map, for tests / `serve` / the demo.
 *   - SqlRateLimiter      — shared across serverless instances via Postgres.
 * Wiring picks one by environment; `handleMcp` only sees the interface.
 */
export interface RateLimiter {
  /** Count one hit on `key`. `allowed` is false once the window exceeds `max`. */
  hit(key: string, max: number, windowSec: number): Promise<{ allowed: boolean; count: number }>;
}

/** The current fixed-window bucket index for a clock + window size. */
function bucketOf(nowMs: number, windowSec: number): number {
  return Math.floor(nowMs / 1000 / windowSec);
}

/** Process-local limiter. Fine for a single long-lived server; resets on restart. */
export class InMemoryRateLimiter implements RateLimiter {
  private m = new Map<string, { windowStart: number; count: number }>();

  constructor(private nowMs: () => number = () => Date.now()) {}

  async hit(key: string, max: number, windowSec: number): Promise<{ allowed: boolean; count: number }> {
    const bucket = bucketOf(this.nowMs(), windowSec);
    const cur = this.m.get(key);
    if (!cur || cur.windowStart !== bucket) {
      this.m.set(key, { windowStart: bucket, count: 1 });
      return { allowed: 1 <= max, count: 1 };
    }
    cur.count += 1;
    return { allowed: cur.count <= max, count: cur.count };
  }
}

/**
 * Postgres-backed limiter over the same `Sql` driver the store uses, so it works
 * on pg-mem and Neon alike and survives across stateless serverless invocations.
 * One atomic upsert per hit: increment within the current bucket, reset on a new
 * one. Requires the `pc_rate_limits` table (created by `applySchema`).
 */
export class SqlRateLimiter implements RateLimiter {
  constructor(
    private sql: Sql,
    private nowMs: () => number = () => Date.now(),
  ) {}

  async hit(key: string, max: number, windowSec: number): Promise<{ allowed: boolean; count: number }> {
    const bucket = bucketOf(this.nowMs(), windowSec);
    const r = await this.sql(
      `INSERT INTO pc_rate_limits (key, window_start, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN pc_rate_limits.window_start = EXCLUDED.window_start
                      THEN pc_rate_limits.count + 1 ELSE 1 END,
         window_start = EXCLUDED.window_start
       RETURNING count`,
      [key, bucket],
    );
    const count = Number(r.rows[0]?.count ?? 1);
    return { allowed: count <= max, count };
  }
}
