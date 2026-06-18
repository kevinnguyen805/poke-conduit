import type { z } from "zod";
import type { Step } from "../durable/step";
import type { Model } from "../model/types";
import type { PokeClient } from "../poke/index";
import type { Store } from "../store/types";

/** Minimal JSON Schema we hand to Poke in tools/list (discovery only). */
export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

/** Everything a tool handler needs. Injected per-request by the MCP server. */
export interface ToolContext {
  store: Store;
  model: Model;
  /** Fresh durable Step per council run (LocalStep inline; Inngest in prod). */
  makeStep: () => Step;
  poke: PokeClient;
  /** The calling user (x-poke-user-id), or "anonymous". */
  userId: string;
  personaModel: string;
  synthModel: string;
  /**
   * Lets a tool run work after responding (async council push). In a
   * long-lived process this truly backgrounds; on serverless the platform may
   * freeze it, so async delivery is best-effort unless Inngest is wired.
   */
  background: (label: string, fn: () => Promise<void>) => void;
}

export interface ToolResult {
  /** Human-facing text Poke relays to the user. */
  text: string;
  /** Optional structured payload for clients that consume it. */
  data?: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Runtime validation; the parsed value is passed to the handler. */
  zod: z.ZodTypeAny;
  /** Data tools (touch user data) require auth when enforcement is on. */
  requiresAuth: boolean;
  handler: (args: any, ctx: ToolContext) => Promise<ToolResult>;
}
