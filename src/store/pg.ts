import { neon } from "@neondatabase/serverless";
import { SqlStore } from "./sql";
import type { Sql, Store } from "./types";

/**
 * Neon serverless (stateless HTTP) `Sql` driver for production. No persistent
 * connection to go stale across serverless invocations — same lesson the
 * poke-amb-bridge learned. `fullResults` gives us `{ rows, rowCount }`.
 *
 * Exposed on its own so the store and the rate limiter can share ONE driver
 * (and thus one Neon client) per warm instance.
 */
export function makeNeonSql(dbUrl: string): Sql {
  const client = neon(dbUrl, { fullResults: true });
  const run = client as unknown as (
    q: string,
    params: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number | null }>;
  return async (text, params = []) => {
    const r = await run(text, params as unknown[]);
    return { rows: r.rows as any[], rowCount: r.rowCount ?? r.rows.length };
  };
}

export function makeNeonStore(dbUrl: string): Store {
  return new SqlStore(makeNeonSql(dbUrl));
}
