import { config } from "../config";

/**
 * OUTBOUND channel: conduit → Poke. We POST to Poke's inbound API
 * (`/api/v1/inbound/api-message`) with the user's Poke API key. That endpoint
 * makes Poke *act on* the message, so proactive payloads are phrased as
 * instructions ("Send me a reminder that says…"), not verbatim text.
 *
 * This is distinct from the INBOUND auth (Poke → conduit) the MCP server
 * enforces — two separate credentials, two directions.
 */
export interface PushResult {
  ok: boolean;
  status: number;
}

export interface PokeClient {
  push(instruction: string): Promise<PushResult>;
}

/** Real outbound client. MVP is single-tenant: one POKE_API_KEY → its owner. */
export class HttpPokeClient implements PokeClient {
  constructor(
    private apiKey: string,
    private url: string,
  ) {}

  async push(instruction: string): Promise<PushResult> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ message: instruction }),
    });
    return { ok: res.ok, status: res.status };
  }
}

/** Records pushes instead of sending them — tests and the offline demo. */
export class MockPokeClient implements PokeClient {
  readonly pushes: string[] = [];

  async push(instruction: string): Promise<PushResult> {
    this.pushes.push(instruction);
    return { ok: true, status: 200 };
  }
}

/** Real client when POKE_API_KEY is set, else the recording mock. */
export function makePokeClient(): PokeClient {
  return config.pokeApiKey
    ? new HttpPokeClient(config.pokeApiKey, config.pokeInboundUrl)
    : new MockPokeClient();
}

export function pokeMode(): "http" | "mock" {
  return config.pokeApiKey ? "http" : "mock";
}
