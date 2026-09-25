/**
 * Full emoji picker for a comment reaction — opened from the per-comment
 * long-press menu's "+" tapback button. Mirrors web's emoji-mart picker
 * that sits behind QuickEmojiPicker's overflow button: same product
 * semantics (mobile must offer the full emoji set, not only the 8 quick
 * picks).
 *
 * Reads the comment from the timeline cache to detect an already-applied
 * reaction by the current user, then fires `useToggleCommentReaction` with
 * the right `existing` value so re-tapping an active emoji removes it
 * (matches web behaviour and the inline ReactionBar toggle semantics).
 *
 * The sheet body itself lives in `components/issue/emoji-picker-sheet-body`
 * — the issue-level picker route renders the same body with a different
 * target (iteration 179, G19).
 */
import { useCallback, useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Reaction } from "@multica/core/types";
import { issueTimelineOptions } from "@/data/queries/issues";
import { useToggleCommentReaction } from "@/data/mutations/issues";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { EmojiPickerSheetBody } from "@/components/issue/emoji-picker-sheet-body";

export default function CommentEmojiPickerRoute() {
  const { id, commentId } = useLocalSearchParams<{
    id: string;
    commentId: string;
  }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id);
  const toggle = useToggleCommentReaction(id);
  const { t } = useTranslation();

  const { data: timeline = [] } = useQuery(issueTimelineOptions(wsId, id));
  const entry = useMemo(
    () => timeline.find((e) => e.id === commentId) ?? null,
    [timeline, commentId],
  );

  const reactions = useMemo<Reaction[]>(
    () => (entry?.reactions ?? []) as Reaction[],
    [entry?.reactions],
  );

  const onSelect = useCallback(
    (emoji: string, existing: Reaction | undefined) => {
      toggle.mutate({ commentId, emoji, existing });
    },
    [toggle, commentId],
  );

  return (
    <EmojiPickerSheetBody
      title={t("issue.reaction.add")}
      reactions={reactions}
      currentUserId={userId}
      onSelect={onSelect}
    />
  );
}
