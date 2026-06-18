/** The one capability the agents need from an LLM: a single-turn completion. */
export interface CompleteRequest {
  /** Optional system prompt — the persona identity or synthesis instruction. */
  system?: string;
  /** The user turn. */
  prompt: string;
  /** Model id (config.personaModel for workers, config.synthModel for synthesis). */
  model: string;
  /** Output cap; defaults to 1024 in the Claude impl. */
  maxTokens?: number;
}

export interface Model {
  complete(req: CompleteRequest): Promise<string>;
}
