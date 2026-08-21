/**
 * Agent access editor — mirrors web `inspector/access-picker.tsx`
 * (draft-first) for the mobile agent detail page (MUL-3963):
 *
 *  - Draft-first: picking a scope only edits the local draft; nothing reaches
 *    the server until the owner saves the complete selection.
 *  - Three scopes (private / workspace / members) via RadioGroup + a member
 *    multi-select sheet; inert team targets are preserved across saves.
 *  - Owner-only editing: a non-owner sees a read-only summary of the current
 *    grants plus the "set by the owner" hint (web `canEdit` gate).
 *  - Save is enabled only when the draft differs from the persisted state AND
 *    a members scope has ≥1 target (web save-button gate); success shows a
 *    transient "saved" flash.
 *
 * `AgentAccessEditor` is the pure draft UI (reused by the bulk dialog in
 * agent-access-batch-sheet.tsx); `AgentAccessPicker` is the detail-page
 * section with save + read-only fallback.
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Agent, MemberWithUser } from "@multica/core/types";
import {
  buildInvocationTargets,
  deriveDuplicateAccess,
  EMPTY_AGENT_DRAFT,
  type AgentDraft,
} from "@multica/core/agents";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { MultiSelectSheet } from "@/components/agent/multi-select-sheet";
import { useUpdateAgent } from "@/data/mutations/agents";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

type PermissionScope = AgentDraft["permissionScope"];

const SCOPES: {
  value: PermissionScope;
  titleKey: string;
  descKey: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: "private", titleKey: "agents.access.private_title", descKey: "agents.access.private_desc", icon: "lock-closed-outline" },
  { value: "workspace", titleKey: "agents.access.workspace_title", descKey: "agents.access.workspace_desc", icon: "globe-outline" },
  { value: "members", titleKey: "agents.access.members_title", descKey: "agents.access.members_desc", icon: "people-outline" },
];

/** Draft-only access editor — parent owns state, save/apply, and dirty gate. */
export function AgentAccessEditor({
  draft,
  members,
  excludeUserId,
  disabled = false,
  onDraftChange,
}: {
  draft: AgentDraft;
  members: MemberWithUser[];
  excludeUserId?: string | null;
  disabled?: boolean;
  onDraftChange: (draft: AgentDraft) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);

  const selectable = useMemo(
    () =>
      excludeUserId
        ? members.filter((m) => m.user_id !== excludeUserId)
        : members,
    [members, excludeUserId],
  );
  const selected = selectable.filter((m) => draft.memberIds.has(m.user_id));

  return (
    <View className="gap-1">
      <RadioGroup
        value={draft.permissionScope}
        onValueChange={(v) =>
          onDraftChange({ ...draft, permissionScope: v as PermissionScope })
        }
      >
        {SCOPES.map((s) => {
          const active = draft.permissionScope === s.value;
          return (
            <Pressable
              key={s.value}
              onPress={() => onDraftChange({ ...draft, permissionScope: s.value })}
              disabled={disabled}
              className={cn(
                "flex-row items-center gap-2.5 rounded-md px-2 py-2",
                active && "bg-secondary",
              )}
            >
              <RadioGroupItem
                value={s.value}
                aria-label={t(s.titleKey)}
                disabled={disabled}
              />
              <Ionicons name={s.icon} size={15} color={theme.mutedForeground} />
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">
                  {t(s.titleKey)}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {t(s.descKey)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </RadioGroup>

      {draft.permissionScope === "members" ? (
        <View className="gap-1.5">
          <Pressable
            onPress={() => setMemberPickerOpen(true)}
            disabled={disabled}
            accessibilityLabel={t("agents.access.members_title")}
            className="flex-row items-center gap-2.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5"
          >
            <Ionicons name="people-outline" size={16} color={theme.mutedForeground} />
            <Text
              className={cn(
                "flex-1 text-sm",
                selected.length > 0 ? "text-foreground" : "text-muted-foreground",
              )}
              numberOfLines={1}
            >
              {selected.length > 0
                ? selected.map((m) => m.name).join(", ")
                : t("agents.access.memberSelectTitle")}
            </Text>
            {selected.length > 0 ? (
              <Text className="text-xs text-muted-foreground tabular-nums">
                {t("agents.access.membersSummary", { count: selected.length })}
              </Text>
            ) : null}
            <Ionicons name="chevron-down" size={16} color={theme.mutedForeground} />
          </Pressable>
          {draft.memberIds.size === 0 ? (
            <Text className="text-xs text-destructive" role="alert">
              {t("agents.access.shared_target_required")}
            </Text>
          ) : null}
          <MultiSelectSheet
            visible={memberPickerOpen}
            title={t("agents.access.memberSelectTitle")}
            rows={selectable.map((m) => ({ key: m.user_id, title: m.name }))}
            selectedKeys={draft.memberIds}
            emptyText={t("agents.access.members_empty")}
            leading={(row) => <ActorAvatar type="member" id={row.key} size={32} />}
            onToggle={(id) => {
              const next = new Set(draft.memberIds);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              onDraftChange({ ...draft, memberIds: next });
            }}
            onClose={() => setMemberPickerOpen(false)}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Read-only summary for a non-owner viewer (web `!canEdit` branch). */
export function AgentAccessReadonlySummary({
  agent,
  members,
}: {
  agent: Agent;
  members: MemberWithUser[];
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const seeded = useMemo(() => deriveDuplicateAccess(agent), [agent]);
  const memberCount = seeded.memberIds.size;
  const memberNames = useMemo(() => {
    if (memberCount === 0) return "";
    const byId = new Map(members.map((m) => [m.user_id, m.name]));
    return [...seeded.memberIds].map((id) => byId.get(id) ?? id).join(", ");
  }, [members, seeded.memberIds, memberCount]);

  const label =
    seeded.permissionScope === "private"
      ? t("agents.access.trigger_private")
      : seeded.permissionScope === "workspace"
        ? t("agents.access.trigger_workspace")
        : memberCount > 0
          ? t("agents.access.trigger_members_count", { count: memberCount })
          : t("agents.access.trigger_members_empty");

  return (
    <View className="flex-row items-start gap-3 rounded-md border border-border bg-secondary/40 px-3 py-3">
      <View className="rounded-full bg-muted p-1.5">
        <Ionicons
          name="lock-closed-outline"
          size={14}
          color={THEME[colorScheme].mutedForeground}
        />
      </View>
      <View className="flex-1 min-w-0 gap-0.5">
        <Text className="text-sm font-medium text-foreground">{label}</Text>
        {seeded.permissionScope === "members" && memberNames ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={2}>
            {memberNames}
          </Text>
        ) : null}
        <Text className="text-xs text-muted-foreground leading-4">
          {t("agents.access.owner_only_readonly")}
        </Text>
      </View>
    </View>
  );
}

/** Owner-only editable section: draft state + save via useUpdateAgent. */
function EditableAgentAccessPicker({
  agent,
  members,
}: {
  agent: Agent;
  members: MemberWithUser[];
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const updateAgent = useUpdateAgent(agent.id);

  // Seeded draft = the agent's persisted grants. The reset effect below
  // compares by VALUE, so unrelated re-renders never clobber an in-progress
  // edit (web prevPersisted-ref effect); a real save lands back and resets.
  const seeded = useMemo(() => deriveDuplicateAccess(agent), [agent]);
  const [draft, setDraft] = useState<AgentDraft>(() => ({
    ...EMPTY_AGENT_DRAFT,
    permissionScope: seeded.permissionScope,
    memberIds: new Set(seeded.memberIds),
    teamIds: new Set(seeded.teamIds),
  }));
  const [prevSeed, setPrevSeed] = useState(() => seeded);

  useEffect(() => {
    const scopeChanged = seeded.permissionScope !== prevSeed.permissionScope;
    const membersChanged =
      seeded.memberIds.size !== prevSeed.memberIds.size ||
      [...prevSeed.memberIds].some((id) => !seeded.memberIds.has(id));
    if (!scopeChanged && !membersChanged) return;
    setDraft({
      ...EMPTY_AGENT_DRAFT,
      permissionScope: seeded.permissionScope,
      memberIds: new Set(seeded.memberIds),
      teamIds: new Set(seeded.teamIds),
    });
    setPrevSeed(seeded);
  }, [seeded, prevSeed]);

  const dirty =
    draft.permissionScope !== seeded.permissionScope ||
    (draft.permissionScope === "members" &&
      (draft.memberIds.size !== seeded.memberIds.size ||
        [...draft.memberIds].some((id) => !seeded.memberIds.has(id))));
  const canSave =
    dirty &&
    (draft.permissionScope !== "members" || draft.memberIds.size > 0) &&
    !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setJustSaved(false);
    try {
      await updateAgent.mutateAsync({
        permission_mode: draft.permissionScope === "private" ? "private" : "public_to",
        invocation_targets: buildInvocationTargets(draft),
      });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
    } catch (err) {
      Alert.alert(
        t("agents.access.saveFailed"),
        err instanceof Error && err.message
          ? err.message
          : t("common.unknownError"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="gap-2 rounded-md border border-border px-2 py-2">
      <AgentAccessEditor
        draft={draft}
        members={members}
        excludeUserId={agent.owner_id}
        disabled={saving}
        onDraftChange={setDraft}
      />
      <View className="flex-row items-center justify-between px-1 pt-1">
        {justSaved ? (
          <View className="flex-row items-center gap-1">
            <Ionicons
              name="checkmark-circle"
              size={14}
              color={THEME[colorScheme].brand}
            />
            <Text className="text-xs font-medium text-brand">
              {t("agents.access.saved")}
            </Text>
          </View>
        ) : (
          <View />
        )}
        <Button onPress={() => void save()} disabled={!canSave} size="sm">
          <Text>{saving ? t("agents.edit.saving") : t("agents.edit.save")}</Text>
        </Button>
      </View>
    </View>
  );
}

/** Detail-page access section: owner edits, everyone else reads. */
export function AgentAccessPicker({
  agent,
  members,
  currentUserId,
}: {
  agent: Agent;
  members: MemberWithUser[];
  currentUserId: string | null;
}) {
  const { t } = useTranslation();
  const canEdit = currentUserId !== null && agent.owner_id === currentUserId;
  if (!canEdit) {
    return (
      <View className="gap-1">
        <Text className="px-4 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("agents.access.section_title")}
        </Text>
        <AgentAccessReadonlySummary agent={agent} members={members} />
      </View>
    );
  }
  return (
    <View className="gap-1">
      <Text className="px-4 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t("agents.access.section_title")}
      </Text>
      <EditableAgentAccessPicker agent={agent} members={members} />
    </View>
  );
}