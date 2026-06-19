import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import type { ToolDef } from "../tools/types";
import type { ChatTurn, RouteDecision, RouterModel } from "./types";

/** System prompt for the NL brain. Terse: tools self-describe via their schemas. */
export const ROUTER_SYSTEM =
  "You are the user's personal second-brain agent, reachable over iMessage. You can save " +
  "notes, track a backlog, set proactive reminders, manage availability, run saved recipes, " +
  "and help the user prioritize. When a message clearly maps to one of your tools, call exactly " +
  "that one tool. For reminders, convert the user's natural time (e.g. 'tomorrow 9am') into an " +
  "absolute ISO-8601 UTC timestamp yourself. If the message is small talk, a question, or maps to " +
  "no tool, DO NOT call a tool — reply briefly and warmly in one or two sentences. Never invent a tool.";

/**
 * Normalize stored turns into a valid Anthropic message list: drop leading
 * assistant turns (the API must start with `user`) and merge consecutive
 * same-role turns (the API requires strict alternation).
 */
export function toApiMessages(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    if (out.length === 0 && t.role !== "user") continue; // skip leading assistant
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.text = `${last.text}\n${t.text}`;
    else out.push({ role: t.role, text: t.text });
  }
  return out;
}

/**
 * Deterministic offline brain — keyword routing. Used in tests, `npm run demo`-
 * style offline runs, and whenever ANTHROPIC_API_KEY is unset. Intentionally
 * simple: real intent understanding is ClaudeRouterModel's job.
 */
export class MockRouterModel implements RouterModel {
  async decide(input: { system: string; messages: ChatTurn[]; tools: ToolDef[] }): Promise<RouteDecision> {
    const last = [...input.messages].reverse().find((m) => m.role === "user")?.text ?? "";
    const t = last.toLowerCase();
    const has = (name: string) => input.tools.some((x) => x.name === name);

    if (/\b(remind|reminder|alert me)\b/.test(t) && has("set_reminder")) {
      const text = last.replace(/.*remind me (to )?/i, "").trim() || last;
      return { kind: "tool", name: "set_reminder", arguments: { text, fire_at: "2026-06-20T16:00:00.000Z" } };
    }
    if (/\b(my )?(reminders|alerts)\b/.test(t) && has("list_reminders")) {
      return { kind: "tool", name: "list_reminders", arguments: {} };
    }
    if (/\b(prioriti[sz]e|which (one |should )|what should i (do|focus))\b/.test(t) && has("prioritize")) {
      return { kind: "tool", name: "prioritize", arguments: {} };
    }
    if (/\b(list|what'?s on|show me)\b/.test(t) && /\b(list|backlog|notes?|todos?|queue)\b/.test(t) && has("list_backlog")) {
      return { kind: "tool", name: "list_backlog", arguments: {} };
    }
    if (/\b(done|completed?|finished?|mark)\b/.test(t) && has("complete_note")) {
      const m = t.match(/\b(\d+)\b/);
      return { kind: "tool", name: "complete_note", arguments: { ref: m ? Number(m[1]) : 1 } };
    }
    if (/\b(save|add|note|remember|jot|queue)\b/.test(t) && has("add_note")) {
      const text = last.replace(/.*\b(save|add|note|remember|jot|queue)( this)?( to (my )?(list|backlog))?:?\s*/i, "").trim() || last;
      return { kind: "tool", name: "add_note", arguments: { text } };
    }
    return {
      kind: "reply",
      text: `Got it — "${last}". I can save notes, track your backlog, set reminders, and help you prioritize. What would you like?`,
    };
  }
}

/** Real brain: one Claude tool-use call over the tool schemas. */
export class ClaudeRouterModel implements RouterModel {
  private client: Anthropic;
  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async decide(input: { system: string; messages: ChatTurn[]; tools: ToolDef[] }): Promise<RouteDecision> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: input.system,
      tools: input.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })) as Anthropic.Tool[],
      messages: toApiMessages(input.messages).map((m) => ({ role: m.role, content: m.text })),
    });
    const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUse) {
      return {
        kind: "tool",
        name: toolUse.name,
        arguments: (toolUse.input ?? {}) as Record<string, unknown>,
      };
    }
    // Concatenate text blocks the same cast-free way as src/model/claude.ts:
    // the discriminated union narrows `block.text` to string after the type guard.
    let text = "";
    for (const block of res.content) {
      if (block.type === "text") text += block.text;
    }
    return { kind: "reply", text: text.trim() || "I'm here — what do you need?" };
  }
}

/** Real brain when ANTHROPIC_API_KEY is set; else the deterministic offline mock. */
export function makeRouterModel(): RouterModel {
  return config.anthropicApiKey
    ? new ClaudeRouterModel(config.anthropicApiKey, config.synthModel)
    : new MockRouterModel();
}
