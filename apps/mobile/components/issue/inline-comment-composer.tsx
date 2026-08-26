/**
 * Inline issue-comment composer — thin wrapper around the shared
 * `<MessageComposer>` with comment-specific wiring:
 *
 *   - `onSubmit` → `useCreateComment(issueId).mutateAsync`
 *   - Reply target sourced from `useReplyTargetStore` (set by the
 *     comment long-press action sheet)
 *   - Mention picker path → `/[workspace]/mention-picker?mode=comment`
 *   - Upload context binds attachments to this issue
 *   - Trigger-preview chips (`CommentTriggerChips`) under the editor:
 *     renders who posting this draft will start, lets the user tap a chip
 *     to skip that agent, and sends the skipped ids as `suppress_agent_ids`
 *     on submit (mobile mirror of web comment-input.tsx).
 *
 * All UI / state / chip plumbing lives in `MessageComposer`. The chat
 * composer (`components/chat/chat-composer.tsx`) uses the same component
 * with chat-mode props.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommentTriggerPreviewAgent } from "@multica/core/types";
import { useCreateComment } from "@/data/mutations/issues";
import { useCommentTriggerPreview } from "@/data/queries/comment-trigger-preview";
import { useReplyTargetStore } from "@/data/stores/reply-target-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { MessageComposer, serializeMentions } from "@/components/composer/message-composer";
import { CommentTriggerChips } from "@/components/issue/comment-trigger-chips";
import type { MentionChip } from "@/components/issue/composer-attachment-row";
import { useTranslation } from "@/lib/i18n/react";
import { pruneSuppressedAgentIds } from "@/lib/comment-trigger-preview";

export function InlineCommentComposer({ issueId }: { issueId: string }) {
  const { t } = useTranslation();
  const createComment = useCreateComment(issueId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const replyTarget = useReplyTargetStore((s) => s.target);
  const clearReplyTarget = useReplyTargetStore((s) => s.clear);
  const [suppressedAgentIds, setSuppressedAgentIds] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleSuppressedAgent = useCallback((agentId: string) => {
    setSuppressedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  // Prune suppressed ids that no longer correspond to a visible preview
  // agent, so an edited-away mention cannot leave an invisible "skipped"
  // chip behind — and, more importantly, cannot suppress a re-triggering
  // agent (e.g. the assignee) the user no longer means to skip. Mirrors web
  // comment-input.tsx:101-107.
  const handlePreviewAgentsChange = useCallback(
    (agents: CommentTriggerPreviewAgent[]) => {
      setSuppressedAgentIds((prev) => pruneSuppressedAgentIds(prev, agents));
    },
    [],
  );

  const onSubmit = useCallback(
    async ({
      content,
      attachmentIds,
      suppressAgentIds,
    }: {
      content: string;
      attachmentIds: string[];
      suppressAgentIds?: string[];
    }) => {
      try {
        await createComment.mutateAsync({
          content,
          parentId: replyTarget?.commentId,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
          suppressAgentIds:
            suppressAgentIds && suppressAgentIds.length > 0
              ? suppressAgentIds
              : undefined,
        });
      } catch (err) {
        // Rethrow so MessageComposer's catch path restores text + chips.
        // The optimistic timeline row stays with its inline
        // Failed · Retry · Discard affordance.
        throw err;
      }
    },
    [createComment, replyTarget?.commentId],
  );

  return (
    <MessageComposer
      onSubmit={onSubmit}
      mentionPickerPath={{
        pathname: "/[workspace]/mention-picker",
        params: { workspace: wsSlug ?? "", mode: "comment" },
      }}
      uploadContext={{ issueId }}
      placeholder={t("comment.placeholder")}
      pillLabel={t("comment.pillLabel")}
      pillIcon="chatbubble-ellipses-outline"
      slashCommands={{ issueId }}
      replyTarget={
        replyTarget
          ? {
              actorName: replyTarget.actorName,
              preview: replyTarget.preview,
            }
          : null
      }
      onClearReplyTarget={clearReplyTarget}
      expandTrigger={replyTarget?.commentId ?? null}
      suppressAgentIds={[...suppressedAgentIds]}
      triggerPreviewSlot={({ text, mentions }) => (
        <CommentTriggerPreviewSlot
          issueId={issueId}
          parentId={replyTarget?.commentId ?? undefined}
          text={text}
          mentions={mentions}
          suppressedAgentIds={suppressedAgentIds}
          onToggle={toggleSuppressedAgent}
          onAgentsChange={handlePreviewAgentsChange}
        />
      )}
    />
  );
}

/**
 * Rebuilds the exact markdown the composer will submit (mentions prepended,
 * mirroring MessageComposer.handleSubmit) and wires the preview fetch + chips.
 * Mounts only while the composer is expanded, so no fetch happens for a
 * collapsed pill. The draft store lives in the composer; the preview hooks
 * read it via these props — the slot is intentionally a stateless projector.
 */
function CommentTriggerPreviewSlot({
  issueId,
  parentId,
  text,
  mentions,
  suppressedAgentIds,
  onToggle,
  onAgentsChange,
}: {
  issueId: string;
  parentId?: string;
  text: string;
  mentions: MentionChip[];
  suppressedAgentIds: Set<string>;
  onToggle: (agentId: string) => void;
  onAgentsChange: (agents: CommentTriggerPreviewAgent[]) => void;
}) {
  const content = useMemo(() => {
    const mentionMd = serializeMentions(mentions);
    const trimmed = text.trim();
    return mentionMd ? (trimmed ? `${mentionMd} ${trimmed}` : mentionMd) : trimmed;
  }, [text, mentions]);

  const preview = useCommentTriggerPreview({
    issueId,
    parentId,
    content,
  });

  useEffect(() => {
    onAgentsChange(preview.agents);
  }, [preview.agents, onAgentsChange]);

  return (
    <CommentTriggerChips
      agents={preview.agents}
      blocked={preview.blocked}
      draftContent={content}
      suppressedAgentIds={suppressedAgentIds}
      onToggle={onToggle}
    />
  );
}