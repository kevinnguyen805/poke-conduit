import { z } from "zod";
import {
  renderBacklogAdded,
  renderBacklogCompleted,
  renderBacklogList,
  renderBacklogPinned,
} from "../render";
import type { ToolDef } from "./types";

const addNote: ToolDef = {
  name: "add_note",
  description:
    "Add an item to the user's queued-notes backlog — a to-read, to-do, or idea they want to keep. Only call when the user clearly wants to save, queue, or jot something down.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "the note or task text" },
      tags: { type: "string", description: "optional comma-separated tags" },
    },
    required: ["text"],
  },
  zod: z.object({ text: z.string().min(1), tags: z.string().optional() }),
  requiresAuth: true,
  async handler(args, ctx) {
    const item = await ctx.store.addBacklog({
      user_id: ctx.userId,
      text: args.text,
      ...(args.tags ? { tags: args.tags } : {}),
    });
    const open = await ctx.store.listBacklog(ctx.userId, "open");
    return { text: renderBacklogAdded(item, open.length), data: { id: item.id } };
  },
};

const listBacklog: ToolDef = {
  name: "list_backlog",
  description:
    "List the user's backlog items, numbered. Only call when the user asks what's on their list, backlog, or queue.",
  inputSchema: {
    type: "object",
    properties: {
      filter: {
        type: "string",
        enum: ["open", "pinned", "done", "all"],
        description: "which items (default open)",
      },
    },
  },
  zod: z.object({ filter: z.enum(["open", "pinned", "done", "all"]).optional() }),
  requiresAuth: true,
  async handler(args, ctx) {
    const items = await ctx.store.listBacklog(ctx.userId, args.filter ?? "open");
    return { text: renderBacklogList(items), data: { count: items.length } };
  },
};

const completeNote: ToolDef = {
  name: "complete_note",
  description:
    "Mark a backlog item done by its list number or id. Only call when the user says they finished, completed, or did one.",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string", description: "the item's list number (e.g. '2') or its id" } },
    required: ["ref"],
  },
  zod: z.object({ ref: z.union([z.string(), z.number()]) }),
  requiresAuth: true,
  async handler(args, ctx) {
    const found = await ctx.store.resolveRef(ctx.userId, args.ref);
    if (!found) return { text: `I couldn't find item "${args.ref}".` };
    const done = await ctx.store.completeBacklog(ctx.userId, found.id);
    return { text: done ? renderBacklogCompleted(done) : `Couldn't complete "${args.ref}".` };
  },
};

const pinNote: ToolDef = {
  name: "pin_note",
  description:
    "Pin (or unpin) a backlog item to the top, by list number or id. Only call when the user asks to pin, prioritize, or unpin an item.",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "the item's list number or id" },
      pinned: { type: "boolean", description: "true to pin (default), false to unpin" },
    },
    required: ["ref"],
  },
  zod: z.object({ ref: z.union([z.string(), z.number()]), pinned: z.boolean().optional() }),
  requiresAuth: true,
  async handler(args, ctx) {
    const found = await ctx.store.resolveRef(ctx.userId, args.ref);
    if (!found) return { text: `I couldn't find item "${args.ref}".` };
    const updated = await ctx.store.pinBacklog(ctx.userId, found.id, args.pinned ?? true);
    return { text: updated ? renderBacklogPinned(updated) : `Couldn't update "${args.ref}".` };
  },
};

export const backlogTools: ToolDef[] = [addNote, listBacklog, completeNote, pinNote];
