/**
 * Agent / squad single-select modal for the quick-action form.
 *
 * Mirrors web's AgentPicker (packages/views/autopilots/components/pickers/
 * agent-picker.tsx): active agents (runtime-bound ones tappable) plus active
 * squads, a name filter, and the current selection pinned on top. Quick
 * actions only bind agents or squads (QuickActionAssigneeType), so members
 * are intentionally absent here.
 */
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { QuickActionAssigneeType } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { agentListOptions } from "@/data/queries/agents";
import { squadListOptions } from "@/data/queries/squads";
import { useWorkspaceStore } from "@/data/workspace-store";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type QuickActionAssignee = {
  type: QuickActionAssigneeType;
  id: string;
} | null;

export function AgentSquadPickerModal({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: QuickActionAssignee;
  onChange: (next: Exclude<QuickActionAssignee, null>) => void;
  onClose: () => void;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [query, setQuery] = useState("");

  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: squads = [] } = useQuery(squadListOptions(wsId));

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (name: string) => !q || name.toLowerCase().includes(q);
    const activeAgents = agents.filter((a) => !a.archived_at && match(a.name));
    const activeSquads = squads.filter((s) => !s.archived_at && match(s.name));
    const agentRows = activeAgents.map((a) => ({
      kind: "agent" as const,
      id: a.id,
      name: a.name,
      runtimeBound: isAgentRuntimeBound(a),
    }));
    const squadRows = activeSquads.map((s) => ({
      kind: "squad" as const,
      id: s.id,
      name: s.name,
    }));
    const all = [...agentRows, ...squadRows];
    const selected = value
      ? all.find((r) => r.kind === value.type && r.id === value.id)
      : undefined;
    return [
      ...(selected ? [selected] : []),
      ...all.filter((r) => r !== selected),
    ];
  }, [agents, squads, query, value]);

  const isSelected = (type: QuickActionAssigneeType, id: string) =>
    value?.type === type && value?.id === id;

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
                {t("quickActions.fieldTarget")}
              </Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color={theme.mutedForeground} />
              </Pressable>
            </View>
            <View className="border-b border-border px-4 py-2">
              <View className="flex-row items-center gap-2 rounded-md border border-border bg-background px-3">
                <Ionicons name="search" size={14} color={theme.mutedForeground} />
                <TextInput
                  className="flex-1 py-2 text-sm text-foreground"
                  placeholder={t("picker.searchPeople")}
                  placeholderTextColor={theme.mutedForeground}
                  value={query}
                  onChangeText={setQuery}
                  autoCorrect={false}
                />
              </View>
            </View>
            <FlatList
              data={rows}
              keyExtractor={(item) => `${item.kind}-${item.id}`}
              contentContainerClassName="pb-4"
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const disabled =
                  item.kind === "agent" && !item.runtimeBound;
                const selected = isSelected(item.kind, item.id);
                const runtimeBound =
                  item.kind === "squad" ? true : item.runtimeBound;
                return (
                  <Pressable
                    onPress={() => {
                      if (disabled) return;
                      onChange({ type: item.kind, id: item.id });
                      onClose();
                    }}
                    disabled={disabled}
                    className={cn(
                      "flex-row items-center gap-3 px-4 py-3",
                      disabled && "opacity-50",
                    )}
                  >
                    <ActorAvatar
                      type={item.kind}
                      id={item.id}
                      size={36}
                      showPresence={item.kind === "agent" && runtimeBound}
                    />
                    <View className="flex-1 min-w-0">
                      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                        {item.name}
                      </Text>
                      {item.kind === "agent" && !runtimeBound ? (
                        <Text className="text-xs text-muted-foreground">
                          {t("agents.notBound")}
                        </Text>
                      ) : null}
                    </View>
                    {selected ? (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={theme.primary}
                      />
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}