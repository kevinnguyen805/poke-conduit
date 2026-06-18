/**
 * Store contract. Timestamps are ISO-8601 **text** (not timestamptz): they sort
 * lexically (so `fire_at <= now` is a plain string compare) and round-trip
 * byte-identical across pg-mem and Neon. App code supplies all timestamps.
 */

/** Minimal driver port: works with @neondatabase/serverless, node-postgres, or pg-mem. */
export type Sql = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: any[]; rowCount: number }>;

export type BacklogStatus = "open" | "done";
export interface BacklogItem {
  id: string;
  user_id: string;
  text: string;
  status: BacklogStatus;
  pinned: boolean;
  tags: string; // comma-separated
  created_at: string; // ISO
  completed_at: string | null; // ISO
}

export interface Recipe {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  integrations: string; // JSON text
  enabled: boolean;
  created_at: string; // ISO
}

export type StatusKind = "active" | "dnd" | "deep_work";
export interface Status {
  user_id: string;
  status: StatusKind;
  note: string;
  until: string | null; // ISO
  updated_at: string; // ISO
}

export type Recurrence = "none" | "daily";
export interface Trigger {
  id: string;
  user_id: string;
  kind: string; // reminder | resurface
  text: string;
  fire_at: string; // ISO
  recurrence: Recurrence;
  status: "pending" | "fired";
  created_at: string; // ISO
}

export type RunStatus = "running" | "done" | "error";
export interface Run {
  id: string;
  user_id: string;
  kind: string;
  status: RunStatus;
  input: string; // JSON text
  output: string; // JSON text
  created_at: string; // ISO
  finished_at: string | null; // ISO
}

export type BacklogFilter = "open" | "pinned" | "done" | "all";

export interface Store {
  init(): Promise<void>;

  addBacklog(i: { user_id: string; text: string; tags?: string }): Promise<BacklogItem>;
  listBacklog(userId: string, filter: BacklogFilter): Promise<BacklogItem[]>;
  /** Resolve a 1-based index into the user's open list, or a stable id. */
  resolveRef(userId: string, ref: number | string): Promise<BacklogItem | null>;
  completeBacklog(userId: string, id: string): Promise<BacklogItem | null>;
  pinBacklog(userId: string, id: string, pinned: boolean): Promise<BacklogItem | null>;

  listRecipes(userId: string): Promise<Recipe[]>;
  installRecipe(r: {
    user_id: string;
    name: string;
    prompt?: string;
    integrations?: string;
    enabled?: boolean;
  }): Promise<Recipe>;

  getStatus(userId: string): Promise<Status>;
  setStatus(s: {
    user_id: string;
    status: StatusKind;
    note?: string;
    until?: string | null;
  }): Promise<Status>;

  addTrigger(t: {
    user_id: string;
    kind?: string;
    text: string;
    fire_at: string;
    recurrence?: Recurrence;
  }): Promise<Trigger>;
  /** Pending triggers whose fire_at <= now (ISO). */
  dueTriggers(now: string): Promise<Trigger[]>;
  markTriggerFired(id: string, rearmTo?: string): Promise<void>;

  createRun(r: { id: string; user_id: string; kind: string; input: string }): Promise<Run>;
  /** Idempotent finalize: returns true only for the call that flips running→done. */
  finishRun(id: string, output: string): Promise<boolean>;
  errorRun(id: string, output: string): Promise<void>;
  getRun(userId: string, id: string): Promise<Run | null>;
}
