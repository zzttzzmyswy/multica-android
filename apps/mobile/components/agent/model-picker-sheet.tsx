/**
 * Model catalog picker for the agent create/edit form (iteration 121,
 * MYS-1032). Mobile mirror of web packages/views/agents/components/
 * model-dropdown.tsx semantics: rows come from the runtime's live model
 * catalog (runtimeModelsOptions), grouped by provider; the search field is
 * also creatable — a typed value with no exact match offers "use <value>"
 * as a custom model, which is the manual-entry fallback kept alive for an
 * offline runtime, a failed discovery, or a provider without a catalog.
 */
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View, ActivityIndicator } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { RuntimeModel } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface Props {
  visible: boolean;
  models: RuntimeModel[];
  loading: boolean;
  failed: boolean;
  value: string;
  onPick: (modelId: string) => void;
  onClear: () => void;
  onClose: () => void;
}

interface Row {
  key: string;
  model: RuntimeModel;
}

export function ModelPickerSheet({
  visible,
  models,
  loading,
  failed,
  value,
  onPick,
  onClear,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const out: { provider: string; rows: Row[] }[] = [];
    const index = new Map<string, Row[]>();
    for (const model of models) {
      const provider = model.provider ?? "";
      const bucket = index.get(provider);
      const row: Row = { key: model.id, model };
      if (bucket) bucket.push(row);
      else {
        const list: Row[] = [row];
        index.set(provider, list);
        out.push({ provider, rows: list });
      }
    }
    if (!search.trim()) return out;
    const needle = search.trim().toLowerCase();
    return out
      .map((group) => ({
        ...group,
        rows: group.rows.filter(
          (row) =>
            row.model.id.toLowerCase().includes(needle) ||
            row.model.label.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.rows.length > 0);
  }, [models, search]);

  const trimmed = search.trim();
  const exactMatch = models.some(
    (m) => m.id === trimmed || m.label === trimmed,
  );
  const canCreate = trimmed.length > 0 && !exactMatch;

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
                  {t("agents.new.modelLabel")}
                </Text>
              </View>
              <View className="px-3 py-2 border-b border-border">
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder={t("agents.modelPicker.searchPlaceholder")}
                  placeholderTextColor={theme.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="h-9 rounded-md bg-secondary px-3 text-sm text-foreground"
                />
              </View>
              <ScrollView className="max-h-96" keyboardShouldPersistTaps="handled">
                {loading ? (
                  <View className="py-8 items-center gap-2">
                    <ActivityIndicator />
                    <Text className="text-xs text-muted-foreground">
                      {t("agents.modelPicker.discovering")}
                    </Text>
                  </View>
                ) : failed && models.length === 0 ? (
                  <View className="px-4 py-8 gap-1">
                    <Text className="text-sm text-destructive text-center">
                      {t("agents.modelPicker.discoveryFailed")}
                    </Text>
                    <Text className="text-xs text-muted-foreground text-center">
                      {t("agents.modelPicker.manualFallbackHint")}
                    </Text>
                  </View>
                ) : grouped.length === 0 && !canCreate ? (
                  <View className="px-4 py-8">
                    <Text className="text-sm text-muted-foreground text-center">
                      {t("agents.modelPicker.empty")}
                    </Text>
                  </View>
                ) : (
                  grouped.map((group) => (
                    <View key={group.provider || "_"} className="mb-1">
                      {group.provider ? (
                        <Text className="px-4 pt-1.5 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {group.provider}
                        </Text>
                      ) : null}
                      {group.rows.map((row) => {
                        const selected = row.model.id === value;
                        return (
                          <Pressable
                            key={row.key}
                            onPress={() => {
                              onPick(row.model.id);
                              onClose();
                            }}
                            className={cn(
                              "flex-row items-center gap-2 px-4 py-2.5 active:bg-secondary",
                              selected && "bg-secondary",
                            )}
                            accessibilityLabel={row.model.label || row.model.id}
                          >
                            <View className="flex-1 min-w-0">
                              <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                                {row.model.label || row.model.id}
                              </Text>
                              {row.model.label !== row.model.id ? (
                                <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                                  {row.model.id}
                                </Text>
                              ) : null}
                            </View>
                            {selected ? (
                              <Ionicons name="checkmark" size={18} color={theme.primary} />
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ))
                )}

                {canCreate && !loading ? (
                  <Pressable
                    onPress={() => {
                      onPick(trimmed);
                      onClose();
                    }}
                    className="flex-row items-center gap-2 px-4 py-2.5 active:bg-secondary"
                  >
                    <Ionicons name="add" size={16} color={theme.primary} />
                    <Text className="flex-1 text-sm text-primary" numberOfLines={1}>
                      {t("agents.modelPicker.useCustom", { value: trimmed })}
                    </Text>
                  </Pressable>
                ) : null}

                {value && !loading ? (
                  <Pressable
                    onPress={() => {
                      onClear();
                      onClose();
                    }}
                    className="mt-1 flex-row items-center gap-2 border-t border-border px-4 py-2.5 active:bg-secondary"
                  >
                    <Ionicons name="close-circle-outline" size={15} color={theme.mutedForeground} />
                    <Text className="text-xs text-muted-foreground">
                      {t("agents.modelPicker.clear")}
                    </Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
