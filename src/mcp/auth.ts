import { config } from "../config";

export type Cred = "Bearer" | "xkey" | "rawauth" | "none";

export interface AuthContext {
  /** x-poke-user-id, or "anonymous" if none arrived. */
  userId: string;
  /** A non-empty user id was injected by Poke. */
  hasUserId: boolean;
  /** A presented Bearer / x-poke-key matched the configured key. */
  authed: boolean;
  cred: Cred;
}

/** Constant-time equality — no early-out on the first differing byte. */
export function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type HeaderGetter = (name: string) => string | null;

/** Read the two credentials (inbound) off the request headers. */
export function extractAuth(getHeader: HeaderGetter, bearerKey = config.mcpBearerKey): AuthContext {
  const authHdr = getHeader("authorization") ?? "";
  const bearer = /^bearer /i.test(authHdr) ? authHdr.slice(7) : "";
  const xkey = getHeader("x-poke-key") ?? "";
  const cred: Cred = bearer ? "Bearer" : xkey ? "xkey" : authHdr ? "rawauth" : "none";
  const authed =
    !!bearerKey &&
    ((bearer !== "" && safeEq(bearer, bearerKey)) || (xkey !== "" && safeEq(xkey, bearerKey)));
  const rawUid = getHeader("x-poke-user-id");
  const hasUserId = rawUid !== null && rawUid !== "";
  return { userId: hasUserId ? (rawUid as string) : "anonymous", hasUserId, authed, cred };
}

/**
 * Gate a data-tool call. Mirrors the bridge's hard-won policy:
 *   - enforcement off → allow all (ship diagnostic-first).
 *   - enforcement on  → allow if keyed OR Poke injected a user id (recipe
 *     installers are keyless forever by Poke's design); reject only
 *     fully-anonymous direct hits (no key AND no uid — e.g. curl probes).
 */
export function isAuthorized(auth: AuthContext, enforce = config.mcpAuthEnforce): boolean {
  if (!enforce) return true;
  return auth.authed || auth.hasUserId;
}
