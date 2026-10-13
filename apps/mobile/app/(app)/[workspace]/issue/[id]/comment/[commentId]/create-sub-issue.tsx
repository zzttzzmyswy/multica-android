/**
 * "Create a sub-issue from this comment" (MYS-2137) — the confirm surface.
 *
 * Pushed from the comment long-press action sheet. The target comment is read
 * from `useSourceContextTargetStore` rather than taken as a route param: the
 * action sheet has no router handle and the three values it holds are already
 * resolved there. See that store for why each one rides along.
 *
 * The comment id is ALSO accepted as a route param, and wins when present. That
 * is not redundancy — it is what makes the route deep-linkable and testable: a
 * cold navigation (a notification, a UI dump, a manual `adb` push) can open the
 * confirm surface for a known comment with no store state at all.
 *
 * Clears the store on unmount, the same lifecycle `reply-target-store` has: a
 * second visit must never render a previous comment's context.
 */
import { useEffect } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Text } from "@/components/ui/text";
import { SourceContextCreateBody } from "@/components/issue/source-context-create-body";
import { useSourceContextTargetStore } from "@/data/stores/source-context-target-store";
import { useTranslation } from "@/lib/i18n/react";

export default function CreateSubIssueFromCommentRoute() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    commentId?: string;
    issueId?: string;
    identifier?: string;
  }>();
  const stored = useSourceContextTargetStore((s) => s.target);
  const clear = useSourceContextTargetStore((s) => s.clear);

  const commentId = params.commentId ?? stored?.commentId;
  const issueId = params.issueId ?? stored?.issueId;
  const identifier = params.identifier ?? stored?.issueIdentifier;

  useEffect(() => clear, [clear]);

  if (!commentId || !issueId) {
    // Reachable only by a malformed deep link — the action sheet always writes
    // both. Saying so beats an empty form whose create would fail on submit.
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-center text-body text-muted-foreground">
          {t("sourceContext.loadFailed")}
        </Text>
      </View>
    );
  }

  return (
    <SourceContextCreateBody
      commentId={commentId}
      sourceIssueId={issueId}
      sourceIssueIdentifier={identifier}
    />
  );
}
