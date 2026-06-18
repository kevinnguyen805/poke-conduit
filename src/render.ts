/**
 * Pure formatters: store entities → the human-facing text Poke relays to the
 * user. No I/O, no Date — deterministic and unit-testable. Kept separate from
 * the tool handlers so the "what the user reads" surface is reviewable in one
 * place.
 */
import type { CouncilResult } from "./agents/council";
import type { BacklogItem, Recipe, Run, Status, Trigger } from "./store/types";
import type { StepOutcome } from "./tools/recipe-runner";

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

/** Count the runnable steps a recipe carries (0 for a prompt-only recipe). */
function stepCount(recipe: Recipe): number {
  try {
    const parsed = JSON.parse(recipe.steps);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"}`;

export function renderRecipes(recipes: Recipe[]): string {
  if (recipes.length === 0) return "No recipes installed yet.";
  return recipes
    .map((r) => {
      const n = stepCount(r);
      const suffix = n > 0 ? ` (${plural(n, "step")})` : "";
      return `${DOT} ${r.name}${suffix}${r.enabled ? "" : " (off)"}`;
    })
    .join("\n");
}

export function renderRecipeInstalled(recipe: Recipe): string {
  const n = stepCount(recipe);
  return n > 0
    ? `Installed recipe "${recipe.name}" (${plural(n, "step")}). Say "run ${recipe.name}" to execute it.`
    : `Installed recipe "${recipe.name}".`;
}

/** First non-empty line of a step's text, trimmed to keep the digest scannable. */
function digest(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/**
 * Outcome of running a recipe: a header summarizing how far it got, then one
 * ✓/✗ line per executed step. `planned` is how many steps were supposed to run,
 * so a short run (a step failed and stopped the chain) reads as "stopped at…".
 */
export function renderRecipeRun(name: string, outcomes: StepOutcome[], planned: number): string {
  const ran = outcomes.length;
  const allOk = outcomes.every((o) => o.ok);
  const head =
    allOk && ran === planned
      ? `▶️ Ran your "${name}" routine — ${plural(planned, "step")} ✓`
      : `▶️ Ran your "${name}" routine — stopped at step ${ran}/${planned} ✗`;
  const body = outcomes.map((o) => `${o.ok ? "✓" : "✗"} ${o.tool}: ${digest(o.text)}`).join("\n");
  return body ? `${head}\n${body}` : head;
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
