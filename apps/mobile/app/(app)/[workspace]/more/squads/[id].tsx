/**
 * Squad detail screen. Reached from the squads list row. Mirrors web
 * `packages/views/squads/components/squad-detail-page.tsx` read + manage
 * surface on a phone: header (avatar, name, leader, description),
 * members roster (avatar, name, role text, leader chip, working/idle/
 * offline status dot + active issue), and — when the current user may
 * manage this squad — add/remove members, change role text, promote a
 * leader, edit name/description, and archive the squad.
 *
 * Management gate mirrors `squadManageGuards` (lib/squad-guards.ts + web
 * canManageSquad MUL-4223): workspace owner/admin manage every squad; a
 * regular member manages only squads they created. Action-level guards
 * (leader-protection, self-protection) are the same pure functions with
 * unit tests — the server remains the authoritative gate.
 *
 * No optimistic patching (iteration-24 lesson): every mutation settles with
 * the squads cache-invalidate, so roster / header changes re-read truth.
 * Remove and archive navigate back on success.
 */
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { SquadMember, SquadMemberStatusValue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { TextField } from "@/components/ui/text-field";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Markdown } from "@/lib/markdown";
import { SquadMemberPicker } from "@/components/squad/squad-member-picker";
import { squadDetailOptions, squadMemberListOptions, squadMemberStatusOptions } from "@/data/queries/squads";
import { memberListOptions } from "@/data/queries/members";
import { agentListOptions } from "@/data/queries/agents";
import {
  useAddSquadMember,
  useDeleteSquad,
  useRemoveSquadMember,
  useUpdateSquad,
  useUpdateSquadMemberRole,
} from "@/data/mutations/squads";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { ActionSheet } from "@/lib/action-sheet";
import { squadManageGuards, squadMemberActionGuards } from "@/lib/squad-guards";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

// Server-driven member status buckets — unknown/null (human members) render
// a neutral dot; a future server value can't collapse the roster.
const STATUS_LABEL: Record<string, string> = {
  working: "squads.status.working",
  idle: "squads.status.idle",
  offline: "squads.status.offline",
  unstable: "squads.status.unstable",
  archived: "squads.status.archived",
};

const STATUS_DOT: Record<string, string> = {
  working: "bg-success",
  idle: "bg-muted-foreground/40",
  offline: "bg-muted-foreground/40",
  unstable: "bg-warning",
  archived: "bg-muted-foreground/40",
};

export default function SquadDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const detail = useQuery(squadDetailOptions(wsId, id));
  const membersQ = useQuery(squadMemberListOptions(wsId, id));
  const statusQ = useQuery(squadMemberStatusOptions(wsId, id));
  const agentsQ = useQuery(agentListOptions(wsId));
  const wsMembersQ = useQuery(memberListOptions(wsId));

  const addMember = useAddSquadMember(id);
  const removeMember = useRemoveSquadMember(id);
  const updateRole = useUpdateSquadMemberRole(id);
  const updateSquad = useUpdateSquad(id);
  const deleteSquad = useDeleteSquad();

  const squad = detail.data ?? null;
  const members = useMemo(() => membersQ.data ?? [], [membersQ.data]);
  const statusById = useMemo(() => {
    const map = new Map<string, { status: SquadMemberStatusValue | null; active: boolean }>();
    for (const s of statusQ.data?.members ?? []) {
      map.set(s.member_id, {
        status: (s.status ?? null) as SquadMemberStatusValue | null,
        active: (s.active_issues ?? []).length > 0,
      });
    }
    return map;
  }, [statusQ.data]);

  const agentsById = useMemo(() => {
    const map = new Map<string, { name: string; archived: boolean }>();
    for (const a of agentsQ.data ?? []) map.set(a.id, { name: a.name, archived: !!a.archived_at });
    return map;
  }, [agentsQ.data]);
  const memberNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of wsMembersQ.data ?? []) map.set(m.user_id, m.name);
    return map;
  }, [wsMembersQ.data]);

  const currentMember = wsMembersQ.data?.find((m) => m.user_id === user?.id);
  const canManage = squadManageGuards({
    currentRole: currentMember?.role,
    currentUserId: user?.id,
    squad,
  });

  const archived = !!squad?.archived_at;
  const leaderName =
    agentsById.get(squad?.leader_id ?? "")?.name ?? t("squads.unknownLeader");
  const getMemberName = useCallback(
    (m: SquadMember): string => {
      if (m.member_type === "agent") {
        return agentsById.get(m.member_id)?.name ?? m.member_id.slice(0, 8);
      }
      return memberNamesById.get(m.member_id) ?? m.member_id.slice(0, 8);
    },
    [agentsById, memberNamesById],
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionsValue, setInstructionsValue] = useState("");
  const [roleEdit, setRoleEdit] = useState<{
    member: SquadMember;
    value: string;
  } | null>(null);
  const [roleValue, setRoleValue] = useState("");

  const isLeader = (m: SquadMember): boolean =>
    m.member_type === "agent" && squad?.leader_id === m.member_id;

  const excluded = useMemo(() => {
    const s = new Set<string>();
    for (const m of members) s.add(`${m.member_type}:${m.member_id}`);
    return s;
  }, [members]);

  const onPressMore = useCallback(() => {
    if (!squad) return;
    ActionSheet.showActionSheetWithOptions(
      {
        title: squad.name,
        options: [
          ...(canManage
            ? [t("squads.detail.edit"), t("squads.detail.archive")]
            : []),
          t("common.cancel"),
        ],
        cancelButtonIndex: canManage ? 2 : 0,
        destructiveButtonIndex: canManage ? 1 : undefined,
      },
      (index) => {
        if (!canManage) return;
        if (index === 0) {
          setEditName(squad.name);
          setEditDescription(squad.description ?? "");
          setEditOpen(true);
        } else if (index === 1 && !archived) {
          Alert.alert(
            t("squads.detail.archiveTitle"),
            t("squads.detail.archiveMessage", { name: squad.name }),
            [
              { text: t("common.cancel"), style: "cancel" },
              {
                text: t("squads.detail.archive"),
                style: "destructive",
                onPress: () => {
                  deleteSquad.mutate(squad.id, {
                    onSuccess: () => router.back(),
                    onError: (err) =>
                      Alert.alert(
                        t("squads.detail.archiveFailed"),
                        err instanceof Error
                          ? err.message
                          : t("common.unknownError"),
                      ),
                  });
                },
              },
            ],
          );
        }
      },
    );
  }, [canManage, squad, archived, deleteSquad, t]);

  const onPressMember = useCallback(
    (member: SquadMember) => {
      if (!canManage) return;
      const g = squadMemberActionGuards({
        canManage,
        currentUserId: user?.id,
        leaderId: squad?.leader_id,
        target: member,
      });
      const name = getMemberName(member);
      if (!g.canRemove && !g.canSetLeader && !g.canEditRole) return;
      ActionSheet.showActionSheetWithOptions(
        {
          title: name,
          options: [
            ...(g.canSetLeader ? [t("squads.detail.setLeader")] : []),
            ...(g.canEditRole ? [t("squads.detail.editRole")] : []),
            ...(g.canRemove ? [t("squads.detail.removeMember")] : []),
            t("common.cancel"),
          ],
          cancelButtonIndex: 4,
          destructiveButtonIndex: g.canRemove ? 3 : undefined,
        },
        (index) => {
          let i = 0;
          if (g.canSetLeader && index === i++) {
            updateSquad.mutate(
              { leader_id: member.member_id },
              {
                onSuccess: () =>
                  Alert.alert(t("squads.detail.leaderUpdated")),
                onError: (err) =>
                  Alert.alert(
                    t("squads.detail.updateFailed"),
                    err instanceof Error ? err.message : t("common.unknownError"),
                  ),
              },
            );
            return;
          }
          if (g.canEditRole && index === i++) {
            setRoleEdit({ member, value: member.role ?? "" });
            setRoleValue(member.role ?? "");
            return;
          }
          if (g.canRemove && index === i++) {
            Alert.alert(
              t("squads.detail.removeTitle", { name }),
              t("squads.detail.removeMessage", {
                name,
                squad: squad?.name ?? "",
              }),
              [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("squads.detail.removeMember"),
                  style: "destructive",
                  onPress: () => {
                    removeMember.mutate(
                      {
                        member_type: member.member_type,
                        member_id: member.member_id,
                      },
                      {
                        onError: (err) =>
                          Alert.alert(
                            t("squads.detail.removeFailed"),
                            err instanceof Error
                              ? err.message
                              : t("common.unknownError"),
                          ),
                      },
                    );
                  },
                },
              ],
            );
          }
        },
      );
    },
    [canManage, user?.id, squad, removeMember, updateSquad, t, getMemberName],
  );

  const onAddMemberPick = useCallback(
    (target: { member_type: "agent" | "member"; member_id: string }) => {
      addMember.mutate(
        {
          member_type: target.member_type,
          member_id: target.member_id,
        },
        {
          onSuccess: () => Alert.alert(t("squads.detail.memberAdded")),
          onError: (err) =>
            Alert.alert(
              t("squads.detail.addFailed"),
              err instanceof Error ? err.message : t("common.unknownError"),
            ),
        },
      );
    },
    [addMember, t],
  );

  const onSaveEdit = useCallback(() => {
    if (!squad) return;
    const name = editName.trim();
    if (name.length === 0) {
      Alert.alert(t("squads.new.nameRequired"));
      return;
    }
    updateSquad.mutate(
      {
        name,
        description: editDescription.trim(),
      },
      {
        onSuccess: () => setEditOpen(false),
        onError: (err) =>
          Alert.alert(
            t("squads.detail.updateFailed"),
            err instanceof Error ? err.message : t("common.unknownError"),
          ),
      },
    );
  }, [squad, editName, editDescription, updateSquad, t]);

  const onOpenInstructions = useCallback(() => {
    if (!squad) return;
    setInstructionsValue(squad.instructions ?? "");
    setInstructionsOpen(true);
  }, [squad]);

  const onSaveInstructions = useCallback(() => {
    if (!squad) return;
    updateSquad.mutate(
      { instructions: instructionsValue },
      {
        onSuccess: () => {
          setInstructionsOpen(false);
          Alert.alert(t("squads.instructions.saved"));
        },
        onError: (err) =>
          Alert.alert(
            t("squads.detail.updateFailed"),
            err instanceof Error ? err.message : t("common.unknownError"),
          ),
      },
    );
  }, [squad, instructionsValue, updateSquad, t]);

  const onSaveRole = useCallback(() => {
    if (!roleEdit) return;
    updateRole.mutate(
      {
        member_type: roleEdit.member.member_type,
        member_id: roleEdit.member.member_id,
        role: roleValue.trim(),
      },
      {
        onSuccess: () => {
          setRoleEdit(null);
          Alert.alert(t("squads.detail.roleUpdated"));
        },
        onError: (err) =>
          Alert.alert(
            t("squads.detail.roleUpdateFailed"),
            err instanceof Error ? err.message : t("common.unknownError"),
          ),
      },
    );
  }, [roleEdit, roleValue, updateRole, t]);

  const isLoading = detail.isLoading && !squad;
  const notFound = !isLoading && (!squad || squad.id === "");

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: squad
            ? () => (
                <IconButton
                  name="ellipsis-horizontal"
                  onPress={onPressMore}
                  accessibilityLabel={t("squads.detail.actions")}
                />
              )
            : undefined,
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="pb-8"
        refreshControl={
          <RefreshControl
            refreshing={detail.isRefetching}
            onRefresh={() => detail.refetch()}
            tintColor={theme.mutedForeground}
          />
        }
      >
        {isLoading ? (
          <View className="flex-1 items-center justify-center pt-24">
            <ActivityIndicator />
          </View>
        ) : notFound ? (
          <View className="px-6 pt-16 items-center gap-3">
            <Ionicons name="people-circle-outline" size={32} color={theme.mutedForeground} />
            <Text className="text-sm text-muted-foreground text-center">
              {t("squads.emptyTitle")}
            </Text>
          </View>
        ) : squad ? (
          <>
            {/* Header */}
            <View className="px-4 pt-4 flex-row items-center gap-3">
              <ActorAvatar type="squad" id={squad.id} size={56} />
              <View className="flex-1 min-w-0 gap-0.5">
                <View className="flex-row items-center gap-2">
                  <Text
                    className="flex-1 text-base font-semibold text-foreground"
                    numberOfLines={1}
                  >
                    {squad.name}
                  </Text>
                  {archived ? (
                    <View className="px-2 py-0.5 rounded-full border border-border bg-muted">
                      <Text className="text-[11px] text-muted-foreground font-medium">
                        {t("squads.archived")}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View className="flex-row items-center gap-1.5">
                  <Ionicons name="medal-outline" size={13} color={theme.mutedForeground} />
                  <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                    {leaderName}
                  </Text>
                </View>
              </View>
            </View>
            {squad.description ? (
              <Text className="px-4 pt-2 text-xs text-muted-foreground/80">
                {squad.description}
              </Text>
            ) : null}

            {/* Members */}
            <SectionTitle>{t("squads.detail.members")}</SectionTitle>
            <View className="px-4 gap-2">
              {members.length === 0 ? (
                <View className="rounded-lg border border-border px-4 py-6 items-center gap-1">
                  <Ionicons name="people-outline" size={24} color={theme.mutedForeground} />
                  <Text className="text-sm text-muted-foreground text-center mt-1">
                    {t("squads.detail.noMembers")}
                  </Text>
                  {canManage ? (
                    <Text className="text-xs text-muted-foreground/70 text-center">
                      {t("squads.detail.noMembersHint")}
                    </Text>
                  ) : null}
                </View>
              ) : (
                members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    name={getMemberName(member)}
                    leader={isLeader(member)}
                    status={statusById.get(member.member_id)}
                    onPress={() => onPressMember(member)}
                  />
                ))
              )}

              {canManage ? (
                <Button variant="outline" onPress={() => setPickerOpen(true)}>
                  <Ionicons name="add" size={15} color={theme.mutedForeground} />
                  <Text>{t("squads.detail.addMember")}</Text>
                </Button>
              ) : null}
            </View>

            {/* Instructions */}
            <SectionTitle>{t("squads.instructions.title")}</SectionTitle>
            <View className="px-4 gap-2">
              <Text className="text-xs text-muted-foreground/80 leading-4">
                {t("squads.instructions.description")}
              </Text>
              {squad.instructions?.trim() ? (
                <View className="rounded-lg border border-border px-3 py-2 bg-card">
                  <Markdown content={squad.instructions} />
                </View>
              ) : (
                <View className="rounded-lg border border-dashed border-border px-3 py-6 items-center">
                  <Ionicons name="document-text-outline" size={22} color={theme.mutedForeground} />
                  <Text className="text-xs text-muted-foreground/70 italic mt-1">
                    {t("squads.instructions.empty")}
                  </Text>
                </View>
              )}
              {canManage ? (
                <Button variant="outline" onPress={onOpenInstructions}>
                  <Ionicons name="create-outline" size={15} color={theme.mutedForeground} />
                  <Text>{t("squads.instructions.edit")}</Text>
                </Button>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* Add member picker */}
      <SquadMemberPicker
        visible={pickerOpen}
        mode="add"
        agents={agentsQ.data ?? []}
        members={wsMembersQ.data ?? []}
        excluded={excluded}
        onPick={onAddMemberPick}
        onClose={() => setPickerOpen(false)}
      />

      {/* Edit name/description */}
      <EditSquadModal
        visible={editOpen}
        name={editName}
        description={editDescription}
        saving={updateSquad.isPending}
        onNameChange={setEditName}
        onDescriptionChange={setEditDescription}
        onSave={onSaveEdit}
        onClose={() => setEditOpen(false)}
      />

      {/* Edit squad instructions */}
      <InstructionsEditModal
        visible={instructionsOpen}
        value={instructionsValue}
        original={squad?.instructions ?? ""}
        saving={updateSquad.isPending}
        onChange={setInstructionsValue}
        onSave={onSaveInstructions}
        onClose={() => setInstructionsOpen(false)}
      />

      {/* Edit role text */}
      {roleEdit ? (
        <RoleEditModal
          member={roleEdit.member}
          value={roleValue}
          saving={updateRole.isPending}
          onChange={setRoleValue}
          onSave={onSaveRole}
          onClose={() => setRoleEdit(null)}
        />
      ) : null}
    </>
  );
}

function MemberRow({
  member,
  name,
  leader,
  status,
  onPress,
}: {
  member: SquadMember;
  name: string;
  leader: boolean;
  status: { status: SquadMemberStatusValue | null; active: boolean } | undefined;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const statusValue = member.member_type === "agent" ? status?.status ?? null : null;
  const statusLabel = statusValue ? STATUS_LABEL[statusValue] ?? null : null;

  return (
    <Pressable onPress={onPress} className="rounded-lg border border-border px-3 py-2.5 active:bg-secondary">
      <View className="flex-row items-center gap-3">
        <ActorAvatar type={member.member_type} id={member.member_id} size={36} />
        <View className="flex-1 min-w-0 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
              {name}
            </Text>
            {member.member_type === "agent" ? (
              <Text className="text-[11px] text-muted-foreground/80 uppercase">
                {t("squads.detail.agentTag")}
              </Text>
            ) : null}
            {statusValue ? (
              <View className="flex-row items-center gap-1">
                <View className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[statusValue] ?? "bg-muted-foreground/40")} />
                <Text className="text-[11px] text-muted-foreground">
                  {statusLabel ? t(statusLabel) : statusValue}
                </Text>
              </View>
            ) : null}
            {leader ? (
              <View className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30">
                <Text className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  {t("squads.detail.leaderChip")}
                </Text>
              </View>
            ) : null}
          </View>
          {member.role ? (
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {member.role}
            </Text>
          ) : null}
          {statusValue === "working" && member.member_type === "agent" && status?.active ? (
            <Text className="text-xs text-muted-foreground/70">
              {t("squads.detail.activeTask")}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
      </View>
    </Pressable>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text className="px-4 pt-5 pb-2 text-xs uppercase tracking-wider text-muted-foreground font-medium">
      {children}
    </Text>
  );
}

function EditSquadModal({
  visible,
  name,
  description,
  saving,
  onNameChange,
  onDescriptionChange,
  onSave,
  onClose,
}: {
  visible: boolean;
  name: string;
  description: string;
  saving: boolean;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl p-4 gap-3">
              <Text className="text-base font-semibold text-foreground">
                {t("squads.detail.edit")}
              </Text>
              <TextField
                value={name}
                onChangeText={onNameChange}
                placeholder={t("squads.new.namePlaceholder")}
                editable={!saving}
                autoFocus
              />
              <AutosizeTextArea
                value={description}
                onChangeText={onDescriptionChange}
                placeholder={t("squads.new.descriptionPlaceholder")}
                editable={!saving}
                className="border border-border rounded-md px-3 py-2 min-h-[64px]"
              />
              <View className="flex-row justify-end gap-2">
                <Button variant="outline" size="sm" onPress={onClose} disabled={saving}>
                  <Text>{t("common.cancel")}</Text>
                </Button>
                <Button size="sm" onPress={onSave} disabled={saving}>
                  <Text>{saving ? t("common.saving") : t("common.save")}</Text>
                </Button>
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function InstructionsEditModal({
  visible,
  value,
  original,
  saving,
  onChange,
  onSave,
  onClose,
}: {
  visible: boolean;
  value: string;
  original: string;
  saving: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dirty = value !== original;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl p-4 gap-3">
              <Text className="text-base font-semibold text-foreground">
                {t("squads.instructions.title")}
              </Text>
              <Text className="text-xs text-muted-foreground/80 leading-4">
                {t("squads.instructions.description")}
              </Text>
              <AutosizeTextArea
                value={value}
                onChangeText={onChange}
                editable={!saving}
                autoFocus
                minHeight={160}
                placeholder={t("squads.instructions.placeholder")}
                className="border border-border rounded-md px-3 py-2"
              />
              {dirty ? (
                <Text className="text-xs text-muted-foreground">
                  {t("squads.instructions.unsaved")}
                </Text>
              ) : null}
              <View className="flex-row justify-end gap-2">
                <Button variant="outline" size="sm" onPress={onClose} disabled={saving}>
                  <Text>{t("common.cancel")}</Text>
                </Button>
                <Button size="sm" onPress={onSave} disabled={!dirty || saving}>
                  <Text>{saving ? t("common.saving") : t("common.save")}</Text>
                </Button>
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function RoleEditModal({
  member,
  value,
  saving,
  onChange,
  onSave,
  onClose,
}: {
  member: SquadMember;
  value: string;
  saving: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 items-center justify-center px-6">
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl p-4 gap-3">
              <Text className="text-base font-semibold text-foreground">
                {t("squads.detail.editRole")}
              </Text>
              <TextField
                value={value}
                onChangeText={onChange}
                placeholder={t("squads.detail.rolePlaceholder")}
                editable={!saving}
                autoFocus
              />
              <View className="flex-row justify-end gap-2">
                <Button variant="outline" size="sm" onPress={onClose} disabled={saving}>
                  <Text>{t("common.cancel")}</Text>
                </Button>
                <Button size="sm" onPress={onSave} disabled={saving}>
                  <Text>{saving ? t("common.saving") : t("common.save")}</Text>
                </Button>
              </View>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}