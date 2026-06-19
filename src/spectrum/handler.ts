// src/spectrum/handler.ts
import { findTool } from "../tools/index";
import type { ToolResult } from "../tools/types";
import { resolveUserId } from "./identity";
import { ROUTER_SYSTEM } from "./router";
import type { MessageLike, PollSpec, SpaceLike, SpectrumDeps } from "./types";

/** Did a backlog tool fail to find/complete the referenced item? (don't tapback on a miss) */
function isMiss(text: string): boolean {
  return text.startsWith("I couldn't") || text.startsWith("Couldn't");
}

/** Turn a ToolResult into the right native surface: tapback / poll / text. */
async function deliverResult(
  space: SpaceLike,
  message: MessageLike,
  result: ToolResult,
  toolName: string,
  deps: SpectrumDeps,
): Promise<void> {
  if (toolName === "complete_note" && !isMiss(result.text)) {
    try {
      await message.react("👍"); // native tapback on the user's message
    } catch {
      // react() can be unsupported (e.g. local-mode provider) — the text below still lands.
    }
  }
  const poll = (result.data as { poll?: PollSpec } | undefined)?.poll;
  if (poll && poll.options.length >= 2) {
    await space.send(deps.payloads.poll(poll.title, poll.options));
    return;
  }
  await space.send(deps.payloads.text(result.text));
}

/** A poll vote: pin the chosen open item (best-effort title match) and confirm. */
async function handlePollVote(deps: SpectrumDeps, space: SpaceLike, userId: string, option: string): Promise<void> {
  const open = await deps.store.listBacklog(userId, "open");
  // Match the vote back to its item. prioritizeTool ellipsizes items >80 chars to
  // `slice(0,79)+"…"`, so an exact compare misses long items — match that same
  // transform. (Phase-B: carry the item id in the poll option to drop text matching.)
  const chosen =
    open.find((i) => i.text === option) ??
    open.find((i) => i.text.length > 80 && `${i.text.slice(0, 79)}…` === option);
  if (!chosen) {
    await space.send(deps.payloads.text("Thanks — noted."));
    return;
  }
  await deps.store.pinBacklog(userId, chosen.id, true);
  await space.send(deps.payloads.text(`On it — pinned "${chosen.text}" to the top. Let's start there.`));
}

/**
 * Handle one inbound message end to end. Pure of the SDK: `space`/`message` are
 * the structural SpaceLike/MessageLike, so this is fully unit-testable with fakes.
 *
 * Flow: text/vote guard → DM-only guard → sender guard → identity + remember
 * space → rate guard → append user turn → route over recent memory → run the
 * matched tool (or reply) → deliver with native texture → append assistant turn.
 */
export async function handleInbound(deps: SpectrumDeps, space: SpaceLike, message: MessageLike): Promise<void> {
  // Phase A: 1:1 only (no group mention-detection yet).
  if (space.type && space.type !== "dm") return;

  const senderId = message.sender?.id;
  const userId = resolveUserId(senderId);
  if (!userId) return;

  await deps.store.upsertSpectrumSpace({ user_id: userId, space_id: space.id });

  // Poll vote → its own lightweight branch (no LLM, no rate cost).
  if (message.content.type === "poll_option") {
    const option = String((message.content as { option?: unknown }).option ?? "");
    await handlePollVote(deps, space, userId, option);
    return;
  }

  // Everything else we handle is text.
  if (message.content.type !== "text") return;
  const text = String((message.content as { text?: unknown }).text ?? "").trim();
  if (!text) return;

  // Per-user rate ceiling — every inbound costs an LLM call, so cap loops/floods.
  const limit = await deps.rateLimiter.hit(`spectrum:${userId}`, deps.rateMax, deps.rateWindowSec);
  if (!limit.allowed) {
    await space.send(deps.payloads.text("One sec — give me a moment to catch up, then try again."));
    return;
  }

  await deps.store.appendSpectrumTurn({ user_id: userId, space_id: space.id, role: "user", text });
  const history = await deps.store.recentSpectrumTurns(userId, 10);

  // The user turn is already persisted, so route+dispatch must NEVER leave it
  // unpaired: a thrown router/tool (e.g. Anthropic network error) would both go
  // silent on the line AND orphan the user turn (toApiMessages merges consecutive
  // same-role turns, doubling the next prompt). Catch → reply gracefully → still
  // record the assistant turn below.
  let assistantText = "Something hiccuped on my end — give it another try in a moment.";
  try {
    const decision = await deps.router.decide({ system: ROUTER_SYSTEM, messages: history, tools: deps.tools });
    if (decision.kind === "tool" && decision.name) {
      const tool = findTool(decision.name) ?? deps.tools.find((t) => t.name === decision.name);
      if (!tool) {
        assistantText = "Hmm — I blanked on how to do that. Mind rephrasing?";
        await space.send(deps.payloads.text(assistantText));
      } else {
        // Validate args the same way the MCP path does (src/mcp/server.ts:93) —
        // the model can tool-call with missing/empty input; render the -32602 it
        // would return there as a friendly clarifying reply on the chat surface.
        const parsed = tool.zod.safeParse(decision.arguments ?? {});
        if (!parsed.success) {
          assistantText = "I didn't quite catch the details for that — mind saying it another way?";
          await space.send(deps.payloads.text(assistantText));
        } else {
          const ctx = deps.makeToolContext(userId);
          const result = await tool.handler(parsed.data, ctx);
          await deliverResult(space, message, result, decision.name, deps);
          assistantText = result.text;
        }
      }
    } else {
      assistantText = decision.text ?? "I'm here — what do you need?";
      await space.send(deps.payloads.text(assistantText));
    }
  } catch {
    assistantText = "Something hiccuped on my end — give it another try in a moment.";
    await space.send(deps.payloads.text(assistantText)).catch(() => {}); // best-effort; space may be gone
  }

  await deps.store.appendSpectrumTurn({ user_id: userId, space_id: space.id, role: "assistant", text: assistantText });
}
