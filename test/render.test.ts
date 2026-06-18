import { describe, expect, it } from "vitest";
import type { CouncilResult } from "../src/agents/council";
import {
  renderBacklogList,
  renderCouncil,
  renderReminderAdded,
  renderReminderList,
  renderRunStatus,
  renderStatus,
} from "../src/render";
import type { BacklogItem, Run, Status, Trigger } from "../src/store/types";

const item = (over: Partial<BacklogItem> = {}): BacklogItem => ({
  id: "bk_1",
  user_id: "u",
  text: "read the durable-execution paper",
  status: "open",
  pinned: false,
  tags: "",
  created_at: "2026-06-18T00:00:00.000Z",
  completed_at: null,
  ...over,
});

describe("renderBacklogList", () => {
  it("messages an empty backlog", () => {
    expect(renderBacklogList([])).toBe("Your backlog is empty.");
  });

  it("numbers items 1-based and marks pins", () => {
    const out = renderBacklogList([item({ pinned: true }), item({ id: "bk_2", text: "call mom" })]);
    expect(out).toBe("1. 📌 read the durable-execution paper\n2. call mom");
  });
});

describe("renderCouncil", () => {
  const result: CouncilResult = {
    question: "Ship Friday?",
    positions: [
      { persona: "builder", name: "The Builder", text: "Ship it." },
      { persona: "skeptic", name: "The Skeptic", text: "Tests are thin." },
    ],
    synthesis: "Ship behind a flag.",
  };
  it("leads with the synthesis and shows the room", () => {
    const out = renderCouncil(result);
    expect(out).toContain("Ship Friday?");
    expect(out).toContain("Ship behind a flag.");
    expect(out).toContain("The Builder: Ship it.");
    expect(out).toContain("The Skeptic: Tests are thin.");
  });
});

describe("renderRunStatus", () => {
  const base: Run = {
    id: "run_1",
    user_id: "u",
    kind: "council",
    status: "running",
    input: "{}",
    output: "{}",
    created_at: "2026-06-18T00:00:00.000Z",
    finished_at: null,
  };
  it("shows deliberating while running", () => {
    expect(renderRunStatus(base)).toContain("deliberating");
  });
  it("renders the council when done", () => {
    const result: CouncilResult = { question: "Q", positions: [], synthesis: "Do X." };
    const out = renderRunStatus({ ...base, status: "done", output: JSON.stringify(result) });
    expect(out).toContain("Do X.");
  });
  it("reports an errored run", () => {
    expect(renderRunStatus({ ...base, status: "error" })).toContain("error");
  });
});

describe("renderStatus", () => {
  const s = (over: Partial<Status> = {}): Status => ({
    user_id: "u",
    status: "active",
    note: "",
    until: null,
    updated_at: "2026-06-18T00:00:00.000Z",
    ...over,
  });
  it("phrases each mode", () => {
    expect(renderStatus(s({ status: "active" }))).toContain("active");
    expect(renderStatus(s({ status: "dnd" }))).toContain("do-not-disturb");
    expect(renderStatus(s({ status: "deep_work" }))).toContain("deep work");
  });
  it("includes note and until when present", () => {
    const out = renderStatus(s({ status: "deep_work", note: "release", until: "2026-06-18T21:00:00.000Z" }));
    expect(out).toContain("release");
    expect(out).toContain("2026-06-18T21:00:00.000Z");
  });
});

describe("reminders", () => {
  const t = (over: Partial<Trigger> = {}): Trigger => ({
    id: "trg_1",
    user_id: "u",
    kind: "reminder",
    text: "standup",
    fire_at: "2026-06-19T16:00:00.000Z",
    recurrence: "none",
    status: "pending",
    created_at: "2026-06-18T00:00:00.000Z",
    ...over,
  });
  it("confirms a one-shot and a daily reminder", () => {
    expect(renderReminderAdded(t())).toContain("standup");
    expect(renderReminderAdded(t({ recurrence: "daily" }))).toContain("(daily)");
  });
  it("lists upcoming reminders or says none", () => {
    expect(renderReminderList([])).toBe("No upcoming reminders.");
    expect(renderReminderList([t(), t({ id: "trg_2", text: "vitamins", recurrence: "daily" })])).toContain(
      "vitamins",
    );
  });
});
