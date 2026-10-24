/**
 * Runtime access editor (MUL-8185) — mobile mirror of web
 * `packages/views/runtimes/components/runtime-access-editor.tsx`.
 *
 * Three scopes over two stored fields: Private and Public apply in one tap
 * (as they did before member sharing existed), while "Specific members" opens
 * a draft sheet that only persists on Save. The draft boundary is the point:
 * a half-made selection must never be shared, and a Cancel must leave the
 * runtime exactly as it was.
 *
 * Restricting access can be refused by the server with a structured 409 when
 * teammates still have agents bound or runs in flight. That plan is shown for
 * confirmation and re-submitted with its exact id sets — the mutation is never
 * retried silently, because it unbinds other people's agents.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { AgentRuntime, MemberWithUser } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { memberListOptions } from "@/data/queries/members";
import { catalogRead } from "@/lib/catalog-read";
import { CatalogEmptySlot } from "@/components/catalog/catalog-status";
import type { CatalogState } from "@/lib/catalog-state";
import { useRevokeRuntimeAccess, useUpdateRuntime } from "@/data/mutations/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  canSaveShareDraft,
  describeRevocationPlan,
  filterShareableMembers,
  parseRuntimeAccessRevocationPlan,
  runtimeAccessPatch,
  runtimeAccessScope,
  type RuntimeAccessRevocationPlan,
  type RuntimeAccessScope,
  shareableMembers,
  sharedWithMembers,
} from "@/lib/runtime-access";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Below this many candidates the sheet's search field would only add noise —
 * the list fits without scrolling. Same threshold as web, measured on the
 * candidate list because the owner is never one of them.
 */
const MEMBER_SEARCH_THRESHOLD = 7;

const SCOPE_ICON: Record<RuntimeAccessScope, keyof typeof Ionicons.glyphMap> = {
  private: "lock-closed-outline",
  public: "globe-outline",
  members: "people-outline",
};

export function RuntimeAccessEditor({ runtime }: { runtime: AgentRuntime }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // The member directory read keeps its load state: a grant list resolved
  // against a directory that has not arrived renders as zero recipients, and
  // the same list drives the "who can use this" summary. Defaulting the query
  // to `[]` would make a failed read look like "nobody is shared with" — the
  // exact collapse `catalogRead` exists to prevent.
  const membersRead = catalogRead(useQuery(memberListOptions(wsId)));
  const members = membersRead.items;
  const updateRuntime = useUpdateRuntime();
  const revokeAccess = useRevokeRuntimeAccess();

  const current = runtimeAccessScope(runtime);
  const persisted = useMemo(() => runtime.shared_with ?? [], [runtime.shared_with]);
  const recipients = useMemo(
    () => sharedWithMembers(runtime, members),
    [runtime, members],
  );
  const candidates = useMemo(
    () => shareableMembers(runtime, members),
    [runtime, members],
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [plan, setPlan] = useState<RuntimeAccessRevocationPlan | null>(null);
  /** The grant list the pending restriction would leave in place. */
  const [pendingSharedWith, setPendingSharedWith] = useState<string[]>([]);
  /**
   * Set when a confirmation attempt was refused because the impact moved
   * under us. Re-confirming the *new* plan is the only way forward, so the
   * dialog has to say that the totals changed rather than silently swapping
   * them — otherwise the second confirmation looks identical to the first.
   */
  const [planChanged, setPlanChanged] = useState(false);

  const busy = updateRuntime.isPending || revokeAccess.isPending;
  /**
   * The scope the last write settled on, for the inline confirmation. The old
   * two-button editor alerted on every flip; without some acknowledgement a
   * one-tap scope change looks like nothing happened until the list refetches.
   * Cleared as soon as another write starts, so it always describes the write
   * that just landed.
   */
  const [justApplied, setJustApplied] = useState<RuntimeAccessScope | null>(null);
  /** Last write failure, in the scope's own words. */
  const [writeError, setWriteError] = useState<string | null>(null);

  const apply = (scope: RuntimeAccessScope, memberIds: string[] = []) => {
    setJustApplied(null);
    setWriteError(null);
    updateRuntime.mutate(
      { runtimeId: runtime.id, patch: runtimeAccessPatch(scope, memberIds) },
      {
        onSuccess: () => setJustApplied(scope),
        onError: (err) => {
          const nextPlan = parseRuntimeAccessRevocationPlan(err);
          if (nextPlan) {
            setPendingSharedWith(memberIds);
            setPlanChanged(false);
            setPlan(nextPlan);
            return;
          }
          // Not a reviewable plan: a rejection (public-with-grants, a lost
          // race, a permission change) must say so rather than leave the
          // control looking as though it silently refused.
          setWriteError(
            err instanceof Error && err.message
              ? err.message
              : t("runtimes.detail.visibilityFailed"),
          );
        },
      },
    );
  };

  const confirmRevoke = () => {
    if (!plan) return;
    revokeAccess.mutate(
      {
        runtimeId: runtime.id,
        expectedNonownerAgentIds: plan.agents.map((agent) => agent.id),
        expectedTaskIds: plan.activeTaskIds,
        sharedWith: pendingSharedWith,
      },
      {
        onSuccess: () => {
          setPlan(null);
          setPlanChanged(false);
          setJustApplied(pendingSharedWith.length > 0 ? "members" : "private");
        },
        onError: (err) => {
          // A stale plan is re-issued with the fresh id sets; re-confirming is
          // the only way the user can see what the new totals are. Anything
          // else clears the dialog — a plan we cannot read must never be
          // submitted, and leaving the old one up would do exactly that.
          const nextPlan = parseRuntimeAccessRevocationPlan(err);
          if (nextPlan) {
            setPlan(nextPlan);
            setPlanChanged(true);
          } else {
            setPlan(null);
            setPlanChanged(false);
            setWriteError(
              err instanceof Error && err.message
                ? err.message
                : t("runtimes.access.revoke.toastFailed"),
            );
          }
        },
      },
    );
  };

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-1 rounded-md bg-secondary p-0.5">
        {(["private", "public", "members"] as const).map((scope) => (
          <ScopeButton
            key={scope}
            scope={scope}
            active={current === scope}
            disabled={busy}
            /** "Members" opens the draft sheet instead of applying directly. */
            onPress={() =>
              scope === "members" ? setPickerOpen(true) : apply(scope)
            }
          />
        ))}
      </View>

      <Text className="text-caption text-muted-foreground">
        {t(`runtimes.detail.visibilityHint.${current}`)}
      </Text>

      {writeError ? (
        <Text className="text-caption text-destructive" accessibilityRole="alert">
          {writeError}
        </Text>
      ) : justApplied ? (
        <View className="flex-row items-center gap-1">
          <Ionicons name="checkmark-circle" size={12} color={theme.brand} />
          <Text className="text-caption font-medium text-brand">
            {t("runtimes.access.applied", {
              scope: t(`runtimes.access.label.${justApplied}`),
            })}
          </Text>
        </View>
      ) : null}

      {current === "members" ? (
        <Pressable
          onPress={() => setPickerOpen(true)}
          disabled={busy}
          className="flex-row items-center gap-2 rounded-md px-1 py-1 active:bg-secondary"
          accessibilityRole="button"
          accessibilityLabel={t("runtimes.access.membersEdit")}
        >
          <View className="flex-row -space-x-1.5">
            {recipients.slice(0, 4).map((member) => (
              <View key={member.user_id} className="rounded-full border-2 border-background">
                <ActorAvatar type="member" id={member.user_id} size={20} />
              </View>
            ))}
          </View>
          <Text className="flex-1 text-caption text-muted-foreground" numberOfLines={1}>
            {recipients.length > 0
              ? recipients.map((member) => member.name).join(", ")
              : t("runtimes.access.membersCount", { count: persisted.length })}
          </Text>
          <Text className="text-caption font-medium text-foreground">
            {t("runtimes.access.membersEdit")}
          </Text>
        </Pressable>
      ) : null}

      <MemberGrantSheet
        // Remounting per open gives each visit a fresh draft seeded from the
        // persisted grants — a Cancel therefore discards every edit, and a
        // reopened sheet never shows what a previous, abandoned draft held.
        key={pickerOpen ? `open-${persisted.join(",")}` : "closed"}
        visible={pickerOpen}
        runtime={runtime}
        candidates={candidates}
        membersState={membersRead.state}
        onRetryMembers={membersRead.retry}
        persisted={persisted}
        saving={updateRuntime.isPending}
        onCancel={() => setPickerOpen(false)}
        onSave={(ids) => {
          setPickerOpen(false);
          apply("members", ids);
        }}
      />

      <RevokeAccessDialog
        // A re-issued plan is a NEW question, so the acknowledgement has to be
        // given again. Keying on the plan's own totals remounts the dialog
        // exactly when the numbers the user is agreeing to changed.
        key={plan ? `${plan.agents.map((a) => a.id).join(",")}|${plan.activeTaskIds.join(",")}` : "none"}
        plan={plan}
        runtime={runtime}
        planChanged={planChanged}
        submitting={revokeAccess.isPending}
        onCancel={() => {
          if (revokeAccess.isPending) return;
          setPlan(null);
          setPlanChanged(false);
        }}
        onConfirm={confirmRevoke}
      />
    </View>
  );
}

/** Static three-way readout for viewers who may not edit access. */
export function RuntimeAccessReadout({ runtime }: { runtime: AgentRuntime }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const scope = runtimeAccessScope(runtime);
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-1.5">
        <Ionicons name={SCOPE_ICON[scope]} size={14} color={theme.mutedForeground} />
        <Text className="text-caption font-medium text-foreground">
          {t(`runtimes.access.label.${scope}`)}
        </Text>
      </View>
      <Text className="text-caption text-muted-foreground">
        {t(`runtimes.detail.visibilityReadonly.${scope}`)}
      </Text>
    </View>
  );
}

function ScopeButton({
  scope,
  active,
  disabled,
  onPress,
}: {
  scope: RuntimeAccessScope;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={t(`runtimes.access.choice.${scope}`)}
      className={cn(
        "flex-1 flex-row items-center justify-center gap-1 rounded px-2 py-1.5",
        active ? "bg-background" : "bg-transparent",
        disabled && "opacity-60",
      )}
    >
      <Ionicons
        name={SCOPE_ICON[scope]}
        size={12}
        color={active ? theme.foreground : theme.mutedForeground}
      />
      <Text
        className={cn(
          "text-caption font-medium",
          active ? "text-foreground" : "text-muted-foreground",
        )}
        numberOfLines={1}
      >
        {t(`runtimes.access.choice.${scope}`)}
      </Text>
    </Pressable>
  );
}

/**
 * Draft grant picker. Selection lives here, not in the parent, so closing the
 * sheet by any route (Cancel, hardware back, save) drops the draft with it.
 */
function MemberGrantSheet({
  visible,
  runtime,
  candidates,
  membersState,
  onRetryMembers,
  persisted,
  saving,
  onCancel,
  onSave,
}: {
  visible: boolean;
  runtime: AgentRuntime;
  candidates: MemberWithUser[];
  /** Load state of the member directory backing `candidates`. Without it an
   *  unarrived read and a workspace with no other members are the same value,
   *  and the sheet would say 「工作区里还没有其他成员。」 about a request that
   *  never landed (MYS-1907's defect shape). */
  membersState: CatalogState;
  onRetryMembers: () => void;
  persisted: readonly string[];
  saving: boolean;
  onCancel: () => void;
  onSave: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [draft, setDraft] = useState<string[]>(() => [...persisted]);
  const [query, setQuery] = useState("");

  const visibleRows = filterShareableMembers(candidates, query);
  const canSave = canSaveShareDraft(persisted, draft, saving);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View className="flex-1 justify-end bg-black/40">
        <View className="max-h-[80%] rounded-t-2xl bg-background">
          <View className="border-b border-border px-4 py-3 flex-row items-center gap-2">
            <Text className="flex-1 text-title-sm font-semibold text-foreground">
              {t("runtimes.access.membersTitle")}
            </Text>
            <Pressable onPress={onCancel} hitSlop={8} disabled={saving}>
              <Ionicons name="close" size={20} color={theme.mutedForeground} />
            </Pressable>
          </View>

          {candidates.length >= MEMBER_SEARCH_THRESHOLD ? (
            <View className="px-4 pt-3">
              <TextField
                value={query}
                onChangeText={setQuery}
                placeholder={t("runtimes.access.membersSearch")}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ) : null}

          <ScrollView className="max-h-80" contentContainerClassName="py-1">
            {visibleRows.length === 0 ? (
              /* Loading / failed / genuinely-empty / no-match are four
                 different facts; the shared slot is the only place allowed to
                 claim the third, and only after the read settled. */
              <CatalogEmptySlot
                states={[membersState]}
                onRetry={onRetryMembers}
                emptyMessage={t("runtimes.access.membersNone")}
                query={query}
              />
            ) : (
              visibleRows.map((member) => {
                const checked = draft.includes(member.user_id);
                return (
                  <Pressable
                    key={member.user_id}
                    disabled={saving}
                    onPress={() =>
                      setDraft((ids) =>
                        checked
                          ? ids.filter((id) => id !== member.user_id)
                          : [...ids, member.user_id],
                      )
                    }
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked, disabled: saving }}
                    accessibilityLabel={member.name}
                    className="flex-row items-center gap-2.5 px-4 py-2.5 active:bg-secondary"
                  >
                    <Ionicons
                      name={checked ? "checkbox" : "square-outline"}
                      size={18}
                      color={checked ? theme.info : theme.mutedForeground}
                    />
                    <ActorAvatar type="member" id={member.user_id} size={28} />
                    <Text
                      className="flex-1 text-caption text-foreground"
                      numberOfLines={1}
                    >
                      {member.name}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View className="flex-row items-center justify-end gap-2 border-t border-border px-4 py-3">
            <Button variant="outline" size="sm" onPress={onCancel} disabled={saving}>
              <Text>{t("runtimes.access.cancel")}</Text>
            </Button>
            <Button
              size="sm"
              onPress={() => onSave(draft)}
              disabled={!canSave}
            >
              {saving ? (
                <ActivityIndicator size="small" color={theme.primaryForeground} />
              ) : (
                <Text>{t("runtimes.access.save")}</Text>
              )}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Confirmation for a restriction the server refused to apply silently. Both
 * counts come from the server's plan — never from local caches — because the
 * question being answered is "what is the server about to do", and the id sets
 * submitted below are the same ones it printed.
 */
function RevokeAccessDialog({
  plan,
  runtime,
  planChanged,
  submitting,
  onCancel,
  onConfirm,
}: {
  plan: RuntimeAccessRevocationPlan | null;
  runtime: AgentRuntime;
  planChanged: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  /**
   * Re-armed on every new plan. This dialog unbinds other people's agents and
   * cancels their running work, so a tap that lands on the wrong button must
   * not be enough — web gates the same confirm behind this acknowledgement.
   */
  const [acknowledged, setAcknowledged] = useState(false);
  if (!plan) return null;
  const { agentCount, taskCount } = describeRevocationPlan(plan);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full gap-3 rounded-xl bg-background p-4">
          <Text className="text-title-sm font-semibold text-foreground">
            {t("runtimes.access.revoke.title")}
          </Text>
          <Text className="text-caption text-muted-foreground">
            {t("runtimes.access.revoke.description", {
              name: runtime.custom_name || runtime.name,
              agentCount,
              taskCount,
            })}
          </Text>
          {plan.agents.slice(0, 6).map((agent) => (
            <View key={agent.id} className="flex-row items-center gap-2">
              <Ionicons name="git-branch-outline" size={12} color={theme.mutedForeground} />
              <Text className="flex-1 text-caption text-foreground" numberOfLines={1}>
                {agent.name}
              </Text>
            </View>
          ))}
          <Text className="text-caption text-destructive">
            {t("runtimes.access.revoke.warning")}
          </Text>
          {planChanged ? (
            <Text
              className="rounded-md bg-secondary px-2 py-1.5 text-caption text-foreground"
              accessibilityRole="alert"
            >
              {t("runtimes.access.revoke.planChanged")}
            </Text>
          ) : null}
          <Pressable
            onPress={() => setAcknowledged((value) => !value)}
            disabled={submitting}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acknowledged, disabled: submitting }}
            className="flex-row items-start gap-2 rounded-md border border-border px-2 py-2 active:bg-secondary"
          >
            <Ionicons
              name={acknowledged ? "checkbox" : "square-outline"}
              size={16}
              color={acknowledged ? theme.primary : theme.mutedForeground}
            />
            <Text className="flex-1 text-caption text-foreground">
              {t("runtimes.access.revoke.checkbox", { agentCount, taskCount })}
            </Text>
          </Pressable>
          <View className="flex-row justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onPress={onCancel} disabled={submitting}>
              <Text>{t("runtimes.access.cancel")}</Text>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onPress={onConfirm}
              disabled={submitting || !acknowledged}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={theme.primaryForeground} />
              ) : (
                <Text>{t("runtimes.access.revoke.confirm")}</Text>
              )}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
