// Liveness probe. No DB touch — deliberately cheap so it stays green even if
// Neon is briefly unreachable; deeper checks belong in the demo/e2e harness.
export const config = { runtime: "edge" };

export default function handler(_req: Request): Response {
  return new Response(JSON.stringify({ ok: true, service: "poke-conduit", version: "0.1.0" }), {
    headers: { "content-type": "application/json" },
  });
}
