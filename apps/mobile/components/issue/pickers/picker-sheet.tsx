/**
 * Bottom-sheet host for the shared picker bodies.
 *
 * Extracted from `batch-action-bar.tsx` (where it was local) so the issue
 * table's inline cell editor (MYS-1149) can host the same bodies in the same
 * shell — the two surfaces must look identical, otherwise the same status
 * list reads as two different controls.
 *
 * Two body sizing modes, because the bodies differ in how they size
 * themselves:
 *
 *   - `fill` — for bodies whose root is a `flex-1` list (Assignee, Project,
 *     Labels, the property value editor). A `flex-1` child inside a
 *     content-sized parent resolves to zero height, so the sheet has to
 *     supply a definite height. This was a latent bug in the batch bar's
 *     assignee sheet, whose list rendered against `max-h-[60%]` and
 *     collapsed.
 *   - default — for bodies that size to their content (Status, Priority:
 *     a plain ScrollView; date pickers: the native inline picker plus a
 *     header), which keeps a short list from floating in a tall sheet.
 *
 * Picker bodies render their own scrolling container, so there is
 * deliberately no nested scroll view here.
 */
import { Modal, Pressable, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";

/** Fraction of the screen the filled sheet occupies. */
const FILL_SCREEN_RATIO = 0.62;

export function PickerSheet({
  title,
  visible,
  onClose,
  fill = false,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  /** Give the body a definite height (see the module doc). */
  fill?: boolean;
  children: React.ReactNode;
}) {
  const { height } = useWindowDimensions();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-end">
          <Pressable
            onPress={() => {}}
            className={`bg-popover rounded-t-2xl ${
              fill ? "" : "max-h-[70%]"
            }`}
            style={fill ? { height: Math.round(height * FILL_SCREEN_RATIO) } : undefined}
          >
            <View className="px-4 py-3 border-b border-border flex-row items-center justify-between">
              <Text className="text-base font-semibold text-foreground">
                {title}
              </Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="close">
                <Ionicons name="close" size={20} color="currentColor" />
              </Pressable>
            </View>
            <View className={fill ? "flex-1" : "max-h-[60%]"}>{children}</View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
