/**
 * Agent picker — centered modal listing agents the current user can assign /
 * chat with. Shown when the user taps `+ New Chat` and the workspace has
 * more than one usable agent; with exactly one, the chat screen skips this
 * sheet and goes straight to the blank state for that agent.
 *
 * Filtering is delegated to the caller (the screen passes a pre-filtered
 * `agents` list) so the same filter logic — archived + canAssignAgent +
 * order — stays in one place.
 *
 * The sheet preserves that order and does not change eligibility.
 */
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Agent } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { cn } from "@/lib/utils";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import { useTranslation } from "@/lib/i18n/react";
import { useReducedMotion, useThemePalette } from "@/lib/appearance-a11y-runtime";

interface Props {
  visible: boolean;
  agents: Agent[];
  currentAgentId: string | null;
  onPick: (agent: Agent) => void;
  onClose: () => void;
}

export function AgentPickerSheet({
  visible,
  agents,
  currentAgentId,
  onPick,
  onClose,
}: Props) {
  const reduceMotion = useReducedMotion();
  const { t } = useTranslation();
  const palette = useThemePalette();
  const needsRuntime = t("picker.needsRuntime");

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
    >
      <View className="flex-1 items-center justify-center px-4">
        <Pressable
          className="absolute inset-0 bg-black/40"
          accessible={false}
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          className="max-h-[85%] w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-popover"
        >
          <View className="flex-row items-center gap-2 border-b border-border py-1 pl-4 pr-2">
            <Text
              accessibilityRole="header"
              className="min-w-0 flex-1 text-title-sm font-semibold text-foreground"
            >
              {t("chat.chooseAgent")}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              className="size-12 shrink-0 items-center justify-center rounded-xl active:bg-secondary"
            >
              <Ionicons name="close" size={22} color={palette.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView className="shrink" contentContainerClassName="gap-1 px-2 py-2">
            {agents.length === 0 ? (
              <View className="px-4 py-8">
                <Text className="text-center text-body text-muted-foreground">
                  {t("chat.noAgentsEmpty")}
                </Text>
              </View>
            ) : (
              agents.map((agent) => {
                const selected = agent.id === currentAgentId;
                const runtimeBound = isAgentRuntimeBound(agent);
                return (
                  <Pressable
                    key={agent.id}
                    accessible
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: !runtimeBound }}
                    disabled={!runtimeBound}
                    onPress={() => {
                      onPick(agent);
                      onClose();
                    }}
                    className={cn(
                      "min-h-12 flex-row items-start gap-3 rounded-xl border border-transparent px-3 py-3",
                      runtimeBound && "active:bg-secondary",
                      selected && "border-primary/30 bg-primary/5",
                    )}
                  >
                    <ActorAvatar type="agent" id={agent.id} size={32} showPresence />
                    <View className="min-w-0 flex-1 gap-1">
                      <Text
                        className="text-body font-semibold text-foreground"
                        numberOfLines={2}
                      >
                        {agent.name}
                      </Text>
                      {!runtimeBound ? (
                        <View className="flex-row items-start gap-1.5">
                          <Ionicons name="server-outline" size={14} color={palette.mutedForeground} />
                          <Text className="min-w-0 flex-1 text-caption font-medium text-foreground">
                            {needsRuntime}
                          </Text>
                        </View>
                      ) : null}
                      {agent.description ? (
                        <Text
                          className="text-caption text-muted-foreground"
                          numberOfLines={2}
                        >
                          {agent.description}
                        </Text>
                      ) : null}
                    </View>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={18} color={palette.primary} />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
