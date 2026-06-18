import { describe, expect, it } from "vitest";
import { extractAuth, isAuthorized, safeEq } from "../src/mcp/auth";

const KEY = "secret-key";

/** Build a header getter over a lowercase-keyed map (mirrors Request.headers.get). */
function headers(map: Record<string, string>) {
  return (name: string): string | null => map[name.toLowerCase()] ?? null;
}

describe("safeEq", () => {
  it("is true for equal strings", () => expect(safeEq("abc", "abc")).toBe(true));
  it("is false for same-length, different content", () => expect(safeEq("abc", "abd")).toBe(false));
  it("is false for different lengths", () => expect(safeEq("abc", "abcd")).toBe(false));
});

describe("extractAuth", () => {
  it("accepts a matching Bearer token", () => {
    const a = extractAuth(headers({ authorization: `Bearer ${KEY}` }), KEY);
    expect(a.authed).toBe(true);
    expect(a.cred).toBe("Bearer");
  });

  it("accepts a matching x-poke-key", () => {
    const a = extractAuth(headers({ "x-poke-key": KEY }), KEY);
    expect(a.authed).toBe(true);
    expect(a.cred).toBe("xkey");
  });

  it("rejects a non-matching Bearer token", () => {
    const a = extractAuth(headers({ authorization: "Bearer wrong" }), KEY);
    expect(a.authed).toBe(false);
    expect(a.cred).toBe("Bearer");
  });

  it("captures the Poke-injected user id", () => {
    const a = extractAuth(headers({ "x-poke-user-id": "u_42" }), KEY);
    expect(a.userId).toBe("u_42");
    expect(a.hasUserId).toBe(true);
  });

  it("is anonymous with no headers", () => {
    const a = extractAuth(headers({}), KEY);
    expect(a.userId).toBe("anonymous");
    expect(a.hasUserId).toBe(false);
    expect(a.authed).toBe(false);
    expect(a.cred).toBe("none");
  });

  it("treats an empty user id as absent", () => {
    const a = extractAuth(headers({ "x-poke-user-id": "" }), KEY);
    expect(a.hasUserId).toBe(false);
    expect(a.userId).toBe("anonymous");
  });

  it("never authes when no key is configured", () => {
    const a = extractAuth(headers({ authorization: `Bearer ${KEY}` }), "");
    expect(a.authed).toBe(false);
  });
});

describe("isAuthorized", () => {
  const anon = extractAuth(headers({}), KEY);
  const keyed = extractAuth(headers({ authorization: `Bearer ${KEY}` }), KEY);
  const uidOnly = extractAuth(headers({ "x-poke-user-id": "u_1" }), KEY);

  it("allows everyone when enforcement is off", () => {
    expect(isAuthorized(anon, false)).toBe(true);
    expect(isAuthorized(uidOnly, false)).toBe(true);
  });
  it("allows a keyed caller when enforcing", () => {
    expect(isAuthorized(keyed, true)).toBe(true);
  });
  it("allows a Poke-injected uid when enforcing", () => {
    expect(isAuthorized(uidOnly, true)).toBe(true);
  });
  it("rejects a fully-anonymous caller when enforcing", () => {
    expect(isAuthorized(anon, true)).toBe(false);
  });
});
