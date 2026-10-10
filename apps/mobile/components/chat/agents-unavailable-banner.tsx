/**
 * Banner shown when the agent listing the chat tab needs *failed to load*, so
 * the tab cannot tell whether this workspace has an agent to talk to.
 *
 * The sibling of `NoAgentBanner`, and the reason it exists (MYS-1924, gap 1):
 * the availability read resolved `isFetched`, which React Query counts a failed
 * attempt toward, so a timeout rendered the *no-agent* banner — 「暂无可用智能体」
 * plus advice to go add an agent — over a workspace that had them. On mobile
 * the same value also disabled the composer, so the chat was locked and the
 * only advice pointed at a create-agent flow that would have been pointless.
 *
 * This banner therefore says what actually happened ("could not load"), claims
 * nothing about the workspace, and offers the one action that can resolve it:
 * a retry that re-runs the read. It is deliberately *not* a route into
 * More → Agents, because the agent list is exactly what could not be read.
 *
 * Rendered in place of `NoAgentBanner`; the two are mutually exclusive because
 * only `"error"` and `"none"` respectively reach them.
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function AgentsUnavailableBanner({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  return (
    <View className="mx-3 mt-2 mb-1 rounded-xl border border-border bg-secondary/50 px-3 py-2">
      <View className="flex-row items-center gap-1.5">
        <Ionicons
          name="cloud-offline-outline"
          size={14}
          color={theme.mutedForeground}
        />
        <Text className="flex-1 text-body font-medium text-foreground">
          {t("chat.agentsUnavailableTitle")}
        </Text>
      </View>
      <Text className="text-caption text-muted-foreground mt-0.5">
        {t("chat.agentsUnavailableBody")}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        className="self-start mt-1.5 rounded-md bg-secondary px-2.5 py-1 active:opacity-70"
      >
        <Text className="text-caption font-medium text-foreground">
          {t("common.retry")}
        </Text>
      </Pressable>
    </View>
  );
}
