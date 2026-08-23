/**
 * Issue-sidebar Quick Actions (MYS-680) — mirrors web's
 * `quick-actions-section.tsx` (packages/views/issues/components/). Lists the
 * workspace's ACTIVE quick actions and runs one on tap; the run posts a
 * comment on the issue like an @mention and returns a Comment whose
 * `trigger_outcomes[0]` tells us what actually happened.
 *
 * Differences from web, all platform adaptations:
 *   - the list is NOT filtered by invoke permission, matching web: a refusal
 *     is answered once by the run endpoint and surfaces as the blocked
 *     dialog, so two people on one issue see the same sidebar;
 *   - the tooltip in web (hover → name/description/runs-as) becomes an inline
 *     muted "Runs as {name}" caption on the row;
 *   - the web toast is a mobile Alert, and the web AlertDialog (403 refusal)
 *     is a mobile Alert with the target's name interpolated.
 * Nothing configured renders nothing at all (web-identical).
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { Comment, QuickAction } from "@multica/core/types";
import { QUICK_ACTION_SIDEBAR_LIMIT } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useTranslation } from "@/lib/i18n/react";
import { useWorkspaceStore } from "@/data/workspace-store";
import { quickActionListOptions } from "@/data/queries/quick-actions";
import { useRunQuickAction } from "@/data/mutations/quick-actions";
import { quickActionOutcomeMessage } from "@/lib/quick-action-outcome";
import { isInvocationBlocked } from "@/lib/run-retry";

export function QuickActionsSection({ issueId }: { issueId: string }) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const { data = [], isLoading } = useQuery(quickActionListOptions(wsId));
  const actions = useMemo(
    () => data.filter((a) => a.status === "active"),
    [data],
  );

  // Nothing configured renders nothing at all: an empty section header in
  // the issue timeline is pure noise (web-identical).
  if (isLoading || actions.length === 0) return null;

  const visible = showAll
    ? actions
    : actions.slice(0, QUICK_ACTION_SIDEBAR_LIMIT);
  const hiddenCount = actions.length - visible.length;

  return (
    <View className="border-t border-border">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("issue.qa.sectionTitle")}
            className="flex-row items-center gap-1 px-4 pt-2 pb-1"
          >
            <Ionicons
              name={open ? "chevron-down" : "chevron-forward"}
              size={13}
              color="currentColor"
            />
            <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              {t("issue.qa.sectionTitle")}
            </Text>
          </Pressable>
        </CollapsibleTrigger>
        {open ? (
          <CollapsibleContent>
            <View className="px-3 pb-2">
              {visible.map((action) => (
                <QuickActionRow key={action.id} action={action} issueId={issueId} />
              ))}
              {hiddenCount > 0 ? (
                <Pressable
                  onPress={() => setShowAll(true)}
                  hitSlop={6}
                  accessibilityRole="button"
                  className="px-1 py-1.5"
                >
                  <Text className="text-[11px] text-muted-foreground">
                    {t("issue.qa.showMore", { count: hiddenCount })}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </View>
  );
}

function QuickActionRow({
  action,
  issueId,
}: {
  action: QuickAction;
  issueId: string;
}) {
  const { t } = useTranslation();
  const runMutation = useRunQuickAction(issueId);
  const running = runMutation.isPending;

  const targetName = action.target_name || t("issue.qa.targetFallback");

  const handleRun = async () => {
    try {
      const comment: Comment = await runMutation.mutateAsync({
        quickActionId: action.id,
      });
      const { message } = quickActionOutcomeMessage(
        comment.trigger_outcomes?.[0],
        targetName,
        t,
      );
      Alert.alert(action.name, message);
    } catch (error) {
      // A permission refusal is a structured 403 the user needs explained,
      // not a transient failure they should retry — it gets the dedicated
      // dialog. Everything else stays a raw error Alert.
      if (isInvocationBlocked(error)) {
        Alert.alert(
          t("issue.qa.blockedTitle"),
          t("issue.qa.blockedBody", { name: targetName }),
          [{ text: t("issue.qa.blockedOk") }],
        );
        return;
      }
      Alert.alert(
        action.name,
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      disabled={running}
      onPress={() => void handleRun()}
      className="flex-row items-center gap-2 rounded-md px-1 py-1.5 active:bg-secondary disabled:opacity-60"
    >
      {running ? (
        <ActivityIndicator size="small" />
      ) : (
        <Ionicons name="flash" size={13} color="currentColor" />
      )}
      <Text numberOfLines={1} className="min-w-0 flex-1 text-sm">
        {action.name}
      </Text>
      <Text className="shrink-0 text-[11px] text-muted-foreground">
        {t("issue.qa.runsAs", { name: targetName })}
      </Text>
    </Pressable>
  );
}