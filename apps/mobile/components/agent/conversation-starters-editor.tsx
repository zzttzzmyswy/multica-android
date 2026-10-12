/**
 * Conversation-starters editor for the agent form (MUL-6629).
 *
 * Mobile counterpart of web's `ConversationStartersEditor`
 * (`packages/views/agents/components/conversation-starters-editor.tsx`). Up to
 * `AGENT_CONVERSATION_STARTERS_MAX` rows of {label, prompt}; a row is only
 * saveable once BOTH halves carry text, and the form blocks save (with a
 * visible reason) while any row is half-filled rather than dropping it behind
 * the author's back.
 *
 * The preview renders through the SAME resolver the chat empty state uses
 * (`selectConversationStarters`) and the SAME fallback list
 * (`fallbackConversationStarters`), so what an author sees here cannot drift
 * from what a new chat will actually show — including the "these are the
 * built-in defaults" case, which is how an author learns the three suggestions
 * they never wrote are replaceable.
 *
 * The preview rows are inert. A settings page must not offer a second,
 * non-functional way to "send" a prompt, and on a phone a tappable row that
 * silently does nothing is worse than a plain one.
 */
import { View } from "react-native";
import {
  AGENT_CONVERSATION_STARTER_LABEL_MAX_LENGTH,
  AGENT_CONVERSATION_STARTER_MAX_LENGTH,
  AGENT_CONVERSATION_STARTERS_MAX,
} from "@multica/core/agents";
import type { AgentConversationStarter } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { IconButton } from "@/components/ui/icon-button";
import { ConversationStarterList } from "@/components/chat/conversation-starter-list";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  value: AgentConversationStarter[];
  onChange: (value: AgentConversationStarter[]) => void;
  /** The rows a new chat would show right now — the resolved preview. Passed
   *  in rather than recomputed so the caller and the preview cannot disagree
   *  about which rows count. */
  preview: AgentConversationStarter[];
  previewIsFallback: boolean;
  disabled?: boolean;
}

export function ConversationStartersEditor({
  value,
  onChange,
  preview,
  previewIsFallback,
  disabled = false,
}: Props) {
  const { t } = useTranslation();
  const hasIncompleteRow = value.some(
    (item) => !item.label.trim() || !item.prompt.trim(),
  );

  const update = (
    index: number,
    field: keyof AgentConversationStarter,
    nextValue: string,
  ) => {
    onChange(
      value.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: nextValue } : item,
      ),
    );
  };

  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-body font-medium text-foreground">
          {t("agents.starters.label")}
        </Text>
        <Text className="text-caption text-muted-foreground">
          {t("agents.starters.hint")}
        </Text>
      </View>

      {value.map((item, index) => (
        <View
          key={index}
          className="gap-2 rounded-lg border border-border bg-secondary/30 p-3"
        >
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <TextField
                value={item.label}
                maxLength={AGENT_CONVERSATION_STARTER_LABEL_MAX_LENGTH}
                editable={!disabled}
                accessibilityLabel={t("agents.starters.labelAria", {
                  number: index + 1,
                })}
                placeholder={t("agents.starters.labelPlaceholder")}
                onChangeText={(text) => update(index, "label", text)}
              />
            </View>
            <IconButton
              name="trash-outline"
              disabled={disabled}
              accessibilityLabel={t("agents.starters.remove", {
                number: index + 1,
              })}
              onPress={() =>
                onChange(value.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          </View>
          <AutosizeTextArea
            value={item.prompt}
            maxLength={AGENT_CONVERSATION_STARTER_MAX_LENGTH}
            editable={!disabled}
            minHeight={72}
            maxHeight={160}
            accessibilityLabel={t("agents.starters.promptAria", {
              number: index + 1,
            })}
            placeholder={t("agents.starters.promptPlaceholder")}
            onChangeText={(text) => update(index, "prompt", text)}
            className="border border-border rounded-md px-3 py-2 text-body"
          />
        </View>
      ))}

      {/* A full list offers no add button rather than a disabled one: the
          limit is a server bound, and the hint below says why. */}
      {value.length < AGENT_CONVERSATION_STARTERS_MAX ? (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onPress={() => onChange([...value, { label: "", prompt: "" }])}
          className="self-start"
        >
          <Text className="text-body text-foreground">
            {t("agents.starters.add")}
          </Text>
        </Button>
      ) : (
        <Text className="text-caption text-muted-foreground">
          {t("agents.starters.max")}
        </Text>
      )}

      {hasIncompleteRow ? (
        <Text className="text-caption text-destructive" accessibilityLiveRegion="polite">
          {t("agents.starters.incomplete")}
        </Text>
      ) : null}

      <View className="gap-2 rounded-lg border border-dashed border-border bg-secondary/20 px-3 py-3">
        <Text className="text-caption font-medium text-muted-foreground">
          {t("agents.starters.previewLabel")}
        </Text>
        {/* No `onPick`: the preview must look like the real thing without
            offering a second, non-functional way to "send" a prompt. */}
        <ConversationStarterList starters={preview} />
        {previewIsFallback ? (
          <Text className="text-caption text-muted-foreground">
            {t("agents.starters.previewDefaults")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
