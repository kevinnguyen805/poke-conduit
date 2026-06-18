import { beforeEach, describe, expect, it } from "vitest";
import { runCouncil } from "../src/agents/council";
import { runCouncilJob } from "../src/agents/orchestrator";
import { PANEL } from "../src/agents/personas";
import { LocalStep } from "../src/durable/step";
import { MockModel } from "../src/model/mock";
import type { CompleteRequest } from "../src/model/types";
import { makePgMemStore } from "../src/store/pgmem";
import type { Store } from "../src/store/types";

const PERSONA_MODEL = "claude-haiku-4-5-20251001";
const SYNTH_MODEL = "claude-fable-5";
const Q = "Should we ship the council sync or async?";

const input = () => ({ question: Q, personaModel: PERSONA_MODEL, synthModel: SYNTH_MODEL });

describe("runCouncil", () => {
  it("produces one position per panel member plus a synthesis", async () => {
    const res = await runCouncil(new LocalStep(), new MockModel(), input());
    expect(res.positions.map((p) => p.persona)).toEqual(PANEL.map((p) => p.key));
    expect(res.positions.length).toBe(PANEL.length);
    expect(res.synthesis.length).toBeGreaterThan(0);
    expect(res.question).toBe(Q);
  });

  it("personas produce distinct positions", async () => {
    const res = await runCouncil(new LocalStep(), new MockModel(), input());
    const texts = new Set(res.positions.map((p) => p.text));
    expect(texts.size).toBe(PANEL.length); // all different
  });

  it("is deterministic across independent runs (offline)", async () => {
    const a = await runCouncil(new LocalStep(), new MockModel(), input());
    const b = await runCouncil(new LocalStep(), new MockModel(), input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("memoizes per-id steps: reusing a LocalStep does not re-run agents", async () => {
    let calls = 0;
    const model = new MockModel((r: CompleteRequest) => {
      calls++;
      return `${r.model}:${(r.system ?? "").slice(0, 12)}`;
    });
    const step = new LocalStep();
    await runCouncil(step, model, input());
    await runCouncil(step, model, input()); // same step → all cached
    expect(calls).toBe(PANEL.length + 1); // N personas + 1 synth, once total
  });

  it("feeds every persona's position into the synthesizer", async () => {
    const reqs: CompleteRequest[] = [];
    const model = new MockModel((r: CompleteRequest) => {
      reqs.push(r);
      return `POSITION(${(r.system ?? "").split(" ")[3] ?? "?"})`;
    });
    await runCouncil(new LocalStep(), model, input());

    const synthReq = reqs.find((r) => r.model === SYNTH_MODEL);
    expect(synthReq).toBeDefined();
    for (const p of PANEL) {
      expect(synthReq?.prompt).toContain(p.name); // each persona named in the synth prompt
    }
  });
});

describe("runCouncilJob (durable lifecycle)", () => {
  const U = "user_abc";
  let store: Store;
  beforeEach(async () => {
    store = await makePgMemStore();
    await store.init();
  });

  it("creates a run, finishes it done, and persists the result", async () => {
    const { runId, result } = await runCouncilJob(store, new LocalStep(), new MockModel(), {
      user_id: U,
      ...input(),
    });

    const run = await store.getRun(U, runId);
    expect(run?.status).toBe("done");
    expect(run?.finished_at).toBeTruthy();
    expect(JSON.parse(run?.output ?? "{}")).toEqual(result);
    expect(JSON.parse(run?.input ?? "{}")).toEqual({ question: Q });
  });

  it("is idempotent: re-running with the same runId does not overwrite the result", async () => {
    const first = await runCouncilJob(store, new LocalStep(), new MockModel(), {
      user_id: U,
      runId: "run_fixed",
      ...input(),
    });
    const savedOutput = (await store.getRun(U, "run_fixed"))?.output;

    // Fresh step → recompute, but the run row is already done.
    const second = await runCouncilJob(store, new LocalStep(), new MockModel(), {
      user_id: U,
      runId: "run_fixed",
      ...input(),
    });

    expect(second.runId).toBe("run_fixed");
    expect(JSON.stringify(second.result)).toBe(JSON.stringify(first.result)); // deterministic
    const run = await store.getRun(U, "run_fixed");
    expect(run?.status).toBe("done");
    expect(run?.output).toBe(savedOutput); // CAS rejected the second finalize
  });
});
