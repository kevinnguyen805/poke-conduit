import type { Model } from "../model/types";
import type { Persona } from "./personas";

/** One persona's contribution to the council. */
export interface Position {
  persona: string; // persona.key
  name: string; // persona.name
  text: string;
}

/** Run a single persona worker-agent against the question. */
export async function runWorker(
  model: Model,
  modelId: string,
  persona: Persona,
  question: string,
): Promise<Position> {
  const text = await model.complete({
    system: persona.system,
    prompt: `Question: ${question}\n\nGive your position in 2-3 sentences. State your single most important reason.`,
    model: modelId,
    maxTokens: 400,
  });
  return { persona: persona.key, name: persona.name, text };
}
