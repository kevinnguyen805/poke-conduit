// src/spectrum/tools.ts
import { z } from "zod";
import { findTool } from "../tools/index";
import type { ToolDef } from "../tools/types";
import type { PollSpec } from "./types";

/**
 * Render the user's open backlog as a native poll so they can tap to choose what
 * to do next. The handler stays transport-agnostic: it emits `data.poll`; the
 * Spectrum app turns that into `space.send(poll(...))`. Falls back to text when
 * a poll wouldn't make sense (0 or 1 open item).
 */
export const prioritizeTool: ToolDef = {
  name: "prioritize",
  description:
    "Render the user's open backlog as a poll so they can pick what to work on first. " +
    "Only call when the user asks which item to do first, or for help prioritizing/choosing.",
  inputSchema: { type: "object", properties: {} },
  zod: z.object({}),
  requiresAuth: true,
  async handler(_args, ctx) {
    const open = await ctx.store.listBacklog(ctx.userId, "open");
    if (open.length === 0) return { text: "Your backlog is empty — nothing to prioritize." };
    if (open.length === 1) return { text: `Only one open item: "${open[0]!.text}". Start there.` };
    // polls cap at 2–10 options; keep ≤4 tight choices, ellipsize long text so a cut reads as intentional
    const options = open.slice(0, 4).map((it) => (it.text.length > 80 ? `${it.text.slice(0, 79)}…` : it.text));
    const poll: PollSpec = { title: "Which should we tackle first?", options };
    return { text: poll.title, data: { poll } };
  },
};

/** Names from the shared library that make sense on a self-driven line (council is Phase-B). */
const REUSED = [
  "add_note", "list_backlog", "complete_note", "pin_note",
  "set_reminder", "list_reminders",
  "get_status", "set_status",
  "list_recipes", "run_recipe",
];

/** The tool surface the router chooses from on the Spectrum line. */
export const SPECTRUM_TOOLS: ToolDef[] = [
  ...REUSED.map((name) => {
    const tool = findTool(name);
    if (!tool) throw new Error(`SPECTRUM_TOOLS: missing tool '${name}'`);
    return tool;
  }),
  prioritizeTool,
];
