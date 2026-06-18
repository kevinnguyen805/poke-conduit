import { describe, expect, it } from "vitest";
import { LocalStep, fromInngestStep } from "../src/durable/step";

describe("LocalStep", () => {
  it("runs fn and returns its value", async () => {
    const step = new LocalStep();
    expect(await step.run("a", async () => 21 * 2)).toBe(42);
  });

  it("runs a given id at most once; replays return the first result", async () => {
    const step = new LocalStep();
    let calls = 0;
    const fn = async () => {
      calls++;
      return calls; // would change if re-invoked
    };
    const first = await step.run("once", fn);
    const second = await step.run("once", fn);
    expect(first).toBe(1);
    expect(second).toBe(1); // cached, not re-run
    expect(calls).toBe(1);
  });

  it("distinct ids run independently", async () => {
    const step = new LocalStep();
    expect(await step.run("x", async () => "X")).toBe("X");
    expect(await step.run("y", async () => "Y")).toBe("Y");
  });

  it("concurrent calls with the same id share one execution", async () => {
    const step = new LocalStep();
    let calls = 0;
    const slow = () =>
      step.run("shared", async () => {
        calls++;
        await Promise.resolve();
        return calls;
      });
    const [a, b] = await Promise.all([slow(), slow()]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });
});

describe("fromInngestStep", () => {
  it("delegates run() to the wrapped step object", async () => {
    const seen: string[] = [];
    const fake = {
      run<T>(id: string, fn: () => Promise<T>): Promise<T> {
        seen.push(id);
        return fn();
      },
    };
    const step = fromInngestStep(fake);
    expect(await step.run("council:synth", async () => "ok")).toBe("ok");
    expect(seen).toEqual(["council:synth"]);
  });
});
