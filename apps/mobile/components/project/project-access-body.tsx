/**
 * Project access editor — the body of the 「访问权限」 sheet, mobile's
 * counterpart to web's `AccessFields` (`packages/views/projects/components/
 * project-access.tsx:24-111`, deployed `v0.9.0-myswy.2`).
 *
 * ## What it is, and what it is not
 *
 * It is a pure body: every value in, every intent out through callbacks. The
 * route (`project/[id]/picker/access.tsx`) owns the queries, the mutation and
 * the confirmation; this file owns only the layout. That split is what lets the
 * same body serve a future create-time draft picker without a second copy.
 *
 * ## The order, and why it is web's order
 *
 *   1. the two-way visibility choice — the question the screen exists to answer;
 *   2. (private only) the member list, with the add control above it;
 *   3. (private only) the two notices: admins always have access, and an agent
 *      follows its owner.
 *
 * Putting membership above the choice would ask "who is in it" before "is it
 * restricted at all", and the second notice exists because a user who has read
 * about private projects asks next whether their agent still sees it.
 *
 * ## Three things this body must NOT decide
 *
 *   - whether it may be edited at all (`canManage`) — the caller resolves that
 *     from `canManageProjectAccess`;
 *   - whether a change needs confirmation (`visibilityRequiresPublishConfirm`) —
 *     that belongs with the write, not the layout;
 *   - whether a row is removable (`canRemoveProjectMember`) — same reason. The
 *     body renders the control only when the predicate says so, which is how
 *     the lead and the caller end up without one.
 *
 * ## Read states that must stay distinguishable
 *
 * A failed member read is NOT "no members". Showing an empty list there would
 * claim the project has nobody in it — the same read-failure-as-absence defect
 * this repo has fixed repeatedly — so the failure renders its own sentence and a
 * retry, and the member list is not drawn at all.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { MemberWithUser, ProjectMember, ProjectVisibility } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { matchesNameOrPinyin } from "@/lib/name-search";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTranslation } from "@/lib/i18n/react";
import { THEME } from "@/lib/theme";

export interface ProjectAccessBodyProps {
  /** The value currently selected in the form (not necessarily saved). */
  visibility: ProjectVisibility;
  onVisibilityChange: (next: ProjectVisibility) => void;
  /** Workspace directory — the pool a member can be added from. */
  workspaceMembers: MemberWithUser[];
  /** The project's member rows, as the server reports them. */
  projectMembers: ProjectMember[];
  /** Member ids currently selected in the form (draft or server). */
  selectedIds: string[];
  currentUserId?: string | null;
  leadId?: string | null;
  /** False renders every control inert and says who may change it. */
  canManage: boolean;
  /** True while a write is in flight — every control goes inert. */
  pending: boolean;
  loading: boolean;
  loadFailed: boolean;
  onRetry: () => void;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
  /** Predicate from `canRemoveProjectMember`; the body only renders the flag. */
  canRemove: (userId: string) => boolean;
}

/** Row order: a stable, explainable list rather than the server's. The caller
 *  first (it is the reader's own row), then the lead, then everyone else by
 *  name — the same "you, then who matters, then the rest" ordering web gets
 *  implicitly from insertion order. */
function orderMemberRows(
  rows: ProjectMember[],
  currentUserId: string | null | undefined,
  leadId: string | null | undefined,
): ProjectMember[] {
  const rank = (row: ProjectMember) => {
    if (currentUserId && row.user_id === currentUserId) return 0;
    if (leadId && row.user_id === leadId) return 1;
    return 2;
  };
  return [...rows].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  );
}

export function ProjectAccessBody({
  visibility,
  onVisibilityChange,
  workspaceMembers,
  projectMembers,
  selectedIds,
  currentUserId,
  leadId,
  canManage,
  pending,
  loading,
  loadFailed,
  onRetry,
  onAdd,
  onRemove,
  canRemove,
}: ProjectAccessBodyProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rows = useMemo(() => {
    // The member rows are the truth for who is IN it; `selectedIds` is the
    // draft. On a saved private project the two agree. While drafting a switch
    // the server has no rows yet, so missing members are synthesized from the
    // workspace directory — otherwise a member picked a second ago would not
    // appear until the write landed.
    const byId = new Map(projectMembers.map((m) => [m.user_id, m]));
    return orderMemberRows(
      selectedIds.map((id) => {
        const existing = byId.get(id);
        if (existing) return existing;
        const directory = workspaceMembers.find((m) => m.user_id === id);
        return {
          project_id: "",
          user_id: id,
          name: directory?.name ?? id,
          email: directory?.email ?? "",
          avatar_url: directory?.avatar_url ?? null,
          added_by: null,
          created_at: "",
          workspace_role: directory?.role ?? "",
        } satisfies ProjectMember;
      }),
      currentUserId,
      leadId,
    );
  }, [projectMembers, selectedIds, workspaceMembers, currentUserId, leadId]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workspaceMembers
      .filter((m) => !selectedSet.has(m.user_id))
      .filter((m) => (q ? matchesNameOrPinyin(m.name, q) || m.email.toLowerCase().includes(q) : true))
      .slice(0, 50);
  }, [workspaceMembers, selectedSet, query]);

  if (loadFailed) {
    return (
      <View className="flex-1 items-start gap-3 px-4 py-6">
        <Text className="text-body text-destructive" accessibilityRole="alert">
          {t("projects.access.load_failed")}
        </Text>
        <Button variant="outline" size="sm" onPress={onRetry}>
          <Text>{t("projects.access.retry")}</Text>
        </Button>
      </View>
    );
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center py-10" accessibilityRole="progressbar">
        <ActivityIndicator />
      </View>
    );
  }

  const inert = pending || !canManage;

  return (
    <ScrollView
      className="flex-1"
      // Bottom padding clears the sheet's own footer: the last member row must
      // not sit flush against the save button, or a tap meant for the row lands
      // on 保存.
      contentContainerClassName="pb-4"
      keyboardShouldPersistTaps="handled"
    >
      <View className="mx-4 mt-3 overflow-hidden rounded-xl border border-border">
        <VisibilityOption
          value="workspace"
          icon="globe-outline"
          label={t("projects.access.workspace")}
          hint={t("projects.access.workspaceHint")}
          current={visibility}
          disabled={inert}
          onChange={onVisibilityChange}
        />
        <View className="h-px bg-border ml-11" />
        <VisibilityOption
          value="private"
          icon="lock-closed-outline"
          label={t("projects.access.private")}
          hint={t("projects.access.privateHint")}
          current={visibility}
          disabled={inert}
          onChange={onVisibilityChange}
        />
      </View>

      {!canManage ? (
        <Text className="mx-4 mt-3 text-caption text-muted-foreground">
          {t("projects.access.read_only")}
        </Text>
      ) : null}

      {visibility === "private" ? (
        <>
          <View className="mx-4 mt-5 flex-row items-center justify-between">
            <Text className="text-caption font-medium text-foreground">
              {t("projects.access.members_count", { count: rows.length })}
            </Text>
            {canManage ? (
              <Pressable
                onPress={() => setAdding((v) => !v)}
                disabled={pending}
                accessibilityRole="button"
                accessibilityLabel={t("projects.access.add")}
                className="flex-row items-center gap-1 px-2 py-1 active:opacity-60"
              >
                <Ionicons
                  name={adding ? "close" : "person-add-outline"}
                  size={15}
                  color={theme.brand}
                />
                <Text className="text-caption text-brand">
                  {adding ? t("common.cancel") : t("projects.access.add")}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {adding && canManage ? (
            <View className="mx-4 mt-2 overflow-hidden rounded-xl border border-border">
              <View className="flex-row items-center gap-2 border-b border-border px-3 py-2">
                <Ionicons name="search" size={15} color={theme.mutedForeground} />
                <TextInputInline
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t("projects.access.search")}
                />
              </View>
              {candidates.length === 0 ? (
                <Text className="px-3 py-3 text-caption text-muted-foreground">
                  {t("projects.access.no_members")}
                </Text>
              ) : (
                candidates.map((m) => (
                  <Pressable
                    key={m.user_id}
                    onPress={() => {
                      onAdd(m.user_id);
                      setQuery("");
                    }}
                    disabled={pending}
                    accessibilityRole="button"
                    className="flex-row items-center gap-3 px-3 py-2.5 active:bg-secondary"
                  >
                    <ActorAvatar type="member" id={m.user_id} size={28} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-body text-foreground" numberOfLines={1}>
                        {m.name}
                      </Text>
                      <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                        {m.email}
                      </Text>
                    </View>
                    <Ionicons name="add" size={18} color={theme.mutedForeground} />
                  </Pressable>
                ))
              )}
            </View>
          ) : null}

          <View className="mx-4 mt-3 overflow-hidden rounded-xl border border-border">
            {rows.length === 0 ? (
              <Text className="px-3 py-3 text-caption text-muted-foreground">
                {t("projects.access.no_selected")}
              </Text>
            ) : (
              rows.map((m, i) => {
                const isYou = !!currentUserId && m.user_id === currentUserId;
                const isLead = !!leadId && m.user_id === leadId;
                // The server's own role wins when present; the directory is the
                // fallback for a synthesized draft row.
                const role =
                  m.workspace_role ||
                  workspaceMembers.find((w) => w.user_id === m.user_id)?.role ||
                  "";
                const removable = canRemove(m.user_id);
                return (
                  <View key={m.user_id}>
                    {i > 0 ? <View className="h-px bg-border ml-12" /> : null}
                    <View className="flex-row items-center gap-3 px-3 py-2.5">
                      <ActorAvatar type="member" id={m.user_id} size={30} />
                      <View className="min-w-0 flex-1">
                        <Text className="text-body text-foreground" numberOfLines={1}>
                          {m.name}
                          {isYou ? (
                            <Text className="text-caption text-muted-foreground">
                              {"  "}
                              {t("projects.access.you")}
                            </Text>
                          ) : null}
                        </Text>
                        {m.email ? (
                          <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                            {m.email}
                          </Text>
                        ) : null}
                      </View>
                      {/* The trailing slot carries exactly ONE thing, in
                          priority order: the lead marker, else the role, else
                          the remove control. Web's row does the same
                          (`project-access.tsx:92-101`) — the marker answers
                          "why can't I remove this one", which is the question
                          the missing button raises. */}
                      {isLead ? (
                        <Text className="text-caption text-muted-foreground">
                          {t("picker.lead")}
                        </Text>
                      ) : role === "owner" || role === "admin" ? (
                        <Text className="text-caption text-muted-foreground">{role}</Text>
                      ) : removable ? (
                        <Pressable
                          onPress={() => onRemove(m.user_id)}
                          disabled={pending}
                          hitSlop={10}
                          accessibilityRole="button"
                          accessibilityLabel={t("projects.access.remove_aria", { name: m.name })}
                          className="p-1 active:opacity-60"
                        >
                          <Ionicons name="close" size={16} color={theme.mutedForeground} />
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
          </View>

          <View className="mx-4 mt-4 gap-2">
            <Notice icon="shield-checkmark-outline" text={t("projects.access.admin_notice")} />
            <Notice icon="hardware-chip-outline" text={t("projects.access.agent_notice")} />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function VisibilityOption({
  value,
  icon,
  label,
  hint,
  current,
  disabled,
  onChange,
}: {
  value: ProjectVisibility;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  hint: string;
  current: ProjectVisibility;
  disabled: boolean;
  onChange: (next: ProjectVisibility) => void;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const selected = current === value;
  return (
    <Pressable
      onPress={() => onChange(value)}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      className={
        selected
          ? "flex-row items-center gap-3 bg-secondary/60 px-4 py-3"
          : "flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
      }
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={18}
        color={selected ? theme.brand : theme.mutedForeground}
      />
      <View className="min-w-0 flex-1">
        <Text
          className={
            selected
              ? "text-body text-foreground font-medium"
              : "text-body text-foreground"
          }
        >
          {label}
        </Text>
        <Text className="mt-0.5 text-caption text-muted-foreground">{hint}</Text>
      </View>
      <Ionicons name={icon} size={16} color={theme.mutedForeground} />
    </Pressable>
  );
}

function Notice({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="flex-row items-start gap-2">
      <Ionicons
        name={icon}
        size={14}
        color={THEME[colorScheme].mutedForeground}
        style={{ marginTop: 2 }}
      />
      <Text className="flex-1 text-caption text-muted-foreground">{text}</Text>
    </View>
  );
}

/** The search field, mirroring PickerBodyShell's so the two sheets look the
 *  same. Kept local because this body is not a `usePickerSearch` consumer: it
 *  searches the ADD list only, and the sheet keeps it open across adds. */
function TextInputInline({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={THEME[colorScheme].mutedForeground}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      accessibilityLabel={placeholder}
      className="flex-1 text-body text-foreground py-0"
    />
  );
}
