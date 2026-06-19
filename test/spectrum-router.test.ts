import { describe, expect, it } from "vitest";
import { backlogTools } from "../src/tools/backlog";
import { reminderTools } from "../src/tools/reminders";
import { MockRouterModel, toApiMessages } from "../src/spectrum/router";
import type { ChatTurn } from "../src/spectrum/types";

const TOOLS = [...backlogTools, ...reminderTools];
const decide = (text: string, history: ChatTurn[] = []) => {
  const messages: ChatTurn[] = [...history, { role: "user", text }];
  return new MockRouterModel().decide({ system: "", messages, tools: TOOLS });
};

describe("toApiMessages", () => {
  it("drops leading assistant turns and merges consecutive same-role turns", () => {
    const turns: ChatTurn[] = [
      { role: "assistant", text: "hi there" }, // leading assistant → dropped
      { role: "user", text: "a" },
      { role: "user", text: "b" }, // consecutive user → merged
      { role: "assistant", text: "ok" },
    ];
    expect(toApiMessages(turns)).toEqual([
      { role: "user", text: "a\nb" },
      { role: "assistant", text: "ok" },
    ]);
  });

  it("returns [] for empty or all-assistant input", () => {
    expect(toApiMessages([])).toEqual([]);
    expect(toApiMessages([{ role: "assistant", text: "x" }])).toEqual([]);
  });
});

describe("MockRouterModel (offline brain)", () => {
  it("routes a save intent to add_note", async () => {
    const d = await decide("save this article to read later");
    expect(d.kind).toBe("tool");
    expect(d.name).toBe("add_note");
    expect(typeof d.arguments?.text).toBe("string");
  });

  it("routes a list intent to list_backlog", async () => {
    const d = await decide("what's on my list?");
    expect(d).toMatchObject({ kind: "tool", name: "list_backlog" });
  });

  it("routes a completion intent to complete_note with a parsed ref", async () => {
    const d = await decide("mark 2 done");
    expect(d).toMatchObject({ kind: "tool", name: "complete_note" });
    expect(d.arguments?.ref).toBe(2);
  });

  it("routes a reminder intent to set_reminder with a fire_at", async () => {
    const d = await decide("remind me to call the dentist tomorrow");
    expect(d).toMatchObject({ kind: "tool", name: "set_reminder" });
    expect(typeof d.arguments?.fire_at).toBe("string");
    expect(String(d.arguments?.text)).toContain("call the dentist");
  });

  it("falls back to a conversational reply for out-of-domain text", async () => {
    const d = await decide("what do you think about the weather today");
    expect(d.kind).toBe("reply");
    expect(d.text && d.text.length).toBeGreaterThan(0);
  });

  it("never routes to a tool that isn't in the provided list", async () => {
    // prioritize is not in TOOLS here → a 'which first' ask must fall back to reply
    const d = await decide("which should I do first?");
    expect(d.kind).toBe("reply");
  });
});
