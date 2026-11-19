/**
 * Settings → Workflows (iteration 294) — mobile's port of web's
 * `WorkflowsTab` (`packages/views/workflows/workflows-tab.tsx`, MUL-7420).
 *
 * ## What was missing on the phone
 *
 * Iterations 288–293 taught the phone to READ a pipeline (`workflow.ts`), to
 * know what a status change would hand off (`workflow-handoff.ts`), and — last
 * round — to edit one column's handoff (`workflow-handoff-edit.ts`). The 「管」
 * half — create, rename, add/remove/reorder columns, delete — had no surface at
 * all: `createIssueWorkflow` / `updateIssueWorkflow` / `deleteIssueWorkflow`
 * had zero call sites in `apps/mobile`. A member could not build a pipeline on
 * their phone while a colleague on the web could build the same one.
 *
 * ## What each row says, and why each part is load-bearing
 *
 * Web's row is a name, a description, a usage count and a CHAIN of the
 * workflow's columns. All four earn their space:
 *
 *   - the name, with a 「默认」 badge for Default — "Default" is a ROLE, not a
 *     name, and a workflow may be renamed, so the flag has to be shown rather
 *     than inferred from the text;
 *   - the description, truncated: two workflows can be named alike;
 *   - the CHAIN — the columns in board order, each carrying who it hands to.
 *     This is the whole point of a workflow, and it is what tells a member
 *     whether adopting it starts agent runs;
 *   - the usage — how many projects run it. A workflow shared with three other
 *     projects is a different decision from a private one.
 *
 * The chain leaves out `blocked` and every closed-category status, exactly as
 * web's `StepChain` does: those are side states, and including them would make
 * the line read as a path an issue takes through steps it never takes.
 *
 * ## What must differ from web, and why
 *
 * Web opens the editor in place via `?workflow=<id>`. A phone pushes a route
 * instead (`workflows/[id]`), which is how every other drill-in in this app
 * works and what makes the system back gesture correct. Same information, same
 * navigation depth.
 *
 * ## Reads, and the one that must not lie
 *
 * `useIssueWorkflows` distinguishes "no workflows" from "the read failed"
 * (`lib/workflow-status-scope.ts`). This screen is where that distinction
 * finally has a user-visible consequence: painting 「还没有工作流」 over a failed
 * read would invite someone to build a workflow their workspace already has.
 */
import { useCallback, useMemo } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueWorkflow } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { IconButton } from "@/components/ui/icon-button";
import { HeaderSearchGroup } from "@/components/ui/header-search-button";
import { StatusIcon } from "@/components/ui/status-icon";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useIssueWorkflows } from "@/data/queries/workflows";
import { projectListOptions } from "@/data/queries/projects";
import { useDeleteIssueWorkflow } from "@/data/mutations/workflow-editor";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useWorkflowManagePermissions } from "@/data/use-workflow-manage-permissions";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useStatusLabel } from "@/lib/status-options";
import { handoffStepCount } from "@/lib/workflow";
import {
  deleteBlocked,
  stepChainKeys,
  usageProjectIds,
  workflowListState,
} from "@/lib/workflow-editor";
import { useTranslation } from "@/lib/i18n/react";
import { cn } from "@/lib/utils";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";

export default function WorkflowsScreen() {
  const { t } = useTranslation();
  const wsSlug = useLocalSearchParams<{ workspace: string }>().workspace;

  return (
    <>
      <Stack.Screen options={{ title: t("settings.workflowsTitle") }} />
      <WorkflowsList wsSlug={wsSlug} />
    </>
  );
}

function WorkflowsList({ wsSlug }: { wsSlug: string | undefined }) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const { workflows, state, refetch } = useIssueWorkflows(wsId);
  const { data: projects } = useQuery(projectListOptions(wsId));
  const permissions = useWorkflowManagePermissions();
  const remove = useDeleteIssueWorkflow();

  const open = useCallback(
    (id: string) => {
      if (!wsSlug) return;
      router.push(`/${wsSlug}/more/settings/workflows/${id}`);
    },
    [wsSlug],
  );
  const create = useCallback(() => {
    if (!wsSlug) return;
    router.push(`/${wsSlug}/more/settings/workflows/new`);
  }, [wsSlug]);

  /**
   * Delete, confirmed, and only offered when the server would accept it.
   *
   * Both refusals are statically knowable here (`deleteBlocked`): Default can
   * never be deleted, and a workflow a project still names can not either.
   * Offering the action anyway would send the user into an `Alert` whose only
   * outcome is an error — so the row instead says which one it is.
   */
  const confirmDelete = useCallback(
    (workflow: IssueWorkflow) => {
      if (deleteBlocked({ workflow }).blocked) return;
      Alert.alert(
        t("workflow.settings.deleteTitle", { name: workflow.name }),
        t("workflow.settings.deleteMessage"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("workflow.settings.delete"),
            style: "destructive",
            onPress: () => remove.mutate(workflow.id),
          },
        ],
      );
    },
    [remove, t],
  );

  // A screen that declares its own `headerRight` REPLACES the navigator's
  // default wholesale (React Navigation merges options key-by-key), so the
  // global search entry would vanish here. `HeaderSearchGroup` is the shared
  // composition that puts it back beside the screen's own action — the same
  // form `more/labels.tsx` and `more/squads.tsx` use.
  const headerRight = useCallback(
    () => (
      <HeaderSearchGroup>
        {permissions.canCreate ? (
          <IconButton
            name="add"
            toolbar
            onPress={create}
            accessibilityLabel={t("workflow.settings.new")}
          />
        ) : null}
      </HeaderSearchGroup>
    ),
    [permissions.canCreate, create, t],
  );

  const defaultRow = workflows?.find((w) => w.is_default) ?? null;
  const named = useMemo(
    () => (workflows ?? []).filter((w) => !w.is_default),
    [workflows],
  );
  // The four-way branch lives in `lib/workflow-editor.ts:workflowListState`,
  // NOT inline: `failed` must never be read as `empty`, and that ordering is
  // one careless `||` away from inverting when written as nested ternaries.
  const view = workflowListState(state, workflows?.length ?? 0);

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="px-4 py-4 gap-4"
        contentInsetAdjustmentBehavior="automatic"
      >
        <Text className="text-body text-muted-foreground px-1">
          {t("workflow.settings.description")}
        </Text>

        {view === "loading" ? (
          <View className="py-12 items-center">
            <ActivityIndicator />
          </View>
        ) : view === "failed" ? (
          <View className="py-10 items-center gap-3">
            <Text className="text-body text-destructive">
              {t("workflow.settings.loadFailed")}
            </Text>
            <Pressable
              onPress={refetch}
              accessibilityRole="button"
              className="rounded-md border border-border px-3 py-2 active:bg-secondary"
            >
              <Text className="text-body text-foreground">{t("common.retry")}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {view === "ready" ? (
              <View className="rounded-lg border border-border bg-card overflow-hidden">
                {defaultRow ? (
                  <WorkflowRow
                    workflow={defaultRow}
                    projects={projects}
                    canEdit={permissions.canEdit(defaultRow)}
                    onOpen={() => open(defaultRow.id)}
                    onDelete={() => confirmDelete(defaultRow)}
                    deleting={remove.isPending}
                  />
                ) : null}
                {named.map((workflow) => (
                  <WorkflowRow
                    key={workflow.id}
                    workflow={workflow}
                    projects={projects}
                    canEdit={permissions.canEdit(workflow)}
                    onOpen={() => open(workflow.id)}
                    onDelete={() => confirmDelete(workflow)}
                    deleting={remove.isPending}
                  />
                ))}
              </View>
            ) : (
              <View className="items-center gap-1.5 py-12">
                <Ionicons name="git-branch-outline" size={28} color={theme.mutedForeground} />
                <Text className="text-body text-foreground">
                  {t("workflow.settings.empty")}
                </Text>
                <Text className="text-caption text-muted-foreground text-center">
                  {t("workflow.settings.emptyHint")}
                </Text>
              </View>
            )}
          </>
        )}

        {/* The statuses every workflow draws from are the neighbouring screen —
            web renders them under the same settings tab. A row rather than a
            second stack of sections: this page is one thing (the pipelines). */}
        <Pressable
          onPress={() => wsSlug && router.push(`/${wsSlug}/more/settings/issue-statuses`)}
          accessibilityRole="button"
          className="flex-row items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 active:bg-secondary"
        >
          <View className="size-9 items-center justify-center rounded-md bg-secondary">
            <Ionicons name="git-commit-outline" size={18} color={theme.mutedForeground} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-body text-foreground">
              {t("settings.issueStatusesTitle")}
            </Text>
            <Text className="text-caption text-muted-foreground" numberOfLines={1}>
              {t("settings.issueStatusesSubtitle")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
        </Pressable>
      </ScrollView>
    </>
  );
}

function WorkflowRow({
  workflow,
  projects,
  canEdit,
  onOpen,
  onDelete,
  deleting,
}: {
  workflow: IssueWorkflow;
  projects: Parameters<typeof usageProjectIds>[1];
  canEdit: boolean;
  onOpen: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const blocked = deleteBlocked({ workflow });
  const usage = usageProjectIds(workflow, projects);
  const handoffs = handoffStepCount(workflow);

  return (
    <View className="border-b border-border/60 last:border-b-0">
      <View className="flex-row items-center gap-2 px-3 pt-3">
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={t("workflow.settings.rowAria", { name: workflow.name })}
          className="min-w-0 flex-1 active:opacity-70"
        >
          <View className="flex-row items-center gap-1.5">
            <Text className="shrink text-body font-semibold text-foreground" numberOfLines={1}>
              {workflow.name}
            </Text>
            {workflow.is_default ? (
              <View className="rounded-full bg-secondary px-1.5 py-0.5">
                <Text className="text-micro text-muted-foreground">
                  {t("workflow.settings.defaultBadge")}
                </Text>
              </View>
            ) : null}
          </View>
          {workflow.description ? (
            <Text className="text-caption text-muted-foreground" numberOfLines={1}>
              {workflow.description}
            </Text>
          ) : null}
        </Pressable>

        {canEdit && !blocked.blocked ? (
          <Pressable
            onPress={onDelete}
            disabled={deleting}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("workflow.settings.delete")}
            className="p-1 active:opacity-60"
          >
            <Ionicons name="trash-outline" size={16} color={theme.mutedForeground} />
          </Pressable>
        ) : null}
        <Pressable onPress={onOpen} hitSlop={8} accessibilityElementsHidden importantForAccessibility="no">
          <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
        </Pressable>
      </View>

      <Pressable onPress={onOpen} className="px-3 pb-3 pt-2 active:opacity-70">
        <StepChain workflow={workflow} />
        <View className="mt-2 flex-row items-center gap-3">
          <Text className="text-micro text-muted-foreground">
            {workflow.is_default
              ? usage.length > 0
                ? t("workflow.settings.usageDefault", { count: usage.length })
                : t("workflow.settings.usageDefaultNone")
              : usage.length > 0
                ? t("workflow.settings.projects", { count: usage.length })
                : t("workflow.settings.noProjects")}
          </Text>
          {handoffs > 0 ? (
            <Text className="text-micro text-muted-foreground">
              {t(
                handoffs === 1
                  ? "workflow.project.handoffs_one"
                  : "workflow.project.handoffs_other",
                { count: handoffs },
              )}
            </Text>
          ) : null}
          {blocked.reason === "in_use" && canEdit ? (
            <Text className="min-w-0 flex-1 text-micro text-muted-foreground" numberOfLines={1}>
              {t("workflow.settings.deleteInUse", { count: workflow.project_ids.length })}
            </Text>
          ) : null}
          {blocked.reason === "default" && canEdit ? (
            <Text className="min-w-0 flex-1 text-micro text-muted-foreground" numberOfLines={1}>
              {t("workflow.settings.deleteDefaultBlocked")}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

/**
 * A workflow's columns as a chain of chips, each with its handler — web's
 * `StepChain` (`workflows-tab.tsx:382`).
 *
 * `blocked` and every closed-category status are left out so the chain reads as
 * the path an issue takes rather than a list of every column that exists. The
 * arrow travels with the step it points to, so a wrapped line starts with
 * "→ step" instead of ending on a dangling arrow.
 */
function StepChain({ workflow }: { workflow: IssueWorkflow }) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { categoryOf } = useIssueStatuses(wsId);
  const statusLabel = useStatusLabel(wsId);
  const { getName } = useActorLookup();

  // Which chips survive is a pure decision: `blocked` and the CLOSED end state
  // are side states, but `done` is part of the path and stays. See
  // `lib/workflow-editor.ts:stepChainKeys` for why the category check is
  // spelled `cancelled` here and `closed` upstream.
  const path = workflow.steps.filter((step) =>
    stepChainKeys([step], categoryOf).length > 0,
  );

  return (
    <View className="flex-row flex-wrap items-center gap-x-1 gap-y-1.5">
      {path.map((step, index) => {
        const { type, id } = step.handler;
        const actor =
          (type === "agent" || type === "squad" || type === "member") && id
            ? { type, id }
            : null;
        return (
          <View key={step.status_key} className="flex-row items-center gap-1">
            {index > 0 ? (
              <Ionicons name="arrow-forward" size={11} color="#a1a1aa" />
            ) : null}
            <View
              className={cn(
                "flex-row items-center gap-1.5 rounded-full border border-border bg-background pl-2",
                actor ? "pr-0.5" : "pr-2",
              )}
            >
              <StatusIcon status={step.status_key} category={categoryOf(step.status_key)} size={11} />
              <Text className="text-caption text-foreground">{statusLabel(step.status_key)}</Text>
              {actor ? (
                <View className="flex-row items-center gap-1 rounded-full bg-secondary pl-px pr-1.5">
                  <ActorAvatar type={actor.type} id={actor.id} size={14} />
                  <Text className="max-w-32 text-micro text-muted-foreground" numberOfLines={1}>
                    {getName(actor.type, actor.id)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
