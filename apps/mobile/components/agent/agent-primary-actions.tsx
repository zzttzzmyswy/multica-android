/**
 * The two primary actions on an agent's detail screen — "Chat" and "Assign
 * work" — as the phone equivalent of web's `DetailHeader` buttons
 * (`packages/views/agents/components/agent-detail-page.tsx:521-542`).
 *
 * Placement follows the rest of this screen: the header row already carries the
 * ⋯ management menu (`AgentDetailActions`), so these two live in their own row
 * directly under the profile block. They are primary actions, not menu items —
 * burying "chat with this agent" inside ⋯ would hide the screen's most likely
 * intent.
 *
 * Gating is delegated to `lib/agent-primary-actions.ts`, which encodes web's
 * rules and, crucially, the "mount vs. deny" split:
 *
 *   - Chat is MOUNTED for any non-archived agent, even one the viewer cannot
 *     invoke. Pressing it explains why (`no_permission`) rather than the button
 *     being absent — an absent affordance reads as "this product has no chat",
 *     which is false.
 *   - Assign is mounted only when the viewer may assign (web `:537` does the
 *     same); a user who can never assign should not be shown a permanently
 *     dead control.
 *   - Both are withheld entirely for an archived agent, whose profile is
 *     read-only history.
 *
 * Feedback uses native `Alert`, matching every other mobile surface (there is
 * no toast infrastructure here). The failure this replaces is silence: before
 * this component existed the phone offered neither action at all, so the only
 * way to start a chat with the agent was to leave the screen and reselect it
 * from the chat tab's picker.
 */
import { useCallback, useMemo } from "react";
import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Agent } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import {
  agentChatHref,
  agentPrimaryActionVisibility,
  decideAssignAction,
  decideChatAction,
  type AgentPrimaryActionBlockReason,
  type AgentPrimaryActionOutcome,
} from "@/lib/agent-primary-actions";
import { canAssignAgent } from "@/lib/can-assign-agent";
import { useCurrentMemberRole } from "@/data/use-current-member-role";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export function AgentPrimaryActions({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const userId = useAuthStore((s) => s.user?.id);
  const { role, isResolved } = useCurrentMemberRole();

  // The mobile mirror of `canAssignAgentToIssue` — the same rule the assignee
  // and chat pickers use. `apps/mobile/CLAUDE.md` requires mirroring (not
  // importing) core logic, and requires mirroring THAT exact source; re-deriving
  // the private/workspace rule here from feel would be the drift the rule exists
  // to prevent.
  const canAssign = canAssignAgent(agent, userId, role);
  const runtimeBound = isAgentRuntimeBound(agent);
  const permissionsLoading = !isResolved;

  const visibility = agentPrimaryActionVisibility(agent, canAssign);
  // Memoised so the two `useCallback`s below actually stabilise instead of
  // being rebuilt on every render (which is what a fresh object literal in
  // their dependency list means).
  const input = useMemo(
    () => ({ agent, canAssign, permissionsLoading, runtimeBound }),
    [agent, canAssign, permissionsLoading, runtimeBound],
  );

  const explain = useCallback(
    (outcome: AgentPrimaryActionOutcome, action: "chat" | "assign") => {
      if (outcome.kind === "proceed") return false;
      const reason: AgentPrimaryActionBlockReason = outcome.reason;
      const title =
        reason === "runtime_required"
          ? t("agents.detail.runtimeRequiredTitle")
          : reason === "no_permission"
            ? t("agents.detail.noPermissionTitle")
            : t("agents.detail.permissionsLoadingTitle");
      const message =
        reason === "runtime_required"
          ? t("agents.detail.runtimeRequired")
          : reason === "permissions_loading"
            ? t("agents.detail.permissionsLoading")
            : action === "chat"
              ? t("agents.detail.dmNoPermission")
              : t("agents.detail.assignNoPermission");
      Alert.alert(title, message);
      return true;
    },
    [t],
  );

  const onChat = useCallback(() => {
    if (explain(decideChatAction(input), "chat")) return;
    if (!wsSlug) return;
    // `router.push` (not replace): the agent screen stays on the stack so the
    // back gesture returns to it, which is where the user came from.
    router.push(agentChatHref(wsSlug, agent.id));
  }, [agent.id, explain, input, wsSlug]);

  const onAssign = useCallback(() => {
    if (explain(decideAssignAction(input), "assign")) return;
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/new-issue",
      // `seedAgentId` switches the form into agent mode pointed at this agent
      // — see new-issue.tsx.
      params: { workspace: wsSlug, seedAgentId: agent.id },
    });
  }, [agent.id, explain, input, wsSlug]);

  if (!visibility.chat && !visibility.assign) return null;

  return (
    <View className="px-4 pt-3 flex-row gap-2">
      {visibility.chat ? (
        <ActionButton
          icon="chatbubble-outline"
          label={t("agents.detail.dm")}
          onPress={onChat}
        />
      ) : null}
      {visibility.assign ? (
        <ActionButton
          icon="add"
          label={t("agents.detail.assignWork")}
          onPress={onAssign}
          primary
        />
      ) : null}
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  primary = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={
        primary
          ? "flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2.5 active:opacity-80"
          : "flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-3 py-2.5 active:opacity-80"
      }
    >
      <Ionicons
        name={icon}
        size={16}
        color={primary ? "#ffffff" : "#71717a"}
      />
      <Text
        className={
          primary
            ? "text-body font-medium text-white"
            : "text-body font-medium text-foreground"
        }
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}
