/**
 * Multi-select checklist sheet — shared by the agent-create form's skill and
 * member pickers. One interaction: a Modal listing toggleable rows with a
 * checkmark on the selected ones and a Done control in the header. The caller
 * owns the selected set (and how a row is visually led — icon tile / avatar),
 * this owns the chrome.
 *
 * Employs the same transparent-Modal + backdrop pattern as
 * components/chat/agent-picker-sheet.tsx.
 */
import { Modal, Pressable, ScrollView, View, ActivityIndicator } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export interface MultiSelectRow {
  key: string;
  title: string;
  subtitle?: string;
  disabled?: boolean;
}

interface Props {
  visible: boolean;
  title: string;
  rows: MultiSelectRow[];
  loading?: boolean;
  selectedKeys: ReadonlySet<string>;
  emptyText: string;
  /** Rendered before the title on each row. */
  leading?: (row: MultiSelectRow) => ReactNode;
  onToggle: (key: string) => void;
  onClose: () => void;
}

export function MultiSelectSheet({
  visible,
  title,
  rows,
  loading = false,
  selectedKeys,
  emptyText,
  leading,
  onToggle,
  onClose,
}: Props) {
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
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden">
              <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
                <Text className="text-base font-semibold text-foreground">
                  {title}
                </Text>
                <Pressable onPress={onClose} accessibilityLabel={t("common.done")}>
                  <Text className="text-sm font-medium text-brand">
                    {t("common.done")}
                  </Text>
                </Pressable>
              </View>
              <ScrollView className="max-h-96">
                {loading ? (
                  <View className="py-8 items-center">
                    <ActivityIndicator />
                  </View>
                ) : rows.length === 0 ? (
                  <View className="px-4 py-8">
                    <Text className="text-sm text-muted-foreground text-center">
                      {emptyText}
                    </Text>
                  </View>
                ) : (
                  rows.map((row) => {
                    const selected = selectedKeys.has(row.key);
                    const disabled = !!row.disabled;
                    return (
                      <Pressable
                        key={row.key}
                        disabled={disabled}
                        onPress={() => onToggle(row.key)}
                        className={cn(
                          "flex-row items-center gap-3 px-4 py-3",
                          disabled ? "opacity-50" : "active:bg-secondary",
                          selected && "bg-secondary",
                        )}
                        accessibilityLabel={row.title}
                      >
                        {leading ? leading(row) : null}
                        <View className="flex-1 min-w-0 gap-0.5">
                          <Text
                            className="text-sm font-medium text-foreground"
                            numberOfLines={1}
                          >
                            {row.title}
                          </Text>
                          {row.subtitle ? (
                            <Text
                              className="text-xs text-muted-foreground"
                              numberOfLines={2}
                            >
                              {row.subtitle}
                            </Text>
                          ) : null}
                        </View>
                        <Ionicons
                          name={selected ? "checkmark-circle" : "ellipse-outline"}
                          size={20}
                          color={
                            selected ? theme.brand : theme.mutedForeground
                          }
                        />
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}