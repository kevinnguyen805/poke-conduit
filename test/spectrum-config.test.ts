import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { tagPayloads } from "../src/spectrum/payloads";

describe("spectrum config + payloads", () => {
  it("exposes spectrum credential keys (empty by default)", () => {
    expect(config.spectrumProjectId).toBe("");
    expect(config.spectrumProjectSecret).toBe("");
  });

  it("tagPayloads returns inspectable tagged objects (SDK-free)", () => {
    expect(tagPayloads.text("hi")).toEqual({ kind: "text", text: "hi" });
    expect(tagPayloads.effect("yo", "spotlight")).toEqual({ kind: "effect", text: "yo", effect: "spotlight" });
    expect(tagPayloads.poll("Pick", ["a", "b"])).toEqual({ kind: "poll", title: "Pick", options: ["a", "b"] });
  });
});
