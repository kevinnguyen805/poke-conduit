import type { Sql } from "./types";

/**
 * Schema. All `pc_`-prefixed so poke-conduit can share the existing
 * poke-amb-bridge Neon database with zero collision. Timestamps are text (ISO).
 */
export const TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS pc_backlog (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    text text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    pinned boolean NOT NULL DEFAULT false,
    tags text NOT NULL DEFAULT '',
    created_at text NOT NULL,
    completed_at text
  )`,
  `CREATE TABLE IF NOT EXISTS pc_recipes (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    prompt text NOT NULL DEFAULT '',
    integrations text NOT NULL DEFAULT '[]',
    enabled boolean NOT NULL DEFAULT false,
    created_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pc_status (
    user_id text PRIMARY KEY,
    status text NOT NULL DEFAULT 'active',
    note text NOT NULL DEFAULT '',
    until text,
    updated_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pc_triggers (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    kind text NOT NULL DEFAULT 'reminder',
    text text NOT NULL DEFAULT '',
    fire_at text NOT NULL,
    recurrence text NOT NULL DEFAULT 'none',
    status text NOT NULL DEFAULT 'pending',
    created_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pc_runs (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    kind text NOT NULL DEFAULT 'council',
    status text NOT NULL DEFAULT 'running',
    input text NOT NULL DEFAULT '{}',
    output text NOT NULL DEFAULT '{}',
    created_at text NOT NULL,
    finished_at text
  )`,
];

export async function applySchema(sql: Sql): Promise<void> {
  for (const stmt of TABLES) await sql(stmt);
}
