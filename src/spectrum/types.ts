import type { RateLimiter } from "../http/ratelimit";
import type { Store } from "../store/types";
import type { ToolContext, ToolDef } from "../tools/types";

/** Inbound content variants we handle (structural subset of the SDK union). */
export type InboundContent =
  | { type: "text"; text: string }
  | { type: "poll_option"; option: string }
  | { type: string; [k: string]: unknown };

/** Structural subset of spectrum-ts `Message` — only what we touch. `any` params keep the real SDK type assignable. */
export interface MessageLike {
  content: InboundContent;
  sender?: { id?: string };
  react(reaction: string): Promise<any>;
}

/** Structural subset of spectrum-ts `Space`. */
export interface SpaceLike {
  id: string;
  type?: "dm" | "group";
  send(content: any): Promise<any>;
}

/** Transport-agnostic content factories (real wraps the SDK; tagPayloads fakes for tests). */
export interface SpectrumPayloads {
  text(s: string): unknown;
  effect(s: string, effect: string): unknown;
  poll(title: string, options: string[]): unknown;
}

/** A native-poll request a tool can emit via ToolResult.data.poll. */
export interface PollSpec {
  title: string;
  options: string[];
}

/** One turn of stored conversation memory. */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/** The router's decision for one inbound turn. */
export interface RouteDecision {
  kind: "tool" | "reply";
  name?: string;
  arguments?: Record<string, unknown>;
  text?: string;
}

/** Minimal router contract — injectable so tests use a deterministic mock. */
export interface RouterModel {
  decide(input: { system: string; messages: ChatTurn[]; tools: ToolDef[] }): Promise<RouteDecision>;
}

/** Everything `handleInbound` needs — all injectable. */
export interface SpectrumDeps {
  store: Store;
  tools: ToolDef[];
  makeToolContext: (userId: string) => ToolContext;
  router: RouterModel;
  payloads: SpectrumPayloads;
  rateLimiter: RateLimiter;
  rateMax: number;
  rateWindowSec: number;
}
