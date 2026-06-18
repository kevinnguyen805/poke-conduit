import { neon } from "@neondatabase/serverless";
import { SqlStore } from "./sql";
import type { Sql, Store } from "./types";

/**
 * Neon serverless (stateless HTTP) store for production. No persistent
 * connection to go stale across serverless invocations — same lesson the
 * poke-amb-bridge learned. `fullResults` gives us `{ rows, rowCount }`.
 */
export function makeNeonStore(dbUrl: string): Store {
  const client = neon(dbUrl, { fullResults: true });
  const run = client as unknown as (
    q: string,
    params: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number | null }>;
  const sql: Sql = async (text, params = []) => {
    const r = await run(text, params as unknown[]);
    return { rows: r.rows as any[], rowCount: r.rowCount ?? r.rows.length };
  };
  return new SqlStore(sql);
}
