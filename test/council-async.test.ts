import { describe, expect, it, vi } from "vitest";
import { runAndDeliverCouncil } from "../src/agents/orchestrator";
import {
  dispatchCouncilViaInngest,
  isInngestConfigured,
} from "../src/durable/inngest";
import { LocalStep } from "../src/durable/step";
import { MockModel } from "../src/model/mock";
import { MockPokeClient } from "../src/poke/index";
import { makePgMemStore } from "../src/store/pgmem";
import { findTool } from "../src/tools/index";
import type { AsyncCouncilJob, ToolContext, ToolResult } from "../src/tools/types";

/** A live tool context whose async-council dispatcher is injectable, plus a
 *  deferring `background` so the inline fallback is awaitable via `drain()`. */
async function setup(opts: { dispatch?: ToolContext["dispatchAsyncCouncil"] } = {}) {
  const store = await makePgMemStore();
  await store.init();
  const poke = new MockPokeClient();
  const bg: Promise<void>[] = [];
  const ctx: ToolContext = {
    store,
    model: new MockModel(),
    poke,
    makeStep: () => new LocalStep(),
    userId: "u_async",
    personaModel: "persona-model",
    synthModel: "synth-model",
    background: (_label, fn) => {
      bg.push(fn());
    },
    dispatchAsyncCouncil: opts.dispatch,
  };
  const call = (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> => {
    const tool = findTool(name);
    if (!tool) throw new Error(`no such tool: ${name}`);
    return tool.handler(args, ctx);
  };
  const drain = (): Promise<unknown> => Promise.all(bg);
  return { store, poke, ctx, call, drain, bg };
}

describe("async council — inline fallback (no dispatcher)", () => {
  it("backgrounds the run, pushes the verdict, and reports durable=false", async () => {
    const { call, store, poke, drain, bg } = await setup();
    const res = await call("ask_council", { question: "Inline path?", deliver: "async" });

    expect(res.text).toContain("convening the council");
    expect(res.data?.durable).toBe(false);
    expect(bg.length).toBe(1); // inline work was scheduled
    expect(poke.pushes.length).toBe(0); // deferred — nothing sent yet

    await drain();

    expect(poke.pushes.length).toBe(1);
    expect(poke.pushes[0]).toContain("Inline path?");
    const run = await store.getRun("u_async", res.data?.run_id as string);
    expect(run?.status).toBe("done");
  });
});

describe("async council — durable dispatcher wired", () => {
  it("hands off to the dispatcher, skips inline, and reports durable=true", async () => {
    const jobs: AsyncCouncilJob[] = [];
    const { call, store, poke, drain, bg } = await setup({
      dispatch: async (job) => {
        jobs.push(job);
        return true;
      },
    });
    const res = await call("ask_council", { question: "Durable path?", deliver: "async" });

    expect(res.data?.durable).toBe(true);
    expect(bg.length).toBe(0); // inline path NOT scheduled
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.question).toBe("Durable path?");
    expect(jobs[0]?.runId).toBe(res.data?.run_id); // same run id we returned
    expect(jobs[0]?.user_id).toBe("u_async");
    expect(jobs[0]?.personaModel).toBe("persona-model");
    expect(jobs[0]?.synthModel).toBe("synth-model");

    await drain(); // nothing deferred — the stub never executed the job
    expect(poke.pushes.length).toBe(0);

    // The run row was created before hand-off and is still in flight; the real
    // Inngest worker would finish it (observable later via council_status).
    const run = await store.getRun("u_async", res.data?.run_id as string);
    expect(run?.status).toBe("running");
  });

  it("falls back to inline when the dispatcher declines (returns false)", async () => {
    const { call, store, poke, drain, bg } = await setup({ dispatch: async () => false });
    const res = await call("ask_council", { question: "Decline path?", deliver: "async" });

    expect(res.data?.durable).toBe(false);
    expect(bg.length).toBe(1); // inline scheduled as fallback

    await drain();

    expect(poke.pushes.length).toBe(1);
    expect(poke.pushes[0]).toContain("Decline path?");
    const run = await store.getRun("u_async", res.data?.run_id as string);
    expect(run?.status).toBe("done");
  });
});

describe("runAndDeliverCouncil (shared executor for both async paths)", () => {
  function job(over: Partial<AsyncCouncilJob> = {}): AsyncCouncilJob {
    return {
      user_id: "u_exec",
      runId: "run_exec_ok",
      question: "Execute me?",
      personaModel: "persona-model",
      synthModel: "synth-model",
      ...over,
    };
  }

  it("runs the council, finishes the run, and pushes the verdict", async () => {
    const store = await makePgMemStore();
    await store.init();
    const poke = new MockPokeClient();

    await runAndDeliverCouncil(
      { store, step: new LocalStep(), model: new MockModel(), poke },
      job(),
    );

    expect(poke.pushes.length).toBe(1);
    expect(poke.pushes[0]).toContain("Execute me?");
    const run = await store.getRun("u_exec", "run_exec_ok");
    expect(run?.status).toBe("done");
  });

  it("marks the run errored and pushes nothing when the model throws", async () => {
    const store = await makePgMemStore();
    await store.init();
    const poke = new MockPokeClient();
    const boom = new MockModel(() => {
      throw new Error("model down");
    });

    await runAndDeliverCouncil(
      { store, step: new LocalStep(), model: boom, poke },
      job({ runId: "run_exec_err" }),
    );

    expect(poke.pushes.length).toBe(0); // failure → never delivered
    const run = await store.getRun("u_exec", "run_exec_err");
    expect(run?.status).toBe("error");
  });
});

describe("isInngestConfigured", () => {
  it("reflects the INNGEST_EVENT_KEY env var", () => {
    const saved = process.env.INNGEST_EVENT_KEY;
    try {
      delete process.env.INNGEST_EVENT_KEY;
      expect(isInngestConfigured()).toBe(false);
      process.env.INNGEST_EVENT_KEY = "evt_test";
      expect(isInngestConfigured()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.INNGEST_EVENT_KEY;
      else process.env.INNGEST_EVENT_KEY = saved;
    }
  });
});

describe("dispatchCouncilViaInngest", () => {
  const sampleJob: AsyncCouncilJob = {
    user_id: "u_x",
    runId: "run_x",
    question: "Q?",
    personaModel: "p",
    synthModel: "s",
  };

  it("returns false fast when unconfigured (no import attempted)", async () => {
    const saved = process.env.INNGEST_EVENT_KEY;
    try {
      delete process.env.INNGEST_EVENT_KEY;
      expect(await dispatchCouncilViaInngest(sampleJob)).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.INNGEST_EVENT_KEY;
      else process.env.INNGEST_EVENT_KEY = saved;
    }
  });

  it("returns false when configured but the inngest package is absent", async () => {
    const saved = process.env.INNGEST_EVENT_KEY;
    // The dynamic import throws (inngest is intentionally NOT a dependency); the
    // dispatcher logs once and swallows it. Silence + assert that single log.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      process.env.INNGEST_EVENT_KEY = "evt_test";
      expect(await dispatchCouncilViaInngest(sampleJob)).toBe(false);
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
      if (saved === undefined) delete process.env.INNGEST_EVENT_KEY;
      else process.env.INNGEST_EVENT_KEY = saved;
    }
  });
});
