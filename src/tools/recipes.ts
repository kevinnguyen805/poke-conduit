import { z } from "zod";
import { renderRecipeInstalled, renderRecipeRun, renderRecipes } from "../render";
import { runRecipeSteps, runnableToolNames, validateSteps } from "./recipe-runner";
import type { ToolDef } from "./types";

const listRecipes: ToolDef = {
  name: "list_recipes",
  description:
    "List the user's installed recipes (saved multi-step routines). Only call when the user asks what recipes or routines they have.",
  inputSchema: { type: "object", properties: {} },
  zod: z.object({}),
  requiresAuth: true,
  async handler(_args, ctx) {
    const recipes = await ctx.store.listRecipes(ctx.userId);
    return { text: renderRecipes(recipes), data: { count: recipes.length } };
  },
};

const installRecipe: ToolDef = {
  name: "install_recipe",
  description:
    "Save a reusable recipe (a named routine). A recipe can carry a free-text `prompt` and/or an executable `steps` macro: a JSON array of { tool, args } that run_recipe runs in order. Only call when the user asks to create, save, or install a routine/recipe.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "short recipe name" },
      prompt: { type: "string", description: "what the recipe should do when run (free text)" },
      integrations: { type: "string", description: "optional JSON array of integration names" },
      steps: {
        type: "string",
        description: `optional JSON array of executable steps, each { "tool": <name>, "args": {…} }. Runnable tools: ${runnableToolNames().join(", ")}.`,
      },
    },
    required: ["name"],
  },
  zod: z.object({
    name: z.string().min(1),
    prompt: z.string().optional(),
    integrations: z.string().optional(),
    steps: z.string().optional(),
  }),
  requiresAuth: true,
  async handler(args, ctx) {
    // Validate an executable macro up front so a broken recipe is never saved.
    let steps: string | undefined;
    if (args.steps !== undefined) {
      const v = validateSteps(args.steps);
      if (!v.ok) return { text: `I couldn't save "${args.name}" — ${v.error}` };
      steps = JSON.stringify(v.steps); // store the normalized form
    }
    const recipe = await ctx.store.installRecipe({
      user_id: ctx.userId,
      name: args.name,
      ...(args.prompt ? { prompt: args.prompt } : {}),
      ...(args.integrations ? { integrations: args.integrations } : {}),
      ...(steps ? { steps } : {}),
    });
    return { text: renderRecipeInstalled(recipe), data: { id: recipe.id } };
  },
};

const runRecipe: ToolDef = {
  name: "run_recipe",
  description:
    "Run a saved recipe by name. If it has an executable `steps` macro, each step is dispatched through the matching conduit tool in order and a per-step result is returned. If it is prompt-only, the recipe's instruction is pushed back through Poke to act on. Only call when the user asks to run, start, or trigger a named routine/recipe.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string", description: "the recipe name to run" } },
    required: ["name"],
  },
  zod: z.object({ name: z.string().min(1) }),
  requiresAuth: true,
  async handler(args, ctx) {
    const recipe = await ctx.store.getRecipe(ctx.userId, args.name);
    if (!recipe) return { text: `I couldn't find a recipe called "${args.name}".` };
    if (!recipe.enabled) return { text: `Your "${recipe.name}" recipe is turned off.` };

    const v = validateSteps(recipe.steps);
    if (v.ok && v.steps.length > 0) {
      const outcomes = await runRecipeSteps(v.steps, ctx);
      const ranOk = outcomes.every((o) => o.ok);
      return {
        text: renderRecipeRun(recipe.name, outcomes, v.steps.length),
        data: { ran: outcomes.length, planned: v.steps.length, ok: ranOk },
      };
    }

    // No executable steps — fall back to the free-text prompt via Poke.
    if (recipe.prompt) {
      await ctx.poke.push(`Run my "${recipe.name}" routine: ${recipe.prompt}`);
      return {
        text: `▶️ Running your "${recipe.name}" routine.`,
        data: { ran: 0, planned: 0, pushed: true },
      };
    }

    if (!v.ok) return { text: `Your "${recipe.name}" recipe couldn't run — ${v.error}` };
    return { text: `Your "${recipe.name}" recipe has nothing to run yet.` };
  },
};

export const recipeTools: ToolDef[] = [listRecipes, installRecipe, runRecipe];
