/**
 * Map a Spectrum sender handle (phone/email from `message.sender?.id`) to a
 * stable, namespaced user_id. The `spectrum:` prefix keeps these rows from ever
 * colliding with Poke-injected user ids in the shared pc_* tables.
 * Returns null when the handle is absent (sender can be undefined in some events).
 */
export function resolveUserId(senderId: string | undefined): string | null {
  if (!senderId) return null;
  return `spectrum:${senderId}`;
}
