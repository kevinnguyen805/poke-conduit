import { backlogTools } from "./backlog";
import { councilTools } from "./council";
import { recipeTools } from "./recipes";
import { reminderTools } from "./reminders";
import { statusTools } from "./status";
import type { ToolDef } from "./types";

export type { JsonSchema, ToolContext, ToolDef, ToolResult } from "./types";

/** The full MCP tool surface poke-conduit exposes to Poke. */
export const ALL_TOOLS: ToolDef[] = [
  ...backlogTools,
  ...councilTools,
  ...reminderTools,
  ...statusTools,
  ...recipeTools,
];

const BY_NAME = new Map<string, ToolDef>(ALL_TOOLS.map((t) => [t.name, t]));

export function findTool(name: string): ToolDef | undefined {
  return BY_NAME.get(name);
}
