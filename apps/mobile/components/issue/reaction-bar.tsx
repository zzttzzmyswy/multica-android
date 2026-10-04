/**
 * Reaction chip bar. Mobile RN port of
 * `packages/ui/components/common/reaction-bar.tsx`. Same `groupReactions`
 * algorithm so counts and "reacted by me" detection match web exactly —
 * counts-must-agree parity rule from apps/mobile/CLAUDE.md.
 *
 * The `+` entry point (iteration 179, G19) mirrors web's `QuickEmojiPicker`,
 * which `reaction-bar.tsx:79` renders unconditionally AFTER the chip list —
 * including when there are no chips at all. Mobile previously returned null on
 * an empty list, so there was no path to react to an issue from the phone.
 * Tapping `+` opens an inline quick row (the eight `QUICK_EMOJIS`, verbatim
 * from web) with a "More emojis…" item that opens the full picker.
 *
 * Why the quick row is an in-tree overlay rather than a popover: the bar sits
 * inside the issue timeline, which is a `SectionList` — a portalled popover
 * anchored to a row unmounts mid-scroll and leaves the picker stranded. An
 * absolutely-positioned panel inside the bar keeps the two together, and it is
 * the same pattern `components/issue/issue-view-bar.tsx` uses for its manage
 * sheet.
 */
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { QUICK_EMOJIS } from "@/lib/quick-emojis";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface ReactionItem {
  id: string;
  actor_type: string;
  actor_id: string;
  emoji: string;
}

interface GroupedReaction {
  emoji: string;
  count: number;
  reacted: boolean;
}

function groupReactions(
  reactions: ReactionItem[],
  currentUserId: string | undefined,
): GroupedReaction[] {
  const map = new Map<string, GroupedReaction>();
  for (const r of reactions) {
    let group = map.get(r.emoji);
    if (!group) {
      group = { emoji: r.emoji, count: 0, reacted: false };
      map.set(r.emoji, group);
    }
    group.count += 1;
    if (r.actor_type === "member" && r.actor_id === currentUserId) {
      group.reacted = true;
    }
  }
  return Array.from(map.values());
}

interface Props {
  reactions: ReactionItem[];
  currentUserId: string | undefined;
  onToggle: (emoji: string) => void;
  /**
   * Opens the full emoji picker. Omit to hide the "More emojis…" item — used
   * by call sites that have no full-picker route of their own.
   */
  onOpenFullPicker?: () => void;
  className?: string;
}

export function ReactionBar({
  reactions,
  currentUserId,
  onToggle,
  onOpenFullPicker,
  className,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const [quickOpen, setQuickOpen] = useState(false);
  const grouped = groupReactions(reactions, currentUserId);

  const pick = useCallback(
    (emoji: string) => {
      onToggle(emoji);
      setQuickOpen(false);
    },
    [onToggle],
  );

  return (
    <View className={cn("gap-1.5", className)}>
      <View className="flex-row flex-wrap items-center gap-1.5">
        {grouped.map((g) => (
          <Pressable
            key={g.emoji}
            onPress={() => onToggle(g.emoji)}
            accessibilityRole="button"
            accessibilityState={{ selected: g.reacted }}
            className={cn(
              "flex-row items-center gap-1 rounded-full border px-2 py-0.5",
              g.reacted
                ? "border-brand/30 bg-brand/10"
                : "border-border bg-background",
            )}
          >
            <Text className="text-xs">{g.emoji}</Text>
            <Text
              className={cn(
                "text-xs tabular-nums",
                g.reacted ? "text-brand" : "text-muted-foreground",
              )}
            >
              {g.count}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setQuickOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={t("issue.reaction.add")}
          accessibilityState={{ expanded: quickOpen }}
          hitSlop={6}
          className={cn(
            "h-6 w-6 items-center justify-center rounded-full active:bg-secondary",
            quickOpen && "bg-secondary",
          )}
        >
          {/* Web's trigger is a `SmilePlus` glyph. Ionicons has no
              smile-plus; a plain `+` reads as "add an attachment" in this
              bar, so the nearest equivalent — a smiley — carries the
              "react" meaning instead. */}
          <Ionicons name="happy-outline" size={14} color={muted} />
        </Pressable>
      </View>

      {quickOpen ? (
        <View className="rounded-xl border border-border bg-popover p-2 gap-1">
          <Text className="px-1 text-[11px] text-muted-foreground">
            {t("issue.reaction.quickPick")}
          </Text>
          <View className="flex-row flex-wrap gap-1">
            {QUICK_EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => pick(emoji)}
                accessibilityRole="button"
                accessibilityLabel={emoji}
                className="h-8 w-8 items-center justify-center rounded active:bg-secondary"
              >
                <Text className="text-base">{emoji}</Text>
              </Pressable>
            ))}
          </View>
          {onOpenFullPicker ? (
            <Pressable
              onPress={() => {
                setQuickOpen(false);
                onOpenFullPicker();
              }}
              accessibilityRole="button"
              className="rounded py-1.5 active:bg-secondary"
            >
              <Text className="text-center text-xs text-muted-foreground">
                {t("issue.reaction.moreEmojis")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
