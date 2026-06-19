import type { Step } from "../durable/step";
import { newId } from "../ids";
import type { Model } from "../model/types";
import type { PokeClient } from "../poke/index";
import type { Store } from "../store/types";
import type { AsyncCouncilJob } from "../tools/types";
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

/** What `runAndDeliverCouncil` needs to execute a council run and deliver it. */
export interface CouncilDeliveryDeps {
  store: Store;
  step: Step;
  model: Model;
  poke: PokeClient;
}

/**
 * Run a council job to completion and push the verdict back through Poke. This
 * is the single executor shared by BOTH async paths — the inline `background`
 * fallback and the Inngest function — so durable and best-effort delivery stay
 * byte-identical. The push is wrapped in its own `step.run("deliver", …)` so an
 * Inngest replay never double-sends. On failure the run is marked errored; this
 * function never throws (the caller is fire-and-forget or an Inngest handler).
 */
export async function runAndDeliverCouncil(
  deps: CouncilDeliveryDeps,
  job: AsyncCouncilJob,
): Promise<void> {
  try {
    const { result } = await runCouncilJob(deps.store, deps.step, deps.model, {
      user_id: job.user_id,
      question: job.question,
      personaModel: job.personaModel,
      synthModel: job.synthModel,
      runId: job.runId,
    });
    await deps.step.run("deliver", async () => {
      await deps.poke.push(
        `Here's the council's verdict on "${job.question}":\n\n${result.synthesis}`,
      );
    });
  } catch (e) {
    await deps.store.errorRun(
      job.runId,
      JSON.stringify({ error: String((e as Error)?.message ?? e) }),
    );
  }
}
