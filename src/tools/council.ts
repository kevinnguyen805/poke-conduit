import { z } from "zod";
import { runAndDeliverCouncil, runCouncilJob } from "../agents/orchestrator";
import { newId } from "../ids";
import { renderCouncil, renderCouncilQueued, renderRunStatus } from "../render";
import type { AsyncCouncilJob, ToolDef } from "./types";

const askCouncil: ToolDef = {
  name: "ask_council",
  description:
    "Convene a multi-agent council (Builder, Skeptic, Operator, User-Advocate, Strategist, Pragmatist) to deliberate a hard, open-ended, or high-stakes question and return a synthesized recommendation. Use for judgement calls and trade-offs — not for simple factual lookups. deliver='return' waits and replies inline; deliver='async' returns immediately and the verdict is pushed to the user when ready.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "the question or decision to deliberate" },
      deliver: {
        type: "string",
        enum: ["return", "async"],
        description: "'return' (default) waits for the verdict; 'async' replies later via a proactive push",
      },
    },
    required: ["question"],
  },
  zod: z.object({
    question: z.string().min(1),
    deliver: z.enum(["return", "async"]).optional(),
  }),
  requiresAuth: true,
  async handler(args, ctx) {
    const deliver = args.deliver ?? "return";

    if (deliver === "async") {
      const runId = newId("run");
      await ctx.store.createRun({
        id: runId,
        user_id: ctx.userId,
        kind: "council",
        input: JSON.stringify({ question: args.question }),
      });
      const job: AsyncCouncilJob = {
        user_id: ctx.userId,
        runId,
        question: args.question,
        personaModel: ctx.personaModel,
        synthModel: ctx.synthModel,
      };
      // Prefer a durable dispatcher (Inngest) when wired; otherwise run the same
      // executor in-process via `background` (best-effort across serverless freezes).
      const durable = ctx.dispatchAsyncCouncil ? await ctx.dispatchAsyncCouncil(job) : false;
      if (!durable) {
        ctx.background(`council:${runId}`, () =>
          runAndDeliverCouncil(
            { store: ctx.store, step: ctx.makeStep(), model: ctx.model, poke: ctx.poke },
            job,
          ),
        );
      }
      return { text: renderCouncilQueued(runId), data: { run_id: runId, durable } };
    }

    const { runId, result } = await runCouncilJob(ctx.store, ctx.makeStep(), ctx.model, {
      user_id: ctx.userId,
      question: args.question,
      personaModel: ctx.personaModel,
      synthModel: ctx.synthModel,
    });
    return { text: renderCouncil(result), data: { run_id: runId } };
  },
};

const councilStatus: ToolDef = {
  name: "council_status",
  description:
    "Check on an async council run by its run id and return the verdict if ready. Only call when the user asks about a council you told them you'd report back on.",
  inputSchema: {
    type: "object",
    properties: { run_id: { type: "string", description: "the run id from ask_council" } },
    required: ["run_id"],
  },
  zod: z.object({ run_id: z.string().min(1) }),
  requiresAuth: true,
  async handler(args, ctx) {
    const run = await ctx.store.getRun(ctx.userId, args.run_id);
    if (!run) return { text: `I don't have a council run with id "${args.run_id}".` };
    return { text: renderRunStatus(run), data: { status: run.status } };
  },
};

export const councilTools: ToolDef[] = [askCouncil, councilStatus];
