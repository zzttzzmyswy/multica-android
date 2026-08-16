/**
 * Agent creation route chooser (more/agents/new). Mirrors web
 * `packages/views/agents/create/choose-create-method-page.tsx`: two entry
 * cards — manual ("Start blank") and AI ("Build with AI").
 *
 * The AI entry is a disabled "coming soon" card this round: the web AI flow
 * is a full builder-session conversation (ai-builder-session-page.tsx +
 * use-builder-session) that depends on the backend agent-builder session
 * API; both are P1 and deliberately do not block manual creation (MYS-329).
 */
import { Pressable, ScrollView, View } from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useWorkspaceStore } from "@/data/workspace-store";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

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
      disabled: false,
      onPress: () => {
        if (wsSlug) router.push(`/${wsSlug}/more/agents/new/manual`);
      },
    },
    {
      key: "ai",
      icon: "chatbubble-ellipses-outline" as const,
      title: t("agents.new.ai.title"),
      description: t("agents.new.ai.description"),
      comingSoon: true,
      disabled: true,
      onPress: () => {},
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
            disabled={mode.disabled}
            onPress={mode.onPress}
            accessibilityLabel={mode.title}
            className={cn(
              "rounded-xl border px-5 py-5 gap-1.5",
              mode.disabled
                ? "border-border bg-secondary/30 opacity-70"
                : "border-primary/30 bg-primary/[0.025] active:bg-secondary",
            )}
          >
            <View className="flex-row items-center gap-2">
              <View className="size-10 items-center justify-center rounded-lg bg-muted">
                <Ionicons name={mode.icon} size={20} color={theme.mutedForeground} />
              </View>
              {mode.comingSoon ? (
                <View className="px-2 py-0.5 rounded-full border border-border bg-muted">
                  <Text className="text-[10px] font-medium text-muted-foreground">
                    {t("agents.new.comingSoon")}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text className="text-base font-semibold text-foreground">
              {mode.title}
            </Text>
            <Text className="text-sm leading-5 text-muted-foreground">
              {mode.description}
            </Text>
            {!mode.comingSoon ? (
              <View className="flex-row items-center gap-1 pt-1">
                <Text className="text-xs font-medium text-foreground">
                  {t("agents.new.continue")}
                </Text>
                <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} />
              </View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}