import { config } from "../config";
import { ALL_TOOLS, findTool } from "../tools/index";
import type { ToolContext } from "../tools/types";
import { isAuthorized, type AuthContext } from "./auth";

export const SERVER_INFO = { name: "poke-conduit", version: "0.1.0" } as const;

/** Onboarding behavior Poke reads at connect time (the home for "don't auto-act"). */
export const INSTRUCTIONS =
  "poke-conduit is the user's durable second brain, consulted over this chat. It offers: " +
  "a queued-notes backlog (add_note / list_backlog / complete_note / pin_note); a multi-agent " +
  "COUNCIL for hard judgement calls (ask_council convenes Builder, Skeptic, Operator and " +
  "User-Advocate, then a synthesizer makes the call; council_status checks an async run); " +
  "proactive reminders (set_reminder / list_reminders — convert the user's natural time into an " +
  "absolute ISO-8601 UTC timestamp yourself before calling); availability/DND (get_status / " +
  "set_status); and saved recipes (list_recipes / install_recipe). " +
  "When the user first connects, briefly introduce these abilities, then wait — do NOT act " +
  "automatically. Only add_note when they want to save something, only ask_council for genuine " +
  "trade-offs and decisions (never simple factual lookups), only set_reminder when they ask to be " +
  "reminded. For ask_council, prefer deliver='async' when the answer may take more than a few " +
  "seconds: tell the user you'll report back, and the verdict arrives as a proactive message. " +
  "Relay each tool's text to the user faithfully.";

export type RpcPayload =
  | { jsonrpc: "2.0"; id: unknown; result: unknown }
  | { jsonrpc: "2.0"; id: unknown; error: { code: number; message: string } };

export interface RpcDeps {
  /** Build the per-call tool context for the resolved user. */
  makeToolContext: (userId: string) => ToolContext;
  /** Override config.mcpAuthEnforce (tests). */
  enforceAuth?: boolean;
}

function rpcError(id: unknown, code: number, message: string): RpcPayload {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolList() {
  return {
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

/**
 * Transport-agnostic JSON-RPC dispatcher. Returns the response payload, or
 * `null` for notifications (the HTTP layer answers those 202 with no body).
 * No SDK: the surface is small (initialize / ping / tools.list / tools.call +
 * notifications) and a hand-rolled handler is stateless-serverless-friendly
 * and exactly what Poke's client speaks — the same choice the bridge made.
 */
export async function handleRpc(
  msg: any,
  auth: AuthContext,
  deps: RpcDeps,
): Promise<RpcPayload | null> {
  const id = msg?.id ?? null;
  const method = msg?.method as string | undefined;
  const params = msg?.params;
  const enforce = deps.enforceAuth ?? config.mcpAuthEnforce;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };
    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notification → 202, no body
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: toolList() };
    case "tools/call": {
      const name = params?.name;
      const tool = typeof name === "string" ? findTool(name) : undefined;
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
      if (tool.requiresAuth && !isAuthorized(auth, enforce)) {
        return rpcError(id, -32001, `unauthorized: tool '${name}' requires authentication`);
      }
      const parsed = tool.zod.safeParse(params?.arguments ?? {});
      if (!parsed.success) {
        const why = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        return rpcError(id, -32602, `Invalid arguments for '${name}': ${why}`);
      }
      try {
        const result = await tool.handler(parsed.data, deps.makeToolContext(auth.userId));
        const content = [{ type: "text", text: result.text }];
        return {
          jsonrpc: "2.0",
          id,
          result: result.data ? { content, structuredContent: result.data } : { content },
        };
      } catch (e) {
        return rpcError(id, -32603, String((e as Error)?.message ?? e));
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${String(method)}`);
  }
}
