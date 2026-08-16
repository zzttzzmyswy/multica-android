/**
 * Runtime picker for the agent-create form — bottom Modal listing the online
 * runtimes the current member may create an agent on. Mirrors web
 * `packages/views/agents/components/runtime-picker.tsx` semantics: only
 * online + usable runtimes are choosable (usableRuntimes in
 * lib/agent-create.ts applies the same predicate), each row shows the display
 * label + provider, and the server remains the authoritative gate.
 *
 * Also mirrors the settings page's runtime row: a runtime name is only a
 * label, so the health/avatar line doubles as the private/public badge when
 * the runtime is not shared (visibility private → "Private" chip next to the
 * online dot).
 */
import { Modal, Pressable, ScrollView, View, ActivityIndicator } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { runtimeDisplayLabel } from "@multica/core/runtimes";
import type { RuntimeDevice } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface Props {
  visible: boolean;
  runtimes: RuntimeDevice[];
  loading: boolean;
  selectedId: string | null;
  onPick: (runtime: RuntimeDevice) => void;
  onClose: () => void;
}

export function RuntimePickerSheet({
  visible,
  runtimes,
  loading,
  selectedId,
  onPick,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

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
              <View className="px-4 py-3 border-b border-border">
                <Text className="text-base font-semibold text-foreground">
                  {t("agents.new.runtimeLabel")}
                </Text>
              </View>
              <ScrollView className="max-h-96">
                {loading ? (
                  <View className="py-8 items-center">
                    <ActivityIndicator />
                  </View>
                ) : runtimes.length === 0 ? (
                  <View className="px-4 py-8">
                    <Text className="text-sm text-muted-foreground text-center">
                      {t("agents.new.runtimesNone")}
                    </Text>
                  </View>
                ) : (
                  runtimes.map((runtime) => {
                    const selected = runtime.id === selectedId;
                    const isPublic = runtime.visibility === "public";
                    return (
                      <Pressable
                        key={runtime.id}
                        onPress={() => {
                          onPick(runtime);
                          onClose();
                        }}
                        className={cn(
                          "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                          selected && "bg-secondary",
                        )}
                        accessibilityLabel={runtimeDisplayLabel(runtime)}
                      >
                        <View className="size-8 rounded-lg bg-secondary items-center justify-center">
                          <Ionicons
                            name={
                              runtime.runtime_mode === "cloud"
                                ? "cloud"
                                : "hardware-chip"
                            }
                            size={16}
                            color={muted}
                          />
                        </View>
                        <View className="flex-1 min-w-0 gap-0.5">
                          <Text
                            className="text-sm font-medium text-foreground"
                            numberOfLines={1}
                          >
                            {runtimeDisplayLabel(runtime)}
                          </Text>
                          <View className="flex-row items-center gap-1.5">
                            <View className="size-1.5 rounded-full bg-success" />
                            <Text className="text-xs text-muted-foreground">
                              {t("runtimes.health.online")}
                              {runtime.provider ? ` · ${runtime.provider}` : ""}
                            </Text>
                            {!isPublic ? (
                              <Text className="text-[10px] text-muted-foreground">
                                ·{" "}
                                <Text className="text-info">
                                  {t("runtimes.visibility.private")}
                                </Text>
                              </Text>
                            ) : null}
                          </View>
                        </View>
                        {selected ? (
                          <Ionicons name="checkmark" size={18} color={muted} />
                        ) : (
                          <Ionicons name="chevron-forward" size={14} color={muted} />
                        )}
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