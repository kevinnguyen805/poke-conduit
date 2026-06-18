import { SqlStore } from "./sql";
import type { Sql, Store } from "./types";

/**
 * In-memory Postgres (pg-mem) store for unit tests and the offline demo.
 * Dynamic import keeps the dev-only `pg-mem` dependency out of the production
 * bundle's static graph — in prod DATABASE_URL is set and this is never called.
 */
export async function makePgMemStore(): Promise<Store> {
  const { newDb } = await import("pg-mem");
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const sql: Sql = (text, params = []) => pool.query(text, params);
  return new SqlStore(sql);
}
