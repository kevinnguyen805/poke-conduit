import type { Step } from "../durable/step";
import { newId } from "../ids";
import type { Model } from "../model/types";
import type { Store } from "../store/types";
import { runCouncil, type CouncilResult } from "./council";

export interface OrchestrateInput {
  user_id: string;
  question: string;
  personaModel: string;
  synthModel: string;
  /** Pre-allocated run id (the MCP handler returns it before the work runs). */
  runId?: string;
}

export interface CouncilJob {
  runId: string;
  result: CouncilResult;
}

/**
 * A council run with a durable lifecycle:
 *   createRun(running) → fan-out + synth (steps) → finishRun(done, output)
 *
 * `createRun` is guarded by a lookup so it is safe whether the run row was
 * pre-created by the MCP handler (async delivery) or not (inline/demo). The
 * `finishRun` CAS makes the finalize idempotent across replays.
 */
export async function runCouncilJob(
  store: Store,
  step: Step,
  model: Model,
  input: OrchestrateInput,
): Promise<CouncilJob> {
  const runId = input.runId ?? newId("run");

  await step.run("create-run", async () => {
    const existing = await store.getRun(input.user_id, runId);
    if (!existing) {
      await store.createRun({
        id: runId,
        user_id: input.user_id,
        kind: "council",
        input: JSON.stringify({ question: input.question }),
      });
    }
  });

  const result = await runCouncil(step, model, {
    question: input.question,
    personaModel: input.personaModel,
    synthModel: input.synthModel,
  });

  await step.run("finish-run", () => store.finishRun(runId, JSON.stringify(result)));

  return { runId, result };
}
