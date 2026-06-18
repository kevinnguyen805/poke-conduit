import { config } from "../src/config";
import { makeNeonStore } from "../src/store/pg";
import type { Store } from "../src/store/types";

/**
 * One Neon store per warm instance — `init()` (idempotent CREATE TABLE IF NOT
 * EXISTS) runs once, then the memoized promise is reused across invocations.
 *
 * Deliberately imports `makeNeonStore` directly, NOT `makeStore()` from the
 * store index: the index statically references `pgmem.ts` (which `import()`s
 * the dev-only `pg-mem`), and we don't want that in the edge bundle. Production
 * is always Neon; pg-mem stays in tests, `npm run serve`, and the demo.
 */
let storeP: Promise<Store> | undefined;

export function getStore(): Promise<Store> {
  if (!storeP) {
    if (!config.databaseUrl) {
      return Promise.reject(new Error("DATABASE_URL is required in production"));
    }
    const store = makeNeonStore(config.databaseUrl);
    storeP = store.init().then(() => store);
  }
  return storeP;
}
