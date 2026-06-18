import { z } from "zod";
import { renderRecipeInstalled, renderRecipes } from "../render";
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
    "Save a reusable recipe (a named routine with a prompt and optional integrations). Only call when the user asks to create, save, or install a routine/recipe.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "short recipe name" },
      prompt: { type: "string", description: "what the recipe should do when run" },
      integrations: { type: "string", description: "optional JSON array of integration names" },
    },
    required: ["name"],
  },
  zod: z.object({
    name: z.string().min(1),
    prompt: z.string().optional(),
    integrations: z.string().optional(),
  }),
  requiresAuth: true,
  async handler(args, ctx) {
    const recipe = await ctx.store.installRecipe({
      user_id: ctx.userId,
      name: args.name,
      ...(args.prompt ? { prompt: args.prompt } : {}),
      ...(args.integrations ? { integrations: args.integrations } : {}),
    });
    return { text: renderRecipeInstalled(recipe), data: { id: recipe.id } };
  },
};

export const recipeTools: ToolDef[] = [listRecipes, installRecipe];
