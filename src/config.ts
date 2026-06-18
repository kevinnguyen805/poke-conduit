/**
 * Central env config. Demo + tests require NONE of these — the demo falls back
 * to MockModel + MockPokeClient + pg-mem and prints how to go live.
 */
export const config = {
  /** Anthropic API key. If set, the agents reason with real Claude; else MockModel. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  /** Cheap/fast model for the persona worker-agents. */
  personaModel: process.env.POKE_CONDUIT_PERSONA_MODEL ?? "claude-haiku-4-5-20251001",
  /** Strong model for the synthesis step. */
  synthModel: process.env.POKE_CONDUIT_SYNTH_MODEL ?? "claude-fable-5",

  /** Neon Postgres connection string. Empty → local pg-mem store. */
  databaseUrl: process.env.DATABASE_URL ?? "",

  /** The user's Poke V2 API key (Kitchen), used for OUTBOUND proactive pushes. */
  pokeApiKey: process.env.POKE_API_KEY ?? "",
  pokeInboundUrl:
    process.env.POKE_INBOUND_URL ?? "https://poke.com/api/v1/inbound/api-message",

  /** INBOUND MCP auth (Poke → conduit). When true, require Bearer/x-poke-key. */
  mcpAuthEnforce: process.env.MCP_AUTH_ENFORCE === "true",
  mcpBearerKey: process.env.MCP_BEARER_KEY ?? "",

  /** Per-identity fixed-window rate limit on POST /mcp (basic public-endpoint hygiene). */
  mcpRateMax: Number(process.env.MCP_RATE_MAX ?? 120),
  mcpRateWindowSec: Number(process.env.MCP_RATE_WINDOW_SEC ?? 60),

  /** Local HTTP port for `npm run serve`. */
  port: Number(process.env.PORT ?? 7411),
};

export type Config = typeof config;
