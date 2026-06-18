import { newId } from "../ids";
import { applySchema } from "./schema";
import type {
  BacklogFilter,
  BacklogItem,
  Recipe,
  Recurrence,
  Run,
  Sql,
  Status,
  StatusKind,
  Store,
  Trigger,
} from "./types";

const nowIso = (): string => new Date().toISOString();
const bool = (v: unknown): boolean => v === true || v === "t" || v === "true" || v === 1;

function toBacklog(r: any): BacklogItem {
  return {
    id: r.id,
    user_id: r.user_id,
    text: r.text,
    status: r.status,
    pinned: bool(r.pinned),
    tags: r.tags ?? "",
    created_at: r.created_at,
    completed_at: r.completed_at ?? null,
  };
}
function toRecipe(r: any): Recipe {
  return {
    id: r.id,
    user_id: r.user_id,
    name: r.name,
    prompt: r.prompt ?? "",
    integrations: r.integrations ?? "[]",
    enabled: bool(r.enabled),
    created_at: r.created_at,
  };
}
function toStatus(r: any): Status {
  return {
    user_id: r.user_id,
    status: r.status,
    note: r.note ?? "",
    until: r.until ?? null,
    updated_at: r.updated_at,
  };
}
function toTrigger(r: any): Trigger {
  return {
    id: r.id,
    user_id: r.user_id,
    kind: r.kind,
    text: r.text ?? "",
    fire_at: r.fire_at,
    recurrence: r.recurrence,
    status: r.status,
    created_at: r.created_at,
  };
}
function toRun(r: any): Run {
  return {
    id: r.id,
    user_id: r.user_id,
    kind: r.kind,
    status: r.status,
    input: r.input ?? "{}",
    output: r.output ?? "{}",
    created_at: r.created_at,
    finished_at: r.finished_at ?? null,
  };
}

/** One Store implementation over a SQL driver port; runs on pg-mem and Neon alike. */
export class SqlStore implements Store {
  constructor(private sql: Sql) {}

  async init(): Promise<void> {
    await applySchema(this.sql);
  }

  // ---- backlog ----
  async addBacklog(i: { user_id: string; text: string; tags?: string }): Promise<BacklogItem> {
    const id = newId("bk");
    const r = await this.sql(
      `INSERT INTO pc_backlog (id, user_id, text, status, pinned, tags, created_at)
       VALUES ($1,$2,$3,'open',false,$4,$5) RETURNING *`,
      [id, i.user_id, i.text, i.tags ?? "", nowIso()],
    );
    return toBacklog(r.rows[0]);
  }

  async listBacklog(userId: string, filter: BacklogFilter): Promise<BacklogItem[]> {
    let where = "user_id=$1";
    let order = "pinned DESC, created_at ASC";
    if (filter === "open") where += " AND status='open'";
    else if (filter === "pinned") where += " AND status='open' AND pinned=true";
    else if (filter === "done") {
      where += " AND status='done'";
      order = "completed_at DESC";
    } else order = "status ASC, pinned DESC, created_at ASC"; // all
    const r = await this.sql(`SELECT * FROM pc_backlog WHERE ${where} ORDER BY ${order}`, [userId]);
    return r.rows.map(toBacklog);
  }

  async resolveRef(userId: string, ref: number | string): Promise<BacklogItem | null> {
    const isIndex = typeof ref === "number" || /^\d+$/.test(String(ref));
    if (isIndex) {
      const idx = Number(ref);
      const open = await this.listBacklog(userId, "open");
      return open[idx - 1] ?? null; // 1-based
    }
    const r = await this.sql(`SELECT * FROM pc_backlog WHERE id=$1 AND user_id=$2`, [ref, userId]);
    return r.rowCount ? toBacklog(r.rows[0]) : null;
  }

  async completeBacklog(userId: string, id: string): Promise<BacklogItem | null> {
    const r = await this.sql(
      `UPDATE pc_backlog SET status='done', completed_at=$3
       WHERE id=$2 AND user_id=$1 RETURNING *`,
      [userId, id, nowIso()],
    );
    return r.rowCount ? toBacklog(r.rows[0]) : null;
  }

  async pinBacklog(userId: string, id: string, pinned: boolean): Promise<BacklogItem | null> {
    const r = await this.sql(
      `UPDATE pc_backlog SET pinned=$3 WHERE id=$2 AND user_id=$1 RETURNING *`,
      [userId, id, pinned],
    );
    return r.rowCount ? toBacklog(r.rows[0]) : null;
  }

  // ---- recipes ----
  async listRecipes(userId: string): Promise<Recipe[]> {
    const r = await this.sql(`SELECT * FROM pc_recipes WHERE user_id=$1 ORDER BY created_at ASC`, [
      userId,
    ]);
    return r.rows.map(toRecipe);
  }

  async installRecipe(rec: {
    user_id: string;
    name: string;
    prompt?: string;
    integrations?: string;
    enabled?: boolean;
  }): Promise<Recipe> {
    const id = newId("rcp");
    const r = await this.sql(
      `INSERT INTO pc_recipes (id, user_id, name, prompt, integrations, enabled, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        id,
        rec.user_id,
        rec.name,
        rec.prompt ?? "",
        rec.integrations ?? "[]",
        rec.enabled ?? true,
        nowIso(),
      ],
    );
    return toRecipe(r.rows[0]);
  }

  // ---- status ----
  async getStatus(userId: string): Promise<Status> {
    const r = await this.sql(`SELECT * FROM pc_status WHERE user_id=$1`, [userId]);
    if (r.rowCount) return toStatus(r.rows[0]);
    return { user_id: userId, status: "active", note: "", until: null, updated_at: nowIso() };
  }

  async setStatus(s: {
    user_id: string;
    status: StatusKind;
    note?: string;
    until?: string | null;
  }): Promise<Status> {
    const r = await this.sql(
      `INSERT INTO pc_status (user_id, status, note, until, updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         status=EXCLUDED.status, note=EXCLUDED.note, until=EXCLUDED.until, updated_at=EXCLUDED.updated_at
       RETURNING *`,
      [s.user_id, s.status, s.note ?? "", s.until ?? null, nowIso()],
    );
    return toStatus(r.rows[0]);
  }

  // ---- triggers ----
  async addTrigger(t: {
    user_id: string;
    kind?: string;
    text: string;
    fire_at: string;
    recurrence?: Recurrence;
  }): Promise<Trigger> {
    const id = newId("trg");
    const r = await this.sql(
      `INSERT INTO pc_triggers (id, user_id, kind, text, fire_at, recurrence, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7) RETURNING *`,
      [id, t.user_id, t.kind ?? "reminder", t.text, t.fire_at, t.recurrence ?? "none", nowIso()],
    );
    return toTrigger(r.rows[0]);
  }

  async dueTriggers(now: string): Promise<Trigger[]> {
    const r = await this.sql(
      `SELECT * FROM pc_triggers WHERE status='pending' AND fire_at <= $1 ORDER BY fire_at ASC`,
      [now],
    );
    return r.rows.map(toTrigger);
  }

  async markTriggerFired(id: string, rearmTo?: string): Promise<void> {
    if (rearmTo) {
      await this.sql(`UPDATE pc_triggers SET status='pending', fire_at=$2 WHERE id=$1`, [
        id,
        rearmTo,
      ]);
    } else {
      await this.sql(`UPDATE pc_triggers SET status='fired' WHERE id=$1`, [id]);
    }
  }

  // ---- runs ----
  async createRun(r: { id: string; user_id: string; kind: string; input: string }): Promise<Run> {
    const row = await this.sql(
      `INSERT INTO pc_runs (id, user_id, kind, status, input, output, created_at)
       VALUES ($1,$2,$3,'running',$4,'{}',$5) RETURNING *`,
      [r.id, r.user_id, r.kind, r.input, nowIso()],
    );
    return toRun(row.rows[0]);
  }

  async finishRun(id: string, output: string): Promise<boolean> {
    const r = await this.sql(
      `UPDATE pc_runs SET status='done', output=$2, finished_at=$3
       WHERE id=$1 AND status='running' RETURNING id`,
      [id, output, nowIso()],
    );
    return r.rowCount === 1;
  }

  async errorRun(id: string, output: string): Promise<void> {
    await this.sql(
      `UPDATE pc_runs SET status='error', output=$2, finished_at=$3 WHERE id=$1`,
      [id, output, nowIso()],
    );
  }

  async getRun(userId: string, id: string): Promise<Run | null> {
    const r = await this.sql(`SELECT * FROM pc_runs WHERE id=$1 AND user_id=$2`, [id, userId]);
    return r.rowCount ? toRun(r.rows[0]) : null;
  }
}
