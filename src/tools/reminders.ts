import { z } from "zod";
import { renderReminderAdded, renderReminderList } from "../render";
import type { ToolDef } from "./types";

const setReminder: ToolDef = {
  name: "set_reminder",
  description:
    "Schedule a proactive reminder. Convert the user's natural time ('tomorrow 9am') into an absolute ISO-8601 UTC timestamp yourself before calling. Use recurrence 'daily' for repeating reminders. Only call when the user asks to be reminded of something.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "what to remind them about" },
      fire_at: { type: "string", description: "absolute ISO-8601 UTC time, e.g. 2026-06-19T16:00:00.000Z" },
      recurrence: { type: "string", enum: ["none", "daily"], description: "default none" },
    },
    required: ["text", "fire_at"],
  },
  zod: z.object({
    text: z.string().min(1),
    fire_at: z.string().min(1),
    recurrence: z.enum(["none", "daily"]).optional(),
  }),
  requiresAuth: true,
  async handler(args, ctx) {
    const t = await ctx.store.addTrigger({
      user_id: ctx.userId,
      kind: "reminder",
      text: args.text,
      fire_at: args.fire_at,
      ...(args.recurrence ? { recurrence: args.recurrence } : {}),
    });
    return { text: renderReminderAdded(t), data: { id: t.id } };
  },
};

const listReminders: ToolDef = {
  name: "list_reminders",
  description:
    "List the user's upcoming reminders, soonest first. Only call when the user asks what reminders or alerts they have set.",
  inputSchema: { type: "object", properties: {} },
  zod: z.object({}),
  requiresAuth: true,
  async handler(_args, ctx) {
    const triggers = await ctx.store.listTriggers(ctx.userId);
    return { text: renderReminderList(triggers), data: { count: triggers.length } };
  },
};

export const reminderTools: ToolDef[] = [setReminder, listReminders];
