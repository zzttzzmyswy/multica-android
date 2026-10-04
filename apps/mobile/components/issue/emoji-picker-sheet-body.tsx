/**
 * Shared body for the full emoji picker sheet (iteration 179, G19).
 *
 * Two routes render this — the per-comment picker
 * (`issue/[id]/comment/[commentId]/emoji-picker.tsx`) and the issue-level one
 * (`issue/[id]/emoji-picker.tsx`). They differ only in which reaction list
 * they read and which toggle mutation they fire, so the sheet chrome, the
 * theme wiring and the "already applied → remove" semantics live here once.
 * Copying the ~90-line body into a second route file would have duplicated the
 * emoji-keyboard theming, which is the part most likely to drift.
 */
import { useCallback } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { EmojiKeyboard, type EmojiType } from "rn-emoji-keyboard";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

/**
 * The fields the toggle decision reads. `Reaction` (comments) and
 * `IssueReaction` (issues) both satisfy it but differ in their owning-id
 * field, so the body is generic over the caller's own type and hands the
 * matched entry straight back — the route passes it to its own mutation
 * without a cast.
 */
interface ReactionLike {
  id: string;
  emoji: string;
  actor_type: string;
  actor_id: string;
}

interface Props<T extends ReactionLike> {
  title: string;
  /** Reactions already on the target, for the toggle decision. */
  reactions: T[];
  currentUserId: string | undefined;
  onSelect: (emoji: string, existing: T | undefined) => void;
}

export function EmojiPickerSheetBody<T extends ReactionLike>({
  title,
  reactions,
  currentUserId,
  onSelect,
}: Props<T>) {
  const { colorScheme } = useColorScheme();

  const handleSelect = useCallback(
    (picked: EmojiType) => {
      const existing = reactions.find(
        (r) =>
          r.emoji === picked.emoji &&
          r.actor_type === "member" &&
          r.actor_id === currentUserId,
      );
      onSelect(picked.emoji, existing);
      router.back();
    },
    [reactions, currentUserId, onSelect],
  );

  const theme = THEME[colorScheme];

  return (
    <View className="flex-1">
      <View className="px-4 pt-3 pb-2">
        <Text className="text-lg font-semibold text-foreground">{title}</Text>
      </View>
      <View className="flex-1">
        <EmojiKeyboard
          onEmojiSelected={handleSelect}
          enableSearchBar
          enableRecentlyUsed
          categoryPosition="top"
          theme={{
            backdrop: theme.background,
            knob: theme.mutedForeground,
            container: theme.popover,
            header: theme.foreground,
            skinTonesContainer: theme.secondary,
            category: {
              icon: theme.mutedForeground,
              iconActive: theme.foreground,
              container: theme.popover,
              containerActive: theme.secondary,
            },
            search: {
              background: theme.secondary,
              text: theme.foreground,
              placeholder: theme.mutedForeground,
              icon: theme.mutedForeground,
            },
            customButton: {
              icon: theme.mutedForeground,
              iconPressed: theme.foreground,
              background: theme.secondary,
              backgroundPressed: theme.muted,
            },
            emoji: {
              selected: theme.secondary,
            },
          }}
        />
      </View>
    </View>
  );
}
