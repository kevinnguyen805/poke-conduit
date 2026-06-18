import { config } from "../src/config";
import { SqlRateLimiter, type RateLimiter } from "../src/http/ratelimit";
import { makeNeonSql } from "../src/store/pg";
import { SqlStore } from "../src/store/sql";
import type { Store } from "../src/store/types";

/**
 * One Neon driver per warm instance, shared by the store and the rate limiter —
 * `init()` (idempotent CREATE TABLE IF NOT EXISTS) runs once, then the memoized
 * promise is reused across invocations.
 *
 * Deliberately builds the `Sql` + `SqlStore` directly, NOT via `makeStore()` from
 * the store index: that index statically references `pgmem.ts` (which `import()`s
 * the dev-only `pg-mem`), and we don't want it in the edge bundle. Production is
 * always Neon; pg-mem stays in tests, `npm run serve`, and the demo.
 */
let bootP: Promise<{ store: Store; rateLimiter: RateLimiter }> | undefined;

function boot(): Promise<{ store: Store; rateLimiter: RateLimiter }> {
  if (!bootP) {
    if (!config.databaseUrl) {
      return Promise.reject(new Error("DATABASE_URL is required in production"));
    }
    const sql = makeNeonSql(config.databaseUrl);
    const store = new SqlStore(sql);
    bootP = store.init().then(() => ({ store, rateLimiter: new SqlRateLimiter(sql) }));
  }
  return bootP;
}

export const getStore = (): Promise<Store> => boot().then((b) => b.store);
export const getRateLimiter = (): Promise<RateLimiter> => boot().then((b) => b.rateLimiter);
