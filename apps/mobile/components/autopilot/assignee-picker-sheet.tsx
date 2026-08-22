/**
 * Assignee picker for the autopilot form — agent + squad sections, mirroring
 * web `packages/views/autopilots/components/pickers/agent-picker.tsx`:
 *
 *  - Agents and squads are grouped; archived actors are hidden (the caller
 *    passes pre-filtered lists, same deal as the chat AgentPickerSheet).
 *  - Agents without a bound runtime are disabled but visible (server is the
 *    real gate). A selected-but-disabled row is impossible after selection,
 *    so the check only marks enabled rows.
 *  - A squad is selectable only when its leader agent has a runtime bound;
 *    otherwise it is disabled with a "leader needs runtime" hint.
 *  - Picks report `{ type, id }` so the form can store
 *    assignee_type + assignee_id together (PATCH requires both on a swap).
 */
import { Modal, Pressable, ScrollView, View } from "react-native";
import type { Agent, AutopilotAssigneeType, Squad } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { cn } from "@/lib/utils";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import { useTranslation } from "@/lib/i18n/react";

export interface AssigneeSelection {
  type: AutopilotAssigneeType;
  id: string;
}

interface Props {
  visible: boolean;
  agents: Agent[];
  squads: Squad[];
  selection: AssigneeSelection | null;
  onPick: (next: AssigneeSelection) => void;
  onClose: () => void;
}

export function AssigneePickerSheet({
  visible,
  agents,
  squads,
  selection,
  onPick,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const agentsById = new Map(agents.map((a) => [a.id, a]));
  const isSelected = (type: AutopilotAssigneeType, id: string) =>
    selection?.type === type && selection?.id === id;

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
                  {t("autopilots.assigneePicker.title")}
                </Text>
              </View>

              <ScrollView className="max-h-[420px]">
                {agents.length === 0 && squads.length === 0 ? (
                  <View className="px-4 py-8">
                    <Text className="text-sm text-muted-foreground text-center">
                      {t("autopilots.assigneePicker.empty")}
                    </Text>
                  </View>
                ) : (
                  <>
                    {agents.length > 0 ? (
                      <SectionLabel>{t("picker.agents")}</SectionLabel>
                    ) : null}
                    {agents.map((agent) => {
                      const runtimeBound = isAgentRuntimeBound(agent);
                      return (
                        <AssigneeRow
                          key={agent.id}
                          selected={isSelected("agent", agent.id)}
                          disabled={!runtimeBound}
                          disabledHint={
                            runtimeBound
                              ? null
                              : t("picker.needsRuntime")
                          }
                          onPress={() => {
                            if (!runtimeBound) return;
                            onPick({ type: "agent", id: agent.id });
                            onClose();
                          }}
                          leading={
                            <ActorAvatar
                              type="agent"
                              id={agent.id}
                              size={32}
                              showPresence
                            />
                          }
                          title={agent.name}
                          subtitle={agent.description ?? undefined}
                        />
                      );
                    })}

                    {squads.length > 0 ? (
                      <SectionLabel>{t("picker.squads")}</SectionLabel>
                    ) : null}
                    {squads.map((squad) => {
                      const leader = squad.leader_id
                        ? agentsById.get(squad.leader_id)
                        : undefined;
                      const runtimeBound =
                        !!leader && isAgentRuntimeBound(leader);
                      return (
                        <AssigneeRow
                          key={squad.id}
                          selected={isSelected("squad", squad.id)}
                          disabled={!runtimeBound}
                          disabledHint={
                            runtimeBound
                              ? null
                              : t("picker.leaderNeedsRuntime")
                          }
                          onPress={() => {
                            if (!runtimeBound) return;
                            onPick({ type: "squad", id: squad.id });
                            onClose();
                          }}
                          leading={
                            <ActorAvatar type="squad" id={squad.id} size={32} />
                          }
                          title={squad.name}
                          subtitle={
                            squad.description?.trim()
                              ? squad.description
                              : undefined
                          }
                        />
                      );
                    })}
                  </>
                )}
              </ScrollView>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <View className="px-4 pt-3 pb-1">
      <Text className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {children}
      </Text>
    </View>
  );
}

function AssigneeRow({
  selected,
  disabled,
  disabledHint,
  onPress,
  leading,
  title,
  subtitle,
}: {
  selected: boolean;
  disabled: boolean;
  disabledHint: string | null;
  onPress: () => void;
  leading: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      className={cn(
        "flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary",
        selected && "bg-secondary/60",
        disabled && "opacity-50",
      )}
    >
      {leading}
      <View className="flex-1">
        <Text
          className="text-sm font-medium text-foreground"
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {disabled && disabledHint ? (
        <Text className="text-xs font-medium text-warning">{disabledHint}</Text>
      ) : null}
      {selected ? (
        <Text className="text-sm text-primary font-semibold">✓</Text>
      ) : null}
    </Pressable>
  );
}