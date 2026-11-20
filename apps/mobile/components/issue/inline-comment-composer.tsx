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
 *     renders who posting this draft will start, lets the user pick per
 *     recipient HOW it is delivered (steer a running turn, start after it,
 *     stop it and start over, or skip), and sends the result as
 *     `suppress_agent_ids` / `steer_task_ids` (+ stops the chosen turns
 *     before posting) on submit — mobile mirror of web comment-input.tsx.
 *
 * All UI / state / chip plumbing lives in `MessageComposer`. The chat
 * composer (`components/chat/chat-composer.tsx`) uses the same component
 * with chat-mode props.
 *
 * ## Run steering (iteration 298)
 *
 * Before this, the chips were a binary skip toggle. A comment written to
 * CORRECT an agent mid-run therefore had no way to reach that run: it queued
 * a follow-up behind it and the agent kept working on the wrong thing. Web
 * has offered the three-way choice (`steer` / `after_run` / `restart`) since
 * run steering shipped; the phone now sends the same
 * `steer_task_ids` and stops the same turns first.
 *
 * One deliberate difference: a running turn takes TEXT only, so attaching a
 * file drops `steer` from the menu AND shows the notice web shows
 * (`steer_attachment_notice`) instead of silently moving the file to the
 * follow-up run.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommentTriggerPreviewAgent } from "@multica/core/types";
import { useCreateComment, useCancelTask } from "@/data/mutations/issues";
import { useCommentTriggerPreview } from "@/data/queries/comment-trigger-preview";
import { useReplyTargetStore } from "@/data/stores/reply-target-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { MessageComposer, serializeMentions } from "@/components/composer/message-composer";
import { CommentTriggerChips } from "@/components/issue/comment-trigger-chips";
import { Text } from "@/components/ui/text";
import type { MentionChip } from "@/components/issue/composer-attachment-row";
import { useTranslation } from "@/lib/i18n/react";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";
import {
  steerTopLevelByDefault,
  useRecipientRouting,
} from "@/lib/use-recipient-routing";

export function InlineCommentComposer({ issueId }: { issueId: string }) {
  const { t } = useTranslation();
  const createComment = useCreateComment(issueId);
  const cancelTask = useCancelTask(issueId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const replyTarget = useReplyTargetStore((s) => s.target);
  const clearReplyTarget = useReplyTargetStore((s) => s.clear);
  const [previewAgents, setPreviewAgents] = useState<CommentTriggerPreviewAgent[]>(
    [],
  );
  // Attachments gate steering: a running turn cannot receive a file. The
  // composer owns the attachment list, so it reports the count up rather than
  // duplicating the picker here.
  const [hasAttachments, setHasAttachments] = useState(false);

  // A top-level comment reaches a running ASSIGNMENT run by default; a run
  // started by an earlier comment belongs to that thread, so a top-level
  // comment only reaches it by explicit choice. Same rule as web
  // (comment-input.tsx:38-42).
  const { recipients, routing, attachmentsBlockSteer, setAction, reset } =
    useRecipientRouting({
      issueId,
      agents: previewAgents,
      steerByDefault: steerTopLevelByDefault,
      hasAttachments,
    });

  // A new thread target is a different conversation: choices made for the old
  // one must not leak into it (web passes a `resetKey` for the same reason).
  const resetKey = replyTarget?.commentId ?? "top";
  const previousResetKey = useRef(resetKey);
  useEffect(() => {
    if (previousResetKey.current === resetKey) return;
    previousResetKey.current = resetKey;
    reset();
  }, [resetKey, reset]);

  const onSubmit = useCallback(
    async ({
      content,
      attachmentIds,
      steerTaskIds,
    }: {
      content: string;
      attachmentIds: string[];
      steerTaskIds?: string[];
    }) => {
      // Stop first, post second. Posting a "stop and start over" message
      // before the stop lands would deliver it to the very run the user asked
      // to abandon — the one outcome the choice exists to prevent.
      if (routing.restartTaskIds.length > 0) {
        const stopped = await Promise.allSettled(
          routing.restartTaskIds.map((taskId) => cancelTask.mutateAsync(taskId)),
        );
        if (stopped.some((result) => result.status === "rejected")) {
          // Keep the draft: the message was not sent, so the user can retry
          // once the run is stoppable (or switch the choice to "after run").
          Alert.alert(t("comment.restart_failed"));
          throw new Error("restart failed");
        }
      }
      try {
        await createComment.mutateAsync({
          content,
          parentId: replyTarget?.commentId,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
          suppressAgentIds: routing.suppressAgentIds.length
            ? routing.suppressAgentIds
            : undefined,
          steerTaskIds,
        });
        reset();
      } catch (err) {
        // Rethrow so MessageComposer's catch path restores text + chips.
        // The optimistic timeline row stays with its inline
        // Failed · Retry · Discard affordance.
        throw err;
      }
    },
    [createComment, cancelTask, replyTarget?.commentId, routing, reset, t],
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
      suppressAgentIds={routing.suppressAgentIds}
      steerTaskIds={routing.steerTaskIds}
      onAttachmentsChange={setHasAttachments}
      triggerPreviewSlot={({ text, mentions }) => (
        <CommentTriggerPreviewSlot
          issueId={issueId}
          parentId={replyTarget?.commentId ?? undefined}
          text={text}
          mentions={mentions}
          recipients={recipients}
          attachmentsBlockSteer={attachmentsBlockSteer}
          onActionChange={setAction}
          onAgentsChange={setPreviewAgents}
        />
      )}
    />
  );
}

/** Shown when a file-backed message would otherwise be added to a running
 *  turn. Web renders the same sentence (`steer_attachment_notice`). */
function SteerAttachmentNotice({ text }: { text: string }) {
  const theme = useThemePalette();
  return (
    <View className="mb-1 flex-row items-start gap-1.5 rounded-md bg-muted px-2 py-1">
      <Ionicons
        name="information-circle-outline"
        size={13}
        color={theme.mutedForeground}
      />
      <Text className="flex-1 text-micro text-muted-foreground">{text}</Text>
    </View>
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
  recipients,
  attachmentsBlockSteer,
  onActionChange,
  onAgentsChange,
}: {
  issueId: string;
  parentId?: string;
  text: string;
  mentions: MentionChip[];
  recipients: import("@/lib/use-recipient-routing").RecipientEntry[];
  attachmentsBlockSteer: boolean;
  onActionChange: (agentId: string, action: import("@/lib/recipient-routing").RecipientAction) => void;
  onAgentsChange: (agents: CommentTriggerPreviewAgent[]) => void;
}) {
  const { t } = useTranslation();
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
    <View>
      {attachmentsBlockSteer ? (
        <SteerAttachmentNotice text={t("comment.steer_attachment_notice")} />
      ) : null}
      <CommentTriggerChips
        agents={preview.agents}
        blocked={preview.blocked}
        draftContent={content}
        recipients={recipients}
        onActionChange={onActionChange}
      />
    </View>
  );
}
