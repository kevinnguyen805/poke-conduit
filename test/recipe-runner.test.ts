import { describe, expect, it } from "vitest";
import { LocalStep } from "../src/durable/step";
import { MockModel } from "../src/model/mock";
import { MockPokeClient } from "../src/poke/index";
import { makePgMemStore } from "../src/store/pgmem";
import {
  MAX_RECIPE_STEPS,
  runnableToolNames,
  runRecipeSteps,
  validateSteps,
  type RecipeStep,
} from "../src/tools/recipe-runner";
import type { ToolContext } from "../src/tools/types";

async function ctx(): Promise<{ ctx: ToolContext; store: Awaited<ReturnType<typeof makePgMemStore>> }> {
  const store = await makePgMemStore();
  await store.init();
  const toolCtx: ToolContext = {
    store,
    model: new MockModel(),
    poke: new MockPokeClient(),
    makeStep: () => new LocalStep(),
    userId: "u_runner",
    personaModel: "persona-model",
    synthModel: "synth-model",
    background: (_l, fn) => {
      void fn();
    },
  };
  return { ctx: toolCtx, store };
}

describe("runnableToolNames", () => {
  it("exposes the data tools but never the recipe tools (no recursion)", () => {
    const names = runnableToolNames();
    expect(names).toContain("add_note");
    expect(names).toContain("ask_council");
    expect(names).toContain("set_status");
    expect(names).not.toContain("run_recipe");
    expect(names).not.toContain("install_recipe");
    expect(names).not.toContain("list_recipes");
  });
});

describe("validateSteps", () => {
  it("accepts a well-formed macro of known tools", () => {
    const res = validateSteps(
      JSON.stringify([
        { tool: "set_status", args: { status: "dnd" } },
        { tool: "add_note", args: { text: "hi" } },
      ]),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.steps.length).toBe(2);
  });

  it("defaults a missing args object to {}", () => {
    const res = validateSteps(JSON.stringify([{ tool: "list_backlog" }]));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.steps[0]).toEqual({ tool: "list_backlog", args: {} });
  });

  it("rejects non-JSON", () => {
    const res = validateSteps("definitely not json");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("not valid JSON");
  });

  it("rejects a non-array payload", () => {
    const res = validateSteps(JSON.stringify({ tool: "add_note" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("must be a JSON array");
  });

  it("rejects more than the step cap", () => {
    const many = Array.from({ length: MAX_RECIPE_STEPS + 1 }, () => ({
      tool: "list_backlog",
      args: {},
    }));
    const res = validateSteps(JSON.stringify(many));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("at most");
  });

  it("rejects an unknown tool — and rejects recipe tools too (anti-recursion)", () => {
    expect(validateSteps(JSON.stringify([{ tool: "nope", args: {} }])).ok).toBe(false);
    const recursive = validateSteps(JSON.stringify([{ tool: "run_recipe", args: { name: "x" } }]));
    expect(recursive.ok).toBe(false);
    if (!recursive.ok) expect(recursive.error).toContain("unknown tool");
  });

  it("rejects a step missing its tool name", () => {
    const res = validateSteps(JSON.stringify([{ args: { text: "x" } }]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("missing a");
  });

  it("rejects args that fail the target tool's own schema", () => {
    const res = validateSteps(JSON.stringify([{ tool: "add_note", args: {} }]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("invalid args");
  });
});

describe("runRecipeSteps", () => {
  it("runs steps in order with real side effects", async () => {
    const { ctx: c, store } = await ctx();
    const steps: RecipeStep[] = [
      { tool: "add_note", args: { text: "one" } },
      { tool: "add_note", args: { text: "two" } },
    ];
    const outcomes = await runRecipeSteps(steps, c);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    const open = await store.listBacklog("u_runner", "open");
    expect(open.map((i) => i.text)).toEqual(["one", "two"]);
  });

  it("stops at the first throwing step and does not run the rest", async () => {
    const { ctx: c, store } = await ctx();
    // The middle step has invalid args; reaching the executor (bypassing
    // validateSteps) makes its zod.parse throw, which must halt the chain.
    const steps: RecipeStep[] = [
      { tool: "add_note", args: { text: "good" } },
      { tool: "add_note", args: {} },
      { tool: "add_note", args: { text: "never" } },
    ];
    const outcomes = await runRecipeSteps(steps, c);
    expect(outcomes.length).toBe(2);
    expect(outcomes[0]?.ok).toBe(true);
    expect(outcomes[1]?.ok).toBe(false);
    const open = await store.listBacklog("u_runner", "open");
    expect(open.map((i) => i.text)).toEqual(["good"]); // third never ran
  });
});
