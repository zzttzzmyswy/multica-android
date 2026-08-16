/**
 * Agent creation route chooser (more/agents/new). Mirrors web
 * `packages/views/agents/create/choose-create-method-page.tsx`: two entry
 * cards — manual ("Start blank") and AI ("Build with AI").
 *
 * The AI card opens the AI-builder setup (more/agents/new/ai): pick a runtime,
 * resume an unfinished creation conversation or start a new builder-session
 * chat that back-fills the configuration form from the assistant's
 * `<agent_draft>` replies.
 */
import { Pressable, ScrollView, View } from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useWorkspaceStore } from "@/data/workspace-store";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export default function ChooseAgentCreateMethodPage() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const modes = [
    {
      key: "manual",
      icon: "document-text-outline" as const,
      title: t("agents.new.manual.title"),
      description: t("agents.new.manual.description"),
      onPress: () => {
        if (wsSlug) router.push(`/${wsSlug}/more/agents/new/manual`);
      },
    },
    {
      key: "ai",
      icon: "chatbubble-ellipses-outline" as const,
      title: t("agents.new.ai.title"),
      description: t("agents.new.ai.description"),
      onPress: () => {
        if (wsSlug) router.push(`/${wsSlug}/more/agents/new/ai`);
      },
    },
  ];

  return (
    <>
      <Stack.Screen
        options={{
          title: t("screen.agents"),
          headerBackTitle: t("common.back"),
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="px-5 py-10 gap-6"
      >
        <View className="gap-1">
          <Text className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("agents.new.eyebrow")}
          </Text>
          <Text className="text-2xl font-semibold tracking-tight text-foreground">
            {t("agents.new.chooseTitle")}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t("agents.new.chooseDescription")}
          </Text>
        </View>

        {modes.map((mode) => (
          <Pressable
            key={mode.key}
            onPress={mode.onPress}
            accessibilityLabel={mode.title}
            className="rounded-xl border border-primary/30 bg-primary/[0.025] px-5 py-5 gap-1.5 active:bg-secondary"
          >
            <View className="flex-row items-center gap-2">
              <View className="size-10 items-center justify-center rounded-lg bg-muted">
                <Ionicons name={mode.icon} size={20} color={theme.mutedForeground} />
              </View>
            </View>
            <Text className="text-base font-semibold text-foreground">
              {mode.title}
            </Text>
            <Text className="text-sm leading-5 text-muted-foreground">
              {mode.description}
            </Text>
            <View className="flex-row items-center gap-1 pt-1">
              <Text className="text-xs font-medium text-foreground">
                {t("agents.new.continue")}
              </Text>
              <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} />
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}