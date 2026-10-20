/**
 * Squad actor picker — bottom Modal listing agents (+ human workspace
 * members in "add" mode) the current user can wire into a squad as leader or
 * worker. Shared by the create-squad page (leader selection) and the squad
 * detail page (add member).
 *
 * Layout mirrors `components/chat/agent-picker-sheet.tsx`: transparent Modal
 * + dimmed backdrop + centered card.
 *
 * Two steps in "add" mode, matching web's `AddMemberDialog`
 * (`squad-detail-page.tsx:484-648`): pick a target, then optionally describe
 * the role they play in this squad. Web puts the role on the second step
 * because it is per-squad context that only means anything at the moment of
 * joining — filling it in later is a separate edit. Mobile used to have only
 * the first step, so a member added from a phone could not be given a role at
 * all without a second trip into the row menu.
 *
 * Who is offered is NOT decided here. `lib/squad-guards.ts`
 * (`availableSquadCandidates`) owns the rule — not archived, not already in the
 * squad — so the picker and its unit tests cannot drift apart, and a second
 * call site gets the same filtering for free.
 */
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import type { Agent, MemberWithUser } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useTranslation } from "@/lib/i18n/react";
import { availableSquadCandidates } from "@/lib/squad-guards";

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
  /** "leader" mode: fires on tap, the pick is the whole interaction. */
  onPick: (target: SquadPickTarget, role: string) => void;
  onClose: () => void;
}

/** A target the user has chosen but not yet confirmed, pending the role. */
interface StagedTarget {
  target: SquadPickTarget;
  name: string;
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
  // The role step only exists in "add" mode — a leader is not given a role by
  // web's create flow either. Reset on close so reopening never shows the
  // previous member's role.
  const [staged, setStaged] = useState<StagedTarget | null>(null);
  const [role, setRole] = useState("");

  const candidates = useMemo(
    () => availableSquadCandidates({ agents, members, current: excluded }),
    [agents, members, excluded],
  );
  const showAgents = mode === "add" || mode === "leader";
  const showEmpty =
    (showAgents && candidates.agents.length === 0) ||
    (mode === "add" && candidates.members.length === 0);

  const close = () => {
    setStaged(null);
    setRole("");
    onClose();
  };

  const choose = (target: SquadPickTarget, name: string) => {
    if (mode === "leader") {
      // Leader selection has no role step: confirm immediately, exactly as
      // before. `""` reaches the caller but the create payload has no role
      // field for a leader.
      onPick(target, "");
      close();
      return;
    }
    setStaged({ target, name });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <Pressable className="flex-1 bg-black/40" onPress={close}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden">
              <View className="px-4 py-3 border-b border-border">
                <Text className="text-title-sm font-semibold text-foreground">
                  {t(
                    staged
                      ? "squads.picker.roleTitle"
                      : mode === "leader"
                        ? "squads.picker.selectLeader"
                        : "squads.picker.addMember",
                  )}
                </Text>
              </View>

              {staged ? (
                /* Step 2 — the picked target plus the optional role. Web
                 *  labels the field "Role (optional)" and gives it a
                 *  free-text placeholder rather than a vocabulary, because the
                 *  role is the squad's own words, not an enum. */
                <View className="px-4 py-4 gap-3">
                  <View className="flex-row items-center gap-3">
                    <ActorAvatar
                      type={staged.target.member_type}
                      id={staged.target.member_id}
                      size={32}
                    />
                    <Text
                      className="flex-1 text-body font-medium text-foreground"
                      numberOfLines={1}
                    >
                      {staged.name}
                    </Text>
                  </View>
                  <View className="gap-1">
                    <Text className="text-caption text-muted-foreground">
                      {t("squads.picker.roleLabel")}
                    </Text>
                    <TextField
                      value={role}
                      onChangeText={setRole}
                      placeholder={t("squads.detail.rolePlaceholder")}
                      autoFocus
                    />
                  </View>
                  <View className="flex-row justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onPress={() => {
                        setStaged(null);
                        setRole("");
                      }}
                    >
                      <Text>{t("squads.picker.back")}</Text>
                    </Button>
                    <Button
                      size="sm"
                      onPress={() => {
                        onPick(staged.target, role);
                        close();
                      }}
                    >
                      <Text>{t("squads.picker.confirmAdd")}</Text>
                    </Button>
                  </View>
                </View>
              ) : (
                <ScrollView className="max-h-96">
                  {showEmpty ? (
                    <View className="px-4 py-8">
                      <Text className="text-body text-muted-foreground text-center">
                        {t("squads.picker.noOptions")}
                      </Text>
                    </View>
                  ) : (
                    <>
                      {showAgents ? (
                        <PickerSection
                          title={t("squads.picker.agents")}
                          items={candidates.agents.map((a) => ({
                            id: a.id,
                            type: "agent" as const,
                            name: a.name,
                            subtitle: a.description ?? undefined,
                            avatarId: a.id,
                          }))}
                          onPress={(item) =>
                            choose(
                              { member_type: item.type, member_id: item.id },
                              item.name,
                            )
                          }
                        />
                      ) : null}
                      {mode === "add" ? (
                        <PickerSection
                          title={t("squads.picker.members")}
                          items={candidates.members.map((m) => ({
                            id: m.user_id,
                            type: "member" as const,
                            name: m.name,
                            subtitle: m.email,
                            avatarId: m.user_id,
                          }))}
                          onPress={(item) =>
                            choose(
                              { member_type: item.type, member_id: item.id },
                              item.name,
                            )
                          }
                        />
                      ) : null}
                    </>
                  )}
                </ScrollView>
              )}
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
        <Text className="text-caption font-medium text-muted-foreground uppercase tracking-wide">
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
              className="text-body font-medium text-foreground"
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {item.subtitle ? (
              <Text
                className="text-caption text-muted-foreground mt-0.5"
                numberOfLines={1}
              >
                {item.subtitle}
              </Text>
            ) : null}
          </View>
          <Text className="text-caption text-muted-foreground/70">
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
