/**
 * Pure formatters: store entities → the human-facing text Poke relays to the
 * user. No I/O, no Date — deterministic and unit-testable. Kept separate from
 * the tool handlers so the "what the user reads" surface is reviewable in one
 * place.
 */
import type { CouncilResult } from "./agents/council";
import type { BacklogItem, Recipe, Run, Status, Trigger } from "./store/types";

const PIN = "📌";
const DOT = "•";

/** Numbered open-backlog list. Numbers are 1-based and match resolveRef indices. */
export function renderBacklogList(items: BacklogItem[]): string {
  if (items.length === 0) return "Your backlog is empty.";
  return items
    .map((it, i) => `${i + 1}. ${it.pinned ? `${PIN} ` : ""}${it.text}`)
    .join("\n");
}

export function renderBacklogAdded(item: BacklogItem, openCount: number): string {
  return `Added to your backlog: "${item.text}" (${openCount} open).`;
}

export function renderBacklogCompleted(item: BacklogItem): string {
  return `Done: "${item.text}". Nice.`;
}

export function renderBacklogPinned(item: BacklogItem): string {
  return item.pinned
    ? `Pinned "${item.text}" to the top.`
    : `Unpinned "${item.text}".`;
}

/** The council answer the user sees: synthesis up top, panel below for transparency. */
export function renderCouncil(result: CouncilResult): string {
  const panel = result.positions
    .map((p) => `${DOT} ${p.name}: ${p.text}`)
    .join("\n");
  return `🧭 Council on: ${result.question}\n\n${result.synthesis}\n\n— the room —\n${panel}`;
}

export function renderCouncilQueued(runId: string): string {
  return `On it — convening the council on that. I'll message you the verdict shortly. (run ${runId})`;
}

export function renderRunStatus(run: Run): string {
  if (run.status === "running") return `Still deliberating… (run ${run.id})`;
  if (run.status === "error") return `That council run hit an error (run ${run.id}).`;
  try {
    return renderCouncil(JSON.parse(run.output) as CouncilResult);
  } catch {
    return `Council finished (run ${run.id}).`;
  }
}

export function renderStatus(status: Status): string {
  const label =
    status.status === "active"
      ? "active"
      : status.status === "dnd"
        ? "do-not-disturb"
        : "deep work";
  const note = status.note ? ` — ${status.note}` : "";
  const until = status.until ? ` (until ${status.until})` : "";
  return `You're currently ${label}${note}${until}.`;
}

export function renderStatusSet(status: Status): string {
  return `Status set: ${renderStatus(status).replace(/^You're currently /, "")}`;
}

export function renderRecipes(recipes: Recipe[]): string {
  if (recipes.length === 0) return "No recipes installed yet.";
  return recipes
    .map((r) => `${DOT} ${r.name}${r.enabled ? "" : " (off)"}`)
    .join("\n");
}

export function renderRecipeInstalled(recipe: Recipe): string {
  return `Installed recipe "${recipe.name}".`;
}

export function renderReminderAdded(t: Trigger): string {
  const recur = t.recurrence === "daily" ? " (daily)" : "";
  return `Reminder set for ${t.fire_at}${recur}: ${t.text}`;
}

export function renderReminderList(triggers: Trigger[]): string {
  if (triggers.length === 0) return "No upcoming reminders.";
  return triggers
    .map((t) => `${DOT} ${t.fire_at}${t.recurrence === "daily" ? " (daily)" : ""} — ${t.text}`)
    .join("\n");
}
