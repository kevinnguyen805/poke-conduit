import { config } from "../config";
import { ClaudeModel } from "./claude";
import { MockModel } from "./mock";
import type { Model } from "./types";

export type { CompleteRequest, Model } from "./types";
export { MockModel } from "./mock";
export { ClaudeModel } from "./claude";

export type ModelMode = "claude" | "mock";

/** "claude" when ANTHROPIC_API_KEY is set, else "mock". */
export function modelMode(): ModelMode {
  return config.anthropicApiKey ? "claude" : "mock";
}

/**
 * Real Claude when ANTHROPIC_API_KEY is present, else the deterministic
 * MockModel — so tests and the demo run with zero credentials.
 */
export function makeModel(): Model {
  return config.anthropicApiKey ? new ClaudeModel(config.anthropicApiKey) : new MockModel();
}
