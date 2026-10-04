/**
 * Full emoji picker for an ISSUE-level reaction (iteration 179, G19).
 *
 * The comment route next door is keyed on `commentId` and reads the timeline
 * cache; this one has no comment to key on, so it reads the issue detail cache
 * instead. Rather than fork the ~90-line sheet body, both render
 * `EmojiPickerSheetBody` — see that file for why.
 *
 * The toggle semantics are identical to the inline bar and the comment route:
 * re-picking an emoji the current user already applied removes it.
 */
import { useCallback, useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { IssueReaction } from "@multica/core/types";
import { issueDetailOptions } from "@/data/queries/issues";
import { useToggleIssueReaction } from "@/data/mutations/issues";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { EmojiPickerSheetBody } from "@/components/issue/emoji-picker-sheet-body";

export default function IssueEmojiPickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id);
  const toggle = useToggleIssueReaction(id);
  const { t } = useTranslation();

  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const reactions = useMemo(
    () => (issue?.reactions ?? []) as IssueReaction[],
    [issue?.reactions],
  );

  const onSelect = useCallback(
    (emoji: string, existing: IssueReaction | undefined) => {
      toggle.mutate({ emoji, existing });
    },
    [toggle],
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
