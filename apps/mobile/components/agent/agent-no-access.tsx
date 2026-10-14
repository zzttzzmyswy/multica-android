/**
 * "You don't have access to this agent" — the 403 face of the agent detail
 * route.
 *
 * The twin of the not-found face, and the reason the two have to be separate
 * components rather than two message props: they make OPPOSITE claims about the
 * same slot. 「该智能体不存在或已被删除」 says the agent is gone; this one says it
 * is there and you may not look at it. Rendering the first for a private agent
 * is a false statement the user has no way to check — the agent is running, its
 * owner sees it, and the user is told it was deleted (MYS-2161).
 *
 * Web's counterpart is the `Lock` branch of
 * `packages/views/agents/components/agent-detail-page.tsx:199-215`, whose copy
 * this mirrors (`agents.detail.no_access_title` / `_hint` / `back_to_agents_full`
 * already exist in `packages/views/locales/*`; the mobile keys are the flat
 * `agents.noAccess*` equivalents).
 *
 * The "back to agents" action is not decoration here. The reachable path into
 * this face is a deep link (`multica://…/more/agents/<id>`, declared in
 * app.config.ts:43), and a deep-linked entry has no history to pop — the header
 * back button would drop the user wherever the app happened to be. The button
 * gives the one destination that makes sense: the agents list.
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function AgentNoAccess({
  onBackToAgents,
}: {
  /** Navigates to the agents list. Owned by the route, which knows the
   *  workspace slug; this component stays unaware of routing. */
  onBackToAgents: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();

  return (
    <View className="flex-1 items-center justify-center gap-3 bg-background px-8">
      {/* `lock-closed-outline` is the same icon the app already uses for a
          private agent's visibility label (`agents.visibility.private`,
          agent-access-picker.tsx:214) — so the shape reads as "private" here
          for the same reason it does there. Web uses `Lock`; this is its
          Ionicons equivalent, not a different idea. */}
      <Ionicons
        name="lock-closed-outline"
        size={42}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="text-title-sm font-medium text-foreground text-center">
        {t("agents.detail.noAccessTitle")}
      </Text>
      <Text className="text-body text-muted-foreground text-center">
        {t("agents.detail.noAccessHint")}
      </Text>
      <Pressable
        onPress={onBackToAgents}
        accessibilityRole="button"
        className="mt-1 rounded-md bg-secondary px-3 py-1.5 active:opacity-70"
      >
        <Text className="text-caption font-medium text-foreground">
          {t("agents.detail.noAccessBackToAgents")}
        </Text>
      </Pressable>
    </View>
  );
}
