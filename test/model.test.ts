import { describe, expect, it } from "vitest";
import { ClaudeModel } from "../src/model/claude";
import { makeModel, modelMode } from "../src/model/index";
import { MockModel } from "../src/model/mock";
import type { CompleteRequest } from "../src/model/types";

const req = (over: Partial<CompleteRequest> = {}): CompleteRequest => ({
  prompt: "Should we ship the council on Friday?",
  model: "claude-haiku-4-5-20251001",
  ...over,
});

describe("MockModel", () => {
  it("is deterministic: same request → identical output", async () => {
    const m = new MockModel();
    const a = await m.complete(req({ system: "You are the Skeptic." }));
    const b = await m.complete(req({ system: "You are the Skeptic." }));
    expect(a).toBe(b);
  });

  it("distinct system prompts → distinct outputs (fan-out is assertable)", async () => {
    const m = new MockModel();
    const skeptic = await m.complete(req({ system: "You are the Skeptic." }));
    const builder = await m.complete(req({ system: "You are the Builder." }));
    expect(skeptic).not.toBe(builder);
  });

  it("distinct prompts → distinct outputs", async () => {
    const m = new MockModel();
    const x = await m.complete(req({ prompt: "ship?" }));
    const y = await m.complete(req({ prompt: "delay?" }));
    expect(x).not.toBe(y);
  });

  it("echoes the model id so tiering is visible", async () => {
    const m = new MockModel();
    const out = await m.complete(req({ model: "claude-fable-5" }));
    expect(out).toContain("claude-fable-5");
  });

  it("a scripted responder overrides the default", async () => {
    const m = new MockModel((r) => `SCRIPTED:${r.model}`);
    expect(await m.complete(req())).toBe("SCRIPTED:claude-haiku-4-5-20251001");
  });
});

describe("ClaudeModel", () => {
  it("constructs with a key without performing any network call", () => {
    const m = new ClaudeModel("sk-ant-test-key");
    expect(m).toBeInstanceOf(ClaudeModel);
    expect(typeof m.complete).toBe("function");
  });
});

describe("makeModel / modelMode", () => {
  it("returns a usable Model and a consistent mode", () => {
    const m = makeModel();
    expect(typeof m.complete).toBe("function");
    const mode = modelMode();
    expect(["claude", "mock"]).toContain(mode);
    // The factory's choice must agree with the reported mode.
    expect(m instanceof MockModel).toBe(mode === "mock");
  });
});
