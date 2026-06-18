import type { Step } from "../durable/step";
import type { Model } from "../model/types";
import { PANEL, SYNTH_SYSTEM, type Persona } from "./personas";
import { runWorker, type Position } from "./worker";

export interface CouncilInput {
  question: string;
  personaModel: string;
  synthModel: string;
  /** Defaults to PANEL; injectable for tests. */
  panel?: Persona[];
}

export interface CouncilResult {
  question: string;
  positions: Position[];
  synthesis: string;
}

/** Render the panel's positions into the synthesizer's prompt. */
export function renderSynthPrompt(question: string, positions: Position[]): string {
  const body = positions.map((p) => `## ${p.name}\n${p.text}`).join("\n\n");
  return `Question: ${question}\n\nThe council's positions:\n\n${body}\n\nNow synthesize.`;
}

/**
 * Fan out to each persona as its own durable step, then synthesize under a
 * final step. Written against the Step port: durable+parallel under Inngest,
 * memoized under LocalStep — the logic is identical either way.
 */
export async function runCouncil(
  step: Step,
  model: Model,
  input: CouncilInput,
): Promise<CouncilResult> {
  const panel = input.panel ?? PANEL;

  const positions = await Promise.all(
    panel.map((p) =>
      step.run(`persona:${p.key}`, () => runWorker(model, input.personaModel, p, input.question)),
    ),
  );

  const synthesis = await step.run("synth", () =>
    model.complete({
      system: SYNTH_SYSTEM,
      prompt: renderSynthPrompt(input.question, positions),
      model: input.synthModel,
      maxTokens: 600,
    }),
  );

  return { question: input.question, positions, synthesis };
}
