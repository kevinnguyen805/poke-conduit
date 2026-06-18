import { backlogTools } from "./backlog";
import { councilTools } from "./council";
import { reminderTools } from "./reminders";
import { statusTools } from "./status";
import type { ToolContext, ToolDef } from "./types";

/**
 * Recipe execution = a saved recipe is an ordered macro of conduit tool-calls.
 * Each step names a tool and its args; running the recipe dispatches each step
 * through the very same handler path Poke uses for a single tool call.
 *
 * The runnable set is the four *data* tool families imported as siblings (NOT
 * via ./index, which would close an import cycle through ./recipes). That import
 * boundary also excludes the recipe tools themselves, so a recipe can never call
 * run_recipe — recursion is impossible by construction, not by a runtime guard.
 */
const RUNNABLE: Map<string, ToolDef> = new Map(
  [...backlogTools, ...councilTools, ...reminderTools, ...statusTools].map((t) => [t.name, t]),
);

/** Tools a recipe step is allowed to invoke, for discovery/error messages. */
export const runnableToolNames = (): string[] => [...RUNNABLE.keys()];

/** One declared step of a recipe: a tool name plus the args to call it with. */
export interface RecipeStep {
  tool: string;
  args: Record<string, unknown>;
}

/** The result of executing one step. */
export interface StepOutcome {
  tool: string;
  ok: boolean;
  text: string;
}

/** Defensive ceiling so a single recipe can't fan out unboundedly. */
export const MAX_RECIPE_STEPS = 25;

export type ValidateResult =
  | { ok: true; steps: RecipeStep[] }
  | { ok: false; error: string };

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Parse + validate a recipe `steps` JSON string into runnable steps. Every step
 * must name a runnable tool and carry args that pass that tool's own zod schema,
 * so an invalid recipe is rejected *before* any side effect runs.
 */
export function validateSteps(json: string): ValidateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `steps is not valid JSON: ${errMsg(e)}` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "steps must be a JSON array of { tool, args } objects." };
  }
  if (parsed.length > MAX_RECIPE_STEPS) {
    return { ok: false, error: `a recipe can have at most ${MAX_RECIPE_STEPS} steps.` };
  }

  const steps: RecipeStep[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i] as { tool?: unknown; args?: unknown };
    const label = `step ${i + 1}`;
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: `${label} must be an object with a "tool" field.` };
    }
    const toolName = raw.tool;
    if (typeof toolName !== "string" || !toolName) {
      return { ok: false, error: `${label} is missing a "tool" name.` };
    }
    const tool = RUNNABLE.get(toolName);
    if (!tool) {
      return {
        ok: false,
        error: `${label} names unknown tool "${toolName}". Allowed: ${runnableToolNames().join(", ")}.`,
      };
    }
    const args = (raw.args ?? {}) as Record<string, unknown>;
    const check = tool.zod.safeParse(args);
    if (!check.success) {
      const first = check.error.issues[0];
      const where = first?.path?.length ? ` (${first.path.join(".")})` : "";
      return {
        ok: false,
        error: `${label} (${toolName}) has invalid args${where}: ${first?.message ?? "validation failed"}.`,
      };
    }
    steps.push({ tool: toolName, args });
  }
  return { ok: true, steps };
}

/**
 * Run validated steps sequentially against the caller's context. Each step is
 * dispatched through the tool's real handler (same path as a direct MCP call),
 * so side effects are genuine. A throwing step is recorded and stops the run —
 * later steps may depend on earlier ones, so we fail closed rather than skip.
 */
export async function runRecipeSteps(
  steps: RecipeStep[],
  ctx: ToolContext,
): Promise<StepOutcome[]> {
  const outcomes: StepOutcome[] = [];
  for (const step of steps) {
    const tool = RUNNABLE.get(step.tool);
    if (!tool) {
      outcomes.push({ tool: step.tool, ok: false, text: `unknown tool "${step.tool}"` });
      break;
    }
    try {
      const parsed = tool.zod.parse(step.args);
      const result = await tool.handler(parsed, ctx);
      outcomes.push({ tool: step.tool, ok: true, text: result.text });
    } catch (e) {
      outcomes.push({ tool: step.tool, ok: false, text: errMsg(e) });
      break;
    }
  }
  return outcomes;
}
