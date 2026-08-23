/**
 * Property icon single-select modal (MYS-675). Mirrors web's
 * PropertyIconPicker (`packages/views/common/property-icon.tsx`): a catalog
 * grid where tapping an option selects it (highlighted) and closes; a remove
 * row appears at the bottom when a selection exists. Rendered as a bottom
 * sheet so the 6-column grid stays reachable on small screens.
 */
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { PROPERTY_ICON_OPTIONS } from "@/lib/property-icons";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function PropertyIconPickerModal({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-end">
          <Pressable onPress={() => {}} className="bg-popover rounded-t-2xl max-h-[75%]">
            <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
              <Text className="text-base font-semibold text-foreground">
                {t("properties.form.iconPickerTitle")}
              </Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color={theme.mutedForeground} />
              </Pressable>
            </View>
            <ScrollView
              className="max-h-[55%] min-h-[120px]"
              contentContainerClassName="px-4 py-3"
            >
              <View className="flex-row flex-wrap gap-2">
                {PROPERTY_ICON_OPTIONS.map((option) => {
                  const selected = option.value === value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => {
                        onSelect(option.value);
                        onClose();
                      }}
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected }}
                      className={cn(
                        "w-11 h-11 items-center justify-center rounded-md border",
                        selected
                          ? "bg-secondary border-foreground"
                          : "border-transparent active:bg-secondary",
                      )}
                    >
                      <Ionicons
                        name={option.glyph}
                        size={20}
                        color={
                          selected ? theme.foreground : theme.mutedForeground
                        }
                      />
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            {value ? (
              <View className="border-t border-border px-4 py-2.5">
                <Pressable
                  onPress={() => {
                    onSelect("");
                    onClose();
                  }}
                  className="flex-row items-center gap-2 rounded-md px-2 py-2 active:bg-secondary"
                  accessibilityLabel={t("properties.form.iconRemove")}
                >
                  <Ionicons
                    name="close-circle-outline"
                    size={18}
                    color={theme.mutedForeground}
                  />
                  <Text className="text-sm text-muted-foreground">
                    {t("properties.form.iconRemove")}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}