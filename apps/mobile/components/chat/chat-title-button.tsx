/**
 * Centred, tappable title region for the Chat tab's native Stack header.
 * Rendered as `headerTitle: () => <ChatTitleButton ... />` so iOS positions
 * it where it expects the screen title, but the whole region is a Pressable
 * — tap opens the sessions + agent picker sheet.
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Agent, ChatSession } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  currentSession: ChatSession | null;
  currentAgent: Agent | null;
  onPress: () => void;
}

export function ChatTitleButton({
  currentSession,
  currentAgent,
  onPress,
}: Props) {
  const { t } = useTranslation();
  const palette = useThemePalette();
  const agentName = currentAgent?.name ?? t("nav.chat");
  const subtitle = currentSession?.title || t("a11y.newChat");

  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      className="min-w-0 max-w-full shrink flex-row items-center gap-2 rounded-xl px-2 py-1 active:bg-secondary"
      accessibilityRole="button"
      accessibilityLabel={t("a11y.sessionsAndPicker")}
    >
      <ActorAvatar
        type={currentAgent ? "agent" : null}
        id={currentAgent?.id ?? null}
        size={24}
        showPresence
      />
      <View className="min-w-0 shrink">
        <View className="flex-row items-center gap-1">
          <Text
            className="shrink text-title-sm font-semibold text-foreground"
            numberOfLines={1}
          >
            {agentName}
          </Text>
          <Ionicons name="chevron-down" size={12} color={palette.mutedForeground} />
        </View>
        <Text
          className="text-caption text-muted-foreground"
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}
