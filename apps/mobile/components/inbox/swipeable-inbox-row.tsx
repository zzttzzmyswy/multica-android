/**
 * Swipe-to-reveal-action wrapper for inbox rows.
 *
 * iOS pattern reference: Mail.app / Linear iOS / Things — a destructive
 * red Archive action revealed by a leftward drag in the MAIN list, and a
 * primary-coloured Restore action (return-up-back) in the ARCHIVED list.
 * **Reveal-only, no auto-fire**: the previous version archived on full swipe
 * past threshold, which felt aggressive (no peek, easy to trigger by accident
 * on a fast vertical scroll). Mail.app / Linear require an explicit tap on
 * the revealed action; we now match that. A medium haptic fires once when the
 * row crosses the action width during the drag so the gesture still feels
 * confirmed.
 *
 * Why ReanimatedSwipeable (not the legacy Swipeable): RNGH 2.20+ ships the
 * Reanimated-driven implementation that integrates cleanly with the
 * existing reanimated@4 install and runs the swipe on the UI thread (the
 * legacy version uses Animated, which janks on heavy lists). The
 * gesture-handler root is already mounted in apps/mobile/app/_layout.tsx.
 *
 * Behaviour notes:
 *   - `friction=2` slightly slows the drag so the action doesn't open by
 *     accident on a fast vertical scroll that catches some horizontal motion.
 *   - `rightThreshold=80` is the open-detent — releasing past it keeps the
 *     action button revealed; releasing short of it snaps closed. No
 *     auto-action on cross.
 *   - We `swipeable.close()` before invoking the action so the row's exit
 *     from the FlatList (driven by the optimistic mutation flipping the row
 *     state, which the parent's dedup helpers filter out) doesn't race the
 *     spring close.
 */
import { useRef } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedReaction,
  runOnJS,
} from "react-native-reanimated";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import type { InboxItem } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { InboxRow } from "./inbox-row";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";

const ACTION_WIDTH = 80;

interface Props {
  item: InboxItem;
  onPress: () => void;
  /** Swipe action — archive in the main list, restore in the archived view. */
  action: "archive" | "restore";
  onAction: () => void;
  /** Long-press opens the row's menu (archive / mark-unread …). */
  onLongPress?: () => void;
  /** Archived sub-view styling: rows render as read (no unread dot). */
  archived?: boolean;
}

export function SwipeableInboxRow({
  item,
  onPress,
  onAction,
  onLongPress,
  action = "archive",
  archived,
}: Props) {
  const ref = useRef<SwipeableMethods>(null);

  const fireAction = () => {
    // Close first so the swipe spring doesn't fight the row's removal from
    // FlatList on the next render tick.
    ref.current?.close();
    onAction();
  };

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={ACTION_WIDTH}
      renderRightActions={(_progress, drag) => (
        <RowAction
          action={action}
          onPress={fireAction}
          drag={drag}
        />
      )}
    >
      <InboxRow
        item={item}
        onPress={onPress}
        onLongPress={onLongPress}
        archived={archived}
      />
    </ReanimatedSwipeable>
  );
}

function RowAction({
  action,
  onPress,
  drag,
}: {
  action: "archive" | "restore";
  onPress: () => void;
  drag: SharedValue<number>;
}) {
  const { t } = useTranslation();
  // One-shot haptic when the drag crosses the action width threshold.
  // useAnimatedReaction runs on the UI thread; runOnJS bridges to the
  // Haptics.impactAsync call which has to live on JS.
  useAnimatedReaction(
    () => drag.value <= -ACTION_WIDTH,
    (crossed, prev) => {
      if (crossed && !prev) {
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
      }
    },
    [],
  );

  const isRestore = action === "restore";
  return (
    <Animated.View style={{ width: ACTION_WIDTH }}>
      <Pressable
        onPress={onPress}
        accessibilityLabel={
          isRestore ? t("inbox.menu.unarchive") : t("common.archive")
        }
        className={cn(
          "flex-1 items-center justify-center",
          isRestore ? "bg-brand" : "bg-destructive",
        )}
      >
        <View className="items-center gap-0.5">
          <Ionicons
            name={isRestore ? "return-up-back" : "archive-outline"}
            size={20}
            color="white"
          />
          <Text className="text-xs text-white">
            {isRestore ? t("inbox.menu.unarchive") : t("common.archive")}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}