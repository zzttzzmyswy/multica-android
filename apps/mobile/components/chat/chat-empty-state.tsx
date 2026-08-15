/**
 * Empty-state surface shown when the active session has no messages.
 *
 * Two modes mirror web (packages/views/chat/components/chat-window.tsx
 * `EmptyState`):
 *
 *   - first-time (the workspace has never started a chat) → educate. Tell
 *     the user what chat is for; don't surface starter prompts yet, they
 *     presume context the user doesn't have.
 *   - returning (at least one prior session exists) → starter prompts.
 *     Three taps, three common workflows; tapping prefills the composer
 *     draft so the user can edit before sending.
 *
 * Copy mirrors the web `chat.json` namespace 1:1. Mobile doesn't have
 * i18n yet so the strings are inlined in English — when mobile adopts
 * i18n the lookup keys (`empty_state.first_time_title` etc.) are already
 * established on the web side, so the migration is a literal
 * key-by-key swap.
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/react";

const STARTER_PROMPTS: { icon: string; textKey: string }[] = [
  { icon: "📋", textKey: "chat.prompt1" },
  { icon: "📝", textKey: "chat.prompt2" },
  { icon: "💡", textKey: "chat.prompt3" },
];

interface Props {
  hasSessions: boolean;
  agentName?: string;
  onPickPrompt: (text: string) => void;
}

export function ChatEmptyState({ hasSessions, agentName, onPickPrompt }: Props) {
  const { t } = useTranslation();

  // First-time experience: educate before suggesting actions. Starter
  // prompts here would presume the user already knows what chat is for.
  if (!hasSessions) {
    return (
      <View className="flex-1 items-center justify-center px-6 py-8">
        <View className="max-w-xs items-center gap-3">
          <Text className="text-base font-semibold text-foreground text-center">
            {t("chat.emptyFirstTitle")}
          </Text>
          <Text className="text-sm text-muted-foreground text-center">
            <Text className="text-sm text-muted-foreground">
              ✨ {t("chat.emptyFirstIntro")}
            </Text>
            <Text className="text-sm font-medium text-foreground">
              {t("chat.emptyFirstStrong")}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {t("chat.emptyFirstOutro")}
            </Text>
          </Text>
          <Text className="text-sm text-muted-foreground text-center">
            {t("chat.emptyFirstLine")}
          </Text>
        </View>
      </View>
    );
  }

  // Returning user: starter prompts are the fastest path back to action.
  const title = agentName
    ? t("chat.welcomeAgent", { name: agentName })
    : t("chat.welcomeBack");
  return (
    <View className="flex-1 items-center justify-center px-6 py-8 gap-5">
      <View className="items-center gap-1">
        <Text className="text-base font-semibold text-foreground text-center">
          {title}
        </Text>
        <Text className="text-sm text-muted-foreground text-center">
          {t("chat.tryAsking")}
        </Text>
      </View>
      <View className="w-full max-w-xs gap-2">
        {STARTER_PROMPTS.map((p) => {
          const promptText = t(p.textKey);
          return (
            <Button
              key={p.textKey}
              variant="outline"
              onPress={() => onPickPrompt(promptText)}
              className="h-auto justify-start px-3 py-2.5"
              accessibilityLabel={promptText}
            >
              <Text className="text-sm text-foreground">
                <Text className="text-sm">{p.icon}  </Text>
                {promptText}
              </Text>
            </Button>
          );
        })}
      </View>
    </View>
  );
}
