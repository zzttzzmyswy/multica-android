/**
 * Issue-level reaction row. Sits right under the description, mirroring
 * web's `issue-detail.tsx:785` placement.
 *
 * Reads issue.reactions from the detail cache passed by the parent. No
 * separate query — single source of truth on the detail object.
 *
 * Always renders, even with zero reactions: web's `ReactionBar` renders its
 * `QuickEmojiPicker` unconditionally after the chip list
 * (`packages/ui/components/common/reaction-bar.tsx:79`), so an issue with no
 * reactions still shows the entry point. Mobile used to `return null` on an
 * empty list, which left the phone with no way at all to add a reaction to an
 * issue (iteration 179, G19).
 */
import { useCallback } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import type { Issue, IssueReaction } from "@multica/core/types";
import { ReactionBar } from "./reaction-bar";
import { useToggleIssueReaction } from "@/data/mutations/issues";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";

export function IssueReactionRow({ issue }: { issue: Issue }) {
  const userId = useAuthStore((s) => s.user?.id);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const reactions: IssueReaction[] = issue.reactions ?? [];
  const toggle = useToggleIssueReaction(issue.id);

  const onToggle = useCallback(
    (emoji: string) => {
      const existing = reactions.find(
        (r) =>
          r.emoji === emoji &&
          r.actor_type === "member" &&
          r.actor_id === userId,
      );
      toggle.mutate({ emoji, existing });
    },
    [reactions, userId, toggle],
  );

  return (
    <View className="px-4 pb-3">
      <ReactionBar
        reactions={reactions}
        currentUserId={userId}
        onToggle={onToggle}
        onOpenFullPicker={
          wsSlug
            ? () =>
                router.push({
                  pathname: "/[workspace]/issue/[id]/emoji-picker",
                  params: { workspace: wsSlug, id: issue.id },
                })
            : undefined
        }
      />
    </View>
  );
}
