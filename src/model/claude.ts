import Anthropic from "@anthropic-ai/sdk";
import type { CompleteRequest, Model } from "./types";

/**
 * Real Claude via the Messages API (SDK 0.74). Thin on purpose: retries and
 * durability are the durable-step layer's job (Inngest in prod), not the
 * model's. A transient API error surfaces to the caller, which records the
 * run as errored.
 */
export class ClaudeModel implements Model {
  private client: Anthropic;
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(req: CompleteRequest): Promise<string> {
    const res = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      ...(req.system ? { system: req.system } : {}),
      messages: [{ role: "user", content: req.prompt }],
    });
    let out = "";
    for (const block of res.content) {
      if (block.type === "text") out += block.text; // discriminated-union narrowing → typed
    }
    return out.trim();
  }
}
