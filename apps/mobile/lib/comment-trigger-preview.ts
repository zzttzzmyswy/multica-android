/**
 * Mobile comment trigger-preview model — everything between the backend
 * `POST /api/issues/{id}/comments/trigger-preview` response and the
 * `<CommentTriggerChips>` render.
 *
 * Semantics mirror web verbatim:
 *   - mention parsing / target labels: `packages/core/issues/comment-trigger-outcomes.ts`
 *   - fetch signature + note-draft guard: `packages/views/issues/hooks/use-comment-trigger-preview.ts`
 *   - blocked / source copy: `packages/views/issues/blocked-trigger-copy.ts`
 *
 * Mobile copies rather than imports (apps/mobile/CLAUDE.md "What mobile may
 * import": React/Query runtime and packages/views code are not importable),
 * exactly like `lib/inbox-display.ts` mirrors its web counterpart.
 */
import type { CommentTriggerOutcome, CommentTriggerPreviewAgent } from "@multica/core/types";

/** `t` shape the mobile i18n store exposes via `useTranslation`. */
export type TriggerLabelT = (
  id: string,
  params?: Record<string, string | number>,
) => string;

export interface ParsedMention {
  label: string;
  type: string;
  id: string;
}

// Source for a rendered mention in comment markdown, capturing the label the
// user picked, the target type, and the target id: `[@Go](mention://agent/UUID)`.
// Kept as a string so every parse builds its OWN global RegExp — sharing one
// global instance across `matchAll` calls leaks `lastIndex` and drops matches.
const MENTION_MARKUP_SOURCE =
  "\\[@?(.+?)\\]\\(mention:\\/\\/(member|agent|squad|issue|all)\\/([0-9a-fA-F-]+|all)\\)";

/** Every mention in the body, in order. Callers that only care about a subset
 *  (e.g. skipping `issue` links, or deduping) filter the result. */
export function parseMentions(content: string): ParsedMention[] {
  const re = new RegExp(MENTION_MARKUP_SOURCE, "g");
  const mentions: ParsedMention[] = [];
  for (const match of content.matchAll(re)) {
    const label = match[1];
    const type = match[2];
    const id = match[3];
    if (!label || !type || !id) continue;
    mentions.push({ label, type, id });
  }
  return mentions;
}

// A blocked trigger outcome from the server intentionally omits the target's
// name (enumeration-safety: the wire never reveals a private target). But the
// CLIENT already rendered that name in its own draft/comment, so the composer
// can label a blocked mention from the markup the user typed — no new
// disclosure. Returns a `${target_type}:${target_id}` → label map.
export function mentionLabelsByTarget(content: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const { label, type, id } of parseMentions(content)) {
    labels.set(`${type}:${id}`, label);
  }
  return labels;
}

/** The label a user typed for one blocked outcome, or undefined when it cannot
 *  be correlated (e.g. the mention was edited away). Callers fall back to a
 *  name-free reason so the warning is still shown. */
export function blockedTriggerLabel(
  outcome: { target_type: string; target_id: string },
  labels: Map<string, string>,
): string | undefined {
  return labels.get(`${outcome.target_type}:${outcome.target_id}`);
}

const NOTE_COMMAND_RE = /^\/note(?:$|\s)/i;

/** Drafts starting with the `/note` command must never trigger agents. */
export function isNoteCommentDraft(content: string): boolean {
  return NOTE_COMMAND_RE.test(content.replace(/^[ \t\r\n]+/, ""));
}

/** Stable signature for the preview fetch: blank / note drafts are "empty",
 *  otherwise the de-duplicated mention token set. Ordinary text edits must
 *  NOT trigger a refetch — only routing mentions change the answer. */
export function commentTriggerPreviewSignature(content: string): string {
  if (!content.trim() || isNoteCommentDraft(content)) return "empty";

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const { type, id } of parseMentions(content)) {
    if (type === "issue") continue;
    const token = `${type}:${id}`;
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }

  return `nonempty|${tokens.join(",")}`;
}

/** True when neither agents nor blocked outcomes exist — the composer renders
 *  nothing for a preview that has nothing to say (loading / error included). */
export function emptyTriggerPreview(
  agents: CommentTriggerPreviewAgent[],
  blocked: CommentTriggerOutcome[],
): boolean {
  return agents.length === 0 && blocked.length === 0;
}

/** Drop suppressed ids that no longer correspond to a visible preview agent,
 *  so a mention edited away cannot leave behind an invisible "skipped" chip.
 *  Returns the SAME set instance when unchanged so React sees no state update. */
export function pruneSuppressedAgentIds(
  prev: Set<string>,
  agents: CommentTriggerPreviewAgent[],
): Set<string> {
  const visible = new Set(agents.map((a) => a.id));
  const next = new Set([...prev].filter((id) => visible.has(id)));
  return next.size === prev.size ? prev : next;
}

/** How many agents WILL start after suppression — the multi-chip count. */
export function countWillTrigger(
  agents: CommentTriggerPreviewAgent[],
  suppressedAgentIds: Set<string>,
): number {
  return agents.filter((a) => !suppressedAgentIds.has(a.id)).length;
}

export function sourceLabel(source: string, t: TriggerLabelT): string {
  switch (source) {
    case "issue_assignee":
      return t("comment.trigger_source_issue_assignee");
    case "mention_agent":
      return t("comment.trigger_source_mention_agent");
    case "mention_squad_leader":
      return t("comment.trigger_source_mention_squad_leader");
    default:
      return t("comment.trigger_source_unknown");
  }
}

// Assignee / @mention reasons are intentionally omitted: the header
// (name · source) already says why they fire, so a reason line there would
// just restate it. Only the squad-leader link (non-obvious) and the unknown
// fallback carry information the header doesn't (web blocks-trigger-copy
// comment-trigger-chips.tsx:sourceReason).
export function sourceReason(
  agent: CommentTriggerPreviewAgent,
  t: TriggerLabelT,
): string | null {
  switch (agent.source) {
    case "issue_assignee":
    case "mention_agent":
      return null;
    case "mention_squad_leader":
      return t("comment.trigger_reason_mention_squad_leader");
    default:
      return agent.reason || t("comment.trigger_reason_unknown");
  }
}

/** Full sentence — for the expanded detail row where there is room to explain. */
export function blockedReasonLabel(
  reasonCode: string,
  t: TriggerLabelT,
): string {
  switch (reasonCode) {
    case "invocation_not_allowed":
      return t("comment.trigger_blocked_invocation_not_allowed");
    case "target_unavailable":
      return t("comment.trigger_blocked_target_unavailable");
    case "runtime_offline":
      return t("comment.trigger_blocked_runtime_offline");
    case "runtime_unusable":
      return t("comment.trigger_blocked_runtime_unusable");
    case "agent_runtime_required":
      return t("comment.trigger_blocked_agent_runtime_required");
    default:
      return t("comment.trigger_blocked_generic");
  }
}

/** Short badge — for the inline chip where the target name carries the "who"
 *  and the reason only needs to say why in a couple of words. */
export function blockedShortReasonLabel(
  reasonCode: string,
  t: TriggerLabelT,
): string {
  switch (reasonCode) {
    case "invocation_not_allowed":
      return t("comment.trigger_blocked_short_invocation_not_allowed");
    case "target_unavailable":
      return t("comment.trigger_blocked_short_target_unavailable");
    case "runtime_offline":
      return t("comment.trigger_blocked_short_runtime_offline");
    case "runtime_unusable":
      return t("comment.trigger_blocked_short_runtime_unusable");
    case "agent_runtime_required":
      return t("comment.trigger_blocked_short_agent_runtime_required");
    default:
      return t("comment.trigger_blocked_short_generic");
  }
}