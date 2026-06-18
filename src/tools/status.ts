import { z } from "zod";
import { renderStatus, renderStatusSet } from "../render";
import type { ToolDef } from "./types";

const getStatus: ToolDef = {
  name: "get_status",
  description:
    "Get the user's current availability (active / do-not-disturb / deep work). Only call when the user asks about their status or whether they're in focus mode.",
  inputSchema: { type: "object", properties: {} },
  zod: z.object({}),
  requiresAuth: true,
  async handler(_args, ctx) {
    const s = await ctx.store.getStatus(ctx.userId);
    return { text: renderStatus(s), data: { status: s.status } };
  },
};

const setStatus: ToolDef = {
  name: "set_status",
  description:
    "Set the user's availability. 'dnd' = do-not-disturb, 'deep_work' = focus block, 'active' = back to normal. Provide `until` as an absolute ISO time if it's time-boxed. Only call when the user asks to change their status or start/stop focus.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "dnd", "deep_work"] },
      note: { type: "string", description: "optional short note, e.g. 'shipping the release'" },
      until: { type: "string", description: "optional absolute ISO end time" },
    },
    required: ["status"],
  },
  zod: z.object({
    status: z.enum(["active", "dnd", "deep_work"]),
    note: z.string().optional(),
    until: z.string().optional(),
  }),
  requiresAuth: true,
  async handler(args, ctx) {
    const s = await ctx.store.setStatus({
      user_id: ctx.userId,
      status: args.status,
      ...(args.note ? { note: args.note } : {}),
      ...(args.until ? { until: args.until } : {}),
    });
    return { text: renderStatusSet(s), data: { status: s.status } };
  },
};

export const statusTools: ToolDef[] = [getStatus, setStatus];
