import { describe, expect, it } from "vitest";
import { resolveUserId } from "../src/spectrum/identity";

describe("resolveUserId", () => {
  it("namespaces a sender handle deterministically", () => {
    expect(resolveUserId("+15551234567")).toBe("spectrum:+15551234567");
    expect(resolveUserId("kevin@example.com")).toBe("spectrum:kevin@example.com");
  });

  it("is stable across calls (same handle → same id)", () => {
    expect(resolveUserId("+15551234567")).toBe(resolveUserId("+15551234567"));
  });

  it("returns null for a missing handle", () => {
    expect(resolveUserId(undefined)).toBeNull();
    expect(resolveUserId("")).toBeNull();
  });
});
