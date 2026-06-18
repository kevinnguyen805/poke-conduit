import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter, SqlRateLimiter } from "../src/http/ratelimit";
import { applySchema } from "../src/store/schema";
import type { Sql } from "../src/store/types";

/** A pg-mem Sql with the schema applied — exercises the real upsert. */
async function pgMemSql(): Promise<Sql> {
  const { newDb } = await import("pg-mem");
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const sql: Sql = (text, params = []) => pool.query(text, params);
  await applySchema(sql);
  return sql;
}

describe("InMemoryRateLimiter", () => {
  it("allows up to max within a window, then blocks the overflow", async () => {
    const rl = new InMemoryRateLimiter(() => 1_000_000); // frozen clock → one window
    expect((await rl.hit("k", 3, 60)).allowed).toBe(true); // 1
    expect((await rl.hit("k", 3, 60)).allowed).toBe(true); // 2
    expect((await rl.hit("k", 3, 60)).allowed).toBe(true); // 3
    const over = await rl.hit("k", 3, 60); // 4
    expect(over.allowed).toBe(false);
    expect(over.count).toBe(4);
  });

  it("resets when the window advances", async () => {
    let t = 0;
    const rl = new InMemoryRateLimiter(() => t);
    expect((await rl.hit("k", 1, 60)).allowed).toBe(true); // window 0
    expect((await rl.hit("k", 1, 60)).allowed).toBe(false); // window 0, over
    t = 60_000; // advance one full window
    expect((await rl.hit("k", 1, 60)).allowed).toBe(true); // window 1, fresh
  });

  it("tracks each key independently", async () => {
    const rl = new InMemoryRateLimiter(() => 0);
    expect((await rl.hit("a", 1, 60)).allowed).toBe(true);
    expect((await rl.hit("b", 1, 60)).allowed).toBe(true); // different key, fresh
    expect((await rl.hit("a", 1, 60)).allowed).toBe(false); // 'a' already spent
  });
});

describe("SqlRateLimiter (pg-mem)", () => {
  it("counts per key within a window and blocks the overflow", async () => {
    const sql = await pgMemSql();
    const rl = new SqlRateLimiter(sql, () => 1_000_000);
    expect((await rl.hit("u:1", 2, 60)).allowed).toBe(true); // 1
    expect((await rl.hit("u:1", 2, 60)).allowed).toBe(true); // 2
    expect((await rl.hit("u:1", 2, 60)).allowed).toBe(false); // 3, over
    expect((await rl.hit("u:2", 2, 60)).allowed).toBe(true); // other key unaffected
  });

  it("resets count to 1 when the window advances", async () => {
    let t = 0;
    const sql = await pgMemSql();
    const rl = new SqlRateLimiter(sql, () => t);
    expect((await rl.hit("k", 5, 60)).count).toBe(1);
    expect((await rl.hit("k", 5, 60)).count).toBe(2);
    t = 120_000; // two windows later
    const fresh = await rl.hit("k", 5, 60);
    expect(fresh.count).toBe(1);
    expect(fresh.allowed).toBe(true);
  });
});
