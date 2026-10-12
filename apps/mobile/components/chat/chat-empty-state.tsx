/**
 * Empty-state surface shown when the active session has no messages.
 *
 * Two modes mirror web (packages/views/chat/components/chat-window.tsx
 * `EmptyState`):
 *
 *   - first-time (the workspace has never started a chat) → educate. Tell
 *     the user what chat is for; don't surface starter prompts yet, they
 *     presume context the user doesn't have.
 *   - returning (at least one prior session exists) → the agent's starter
 *     prompts.
 *
 * WHOSE prompts those are is the whole point (MUL-6629): they come from the
 * SELECTED AGENT's `conversation_starters` when its author configured any, and
 * from the localized defaults only when it did not. Until this iteration the
 * screen rendered the same three hard-coded strings for every agent, so on any
 * agent that HAD been configured the phone showed buttons nobody wrote —
 * plausible-looking ones, which is worse than an obviously empty state.
 * `selectConversationStarters` owns that decision; the agent editor's preview
 * reads the same helper, so what an author sees there is what ships here.
 *
 * Tapping one prefills the composer draft so the user can edit before sending.
 *
 * The three defaults are the web `chat.json` `conversation_starters.*`
 * sentences verbatim (`chat.starters.*` here), so a reader on either client is
 * offered the same three suggestions in the same words. The surrounding
 * empty-state copy keeps its own `empty_state.*` lineage from web.
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ConversationStarterList } from "@/components/chat/conversation-starter-list";
import { selectConversationStarters } from "@multica/core/agents";
import type { Agent } from "@multica/core/types";
import { fallbackConversationStarters } from "@/lib/conversation-starters-mobile";
import { useTranslation } from "@/lib/i18n/react";

/**
 * Emoji per fallback row, keyed by the row's index. The configured rows carry
 * no emoji: they are the author's own words and decorating them would be
 * editorialising on their copy. The defaults are ours, so they get ours.
 */
const STARTER_ICONS = ["📋", "📝", "💡"];

interface Props {
  hasSessions: boolean;
  /** The agent this empty state belongs to. Null while none is resolved —
   *  the defaults still render, since the composer is usable either way. */
  agent?: Agent | null;
  agentName?: string;
  onPickPrompt: (text: string) => void;
  /** Opens the agent editor on its starters, or null to hide the affordance.
   *  The CONTAINER resolves this (chat screen reads the permission and the
   *  backend capability), so this component stays presentational and a reader
   *  never gets a row that leads somewhere they cannot write. */
  onCustomizeStarters?: (() => void) | null;
}

export function ChatEmptyState({
  hasSessions,
  agent = null,
  agentName,
  onPickPrompt,
  onCustomizeStarters = null,
}: Props) {
  const { t } = useTranslation();

  // First-time experience: educate before suggesting actions. Starter
  // prompts here would presume the user already knows what chat is for.
  if (!hasSessions) {
    return (
      <View className="flex-1 items-center justify-center px-6 py-8">
        <View className="max-w-xs items-center gap-3">
          <Text className="text-title-sm font-semibold text-foreground text-center">
            {t("chat.emptyFirstTitle")}
          </Text>
          <Text className="text-body text-muted-foreground text-center">
            <Text className="text-body text-muted-foreground">
              ✨ {t("chat.emptyFirstIntro")}
            </Text>
            <Text className="text-body font-medium text-foreground">
              {t("chat.emptyFirstStrong")}
            </Text>
            <Text className="text-body text-muted-foreground">
              {t("chat.emptyFirstOutro")}
            </Text>
          </Text>
          <Text className="text-body text-muted-foreground text-center">
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
  // The author's rows when they configured any, ours when they didn't. A
  // half-filled stored row is filtered out by the resolver rather than
  // rendered as a blank button — the same treatment web gives it.
  const { starters, isFallback } = selectConversationStarters(
    agent?.conversation_starters,
    fallbackConversationStarters(t),
  );
  return (
    <View className="flex-1 items-center justify-center px-6 py-8 gap-5">
      <View className="items-center gap-1">
        <Text className="text-title-sm font-semibold text-foreground text-center">
          {title}
        </Text>
        <Text className="text-body text-muted-foreground text-center">
          {t("chat.tryAsking")}
        </Text>
      </View>
      <View className="w-full max-w-xs">
        <ConversationStarterList
          starters={starters}
          icons={isFallback ? STARTER_ICONS : undefined}
          onPick={onPickPrompt}
        />
      </View>
      {onCustomizeStarters ? (
        <Button
          variant="ghost"
          onPress={onCustomizeStarters}
          className="h-auto px-2 py-1"
          accessibilityLabel={t("chat.customizeStarters")}
        >
          <Text className="text-caption text-muted-foreground">
            {t("chat.customizeStarters")}
          </Text>
        </Button>
      ) : null}
    </View>
  );
}
