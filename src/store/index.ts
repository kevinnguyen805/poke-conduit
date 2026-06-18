import { config } from "../config";
import { makeNeonStore } from "./pg";
import { makePgMemStore } from "./pgmem";
import type { Store } from "./types";

export type * from "./types";
export { SqlStore } from "./sql";
export { makeNeonStore } from "./pg";
export { makePgMemStore } from "./pgmem";

/**
 * Pick a store from the environment and initialize its schema.
 * DATABASE_URL set → Neon (prod). Empty → pg-mem (tests / offline demo).
 */
export async function makeStore(): Promise<Store> {
  const store = config.databaseUrl
    ? makeNeonStore(config.databaseUrl)
    : await makePgMemStore();
  await store.init();
  return store;
}
