/**
 * The stack of starter rows in a chat's empty state (MUL-6629).
 *
 * Omit `onPick` to render the same rows as inert presentation — that is the
 * agent editor's preview, which must look like the real thing without offering
 * a second, non-functional way to "send" a prompt from a settings page. Mirror
 * of web's `ConversationStarterList` (`packages/views/chat/components/
 * conversation-starter-list.tsx`), including that overload.
 *
 * ONE component for both surfaces on purpose: a preview that re-implements the
 * reader's rows drifts from what it previews the first time either side gains a
 * style, and the author then configures against a picture that is not true.
 */
import { View } from "react-native";
import type { AgentConversationStarter } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";

interface Props {
  starters: AgentConversationStarter[];
  /** Receive a tap on a row, or omit for the inert preview. */
  onPick?: (prompt: string) => void;
  /**
   * Emoji prefixed to each row, by index. The chat empty state passes them for
   * the DEFAULT rows only: those are the product's copy, so they get the
   * product's decoration, while an author's own words are left alone. Omit
   * entirely for no icons.
   */
  icons?: (string | undefined)[];
}

export function ConversationStarterList({ starters, onPick, icons }: Props) {
  if (!onPick) {
    return (
      <View className="w-full gap-2" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {starters.map((item, index) => (
          <View
            key={index}
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <Text className="text-body text-foreground" numberOfLines={1}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View className="w-full gap-2">
      {starters.map((item, index) => {
        // Two configured rows may legitimately share a label, so the index is
        // the only honest key here. The list is short, static, and never
        // reordered in place.
        const icon = icons?.[index];
        return (
          <Button
            key={index}
            variant="outline"
            onPress={() => onPick(item.prompt)}
            className="h-auto justify-start px-3 py-2.5"
            accessibilityLabel={item.label}
          >
            <Text className="text-body text-foreground">
              {icon ? <Text className="text-body">{icon}  </Text> : null}
              {item.label}
            </Text>
          </Button>
        );
      })}
    </View>
  );
}
