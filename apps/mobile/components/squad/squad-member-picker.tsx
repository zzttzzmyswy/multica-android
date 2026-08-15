/**
 * Squad actor picker — bottom Modal listing agents (+ human workspace
 * members in "add" mode) the current user can wire into a squad as leader or
 * worker. Shared by the create-squad page (leader selection) and the squad
 * detail page (add member).
 *
 * Layout mirrors `components/chat/agent-picker-sheet.tsx`: transparent Modal
 * + dimmed backdrop + centered card. Rows the server would reject are
 * excluded up front: archived agents are never listed, and targets already in
 * the squad appear under neither section (server rejects duplicates too).
 *
 * Filtering is delegated to the caller (pre-filtered `agents` / `members`
 * lists) so each screen keeps its source data in one place.
 */
import { Modal, Pressable, ScrollView, View } from "react-native";
import type { Agent, MemberWithUser } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useTranslation } from "@/lib/i18n/react";

export interface SquadPickTarget {
  member_type: "agent" | "member";
  member_id: string;
}

interface Props {
  visible: boolean;
  /** "leader" (agents only, for create) or "add" (agents + human members). */
  mode: "leader" | "add";
  agents: Agent[];
  members: MemberWithUser[];
  /** `${type}:${id}` of targets already in the squad — excluded. */
  excluded: Set<string>;
  onPick: (target: SquadPickTarget) => void;
  onClose: () => void;
}

function key(type: "agent" | "member", id: string): string {
  return `${type}:${id}`;
}

export function SquadMemberPicker({
  visible,
  mode,
  agents,
  members,
  excluded,
  onPick,
  onClose,
}: Props) {
  const { t } = useTranslation();

  const candidateAgents = agents.filter(
    (a) => !a.archived_at && !excluded.has(key("agent", a.id)),
  );
  const candidateMembers = members.filter(
    (m) => !excluded.has(key("member", m.user_id)),
  );
  const showAgents = mode === "add" || mode === "leader";
  const showEmpty =
    (showAgents && candidateAgents.length === 0) ||
    (mode === "add" && candidateMembers.length === 0);

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
                  {t(
                    mode === "leader"
                      ? "squads.picker.selectLeader"
                      : "squads.picker.addMember",
                  )}
                </Text>
              </View>

              <ScrollView className="max-h-96">
                {showEmpty ? (
                  <View className="px-4 py-8">
                    <Text className="text-sm text-muted-foreground text-center">
                      {t("squads.picker.noOptions")}
                    </Text>
                  </View>
                ) : (
                  <>
                    {showAgents ? (
                      <PickerSection
                        title={t("squads.picker.agents")}
                        items={candidateAgents.map((a) => ({
                          id: a.id,
                          type: "agent" as const,
                          name: a.name,
                          subtitle: a.description ?? undefined,
                          avatarId: a.id,
                        }))}
                        onPress={(item) => {
                          onPick({
                            member_type: item.type,
                            member_id: item.id,
                          });
                          onClose();
                        }}
                      />
                    ) : null}
                    {mode === "add" ? (
                      <PickerSection
                        title={t("squads.picker.members")}
                        items={candidateMembers.map((m) => ({
                          id: m.user_id,
                          type: "member" as const,
                          name: m.name,
                          subtitle: m.email,
                          avatarId: m.user_id,
                        }))}
                        onPress={(item) => {
                          onPick({
                            member_type: item.type,
                            member_id: item.id,
                          });
                          onClose();
                        }}
                      />
                    ) : null}
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

interface PickerSectionItem {
  id: string;
  type: "agent" | "member";
  name: string;
  subtitle?: string;
  avatarId: string;
}

function PickerSection({
  title,
  items,
  onPress,
}: {
  title: string;
  items: PickerSectionItem[];
  onPress: (item: PickerSectionItem) => void;
}) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <View>
      <View className="px-4 pt-2.5 pb-1">
        <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </Text>
      </View>
      {items.map((item) => (
        <Pressable
          key={`${item.type}:${item.id}`}
          onPress={() => onPress(item)}
          className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
        >
          <ActorAvatar type={item.type} id={item.avatarId} size={32} />
          <View className="flex-1">
            <Text
              className="text-sm font-medium text-foreground"
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {item.subtitle ? (
              <Text
                className="text-xs text-muted-foreground mt-0.5"
                numberOfLines={1}
              >
                {item.subtitle}
              </Text>
            ) : null}
          </View>
          <Text className="text-xs text-muted-foreground/70">
            {t(
              item.type === "agent"
                ? "squads.picker.agentTag"
                : "squads.picker.memberTag",
            )}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}