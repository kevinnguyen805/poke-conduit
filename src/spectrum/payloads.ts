import type { SpectrumPayloads } from "./types";

/**
 * SDK-free content factory: returns tagged plain objects instead of real
 * ContentBuilders. Used by tests (assert on the tag) and the offline harness.
 * The real, SDK-backed factory lives in app.ts (`realPayloads`).
 */
export const tagPayloads: SpectrumPayloads = {
  text: (s) => ({ kind: "text", text: s }),
  effect: (s, effect) => ({ kind: "effect", text: s, effect }),
  poll: (title, options) => ({ kind: "poll", title, options }),
};
