/**
 * Workflow picker body (MUL-7420, MYS-2690) — mobile's rendering of web's
 * `WorkflowChoiceItems` (`packages/views/workflows/project-workflow-row.tsx:95`).
 *
 * ## Why a route rather than a dropdown
 *
 * Web hangs a `DropdownMenu` off the property row. A phone has no room for a
 * 320px menu with three lines per item, and a dropdown cannot be scrolled with
 * a thumb. Every other single-select property in this app is a `formSheet`
 * route (`picker/status`, `picker/priority`, `picker/lead`, …), so the workflow
 * becomes one too — same interaction as its neighbours, per
 * `apps/mobile/CLAUDE.md` Principle 1.
 *
 * ## What each row must carry
 *
 * Web's item is three lines and all three are load-bearing for the choice:
 *
 *   - the NAME, with a 「Default」 badge when it is the workspace Default —
 *     because "Default" is a role, not a name, and a workflow may be renamed;
 *   - the SIZE: how many statuses and how many handoff steps. This is what
 *     tells a member whether the board they are about to adopt has two columns
 *     or eight, and whether anything will start running;
 *   - the USAGE: which projects already run it. "Used by: Alpha, Beta" is the
 *     fact that stops someone switching a project onto a workflow it shares
 *     with three others without realising the handoffs apply to all of them.
 *
 * A check mark marks the one in use. Picking that one is a no-op and the route
 * short-circuits rather than writing (`projectWorkflowChoiceChanges`).
 */
import { FlatList, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueWorkflow, Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Skeleton } from "@/components/ui/skeleton";
import { CatalogEmptySlot, CatalogStatus } from "@/components/catalog/catalog-status";
import { handoffStepCount } from "@/lib/workflow";
import { workflowsProjectNames } from "@/lib/project-workflow";
import type { WorkflowReadState } from "@/lib/workflow-status-scope";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTranslation } from "@/lib/i18n/react";
import { THEME } from "@/lib/theme";

export interface WorkflowPickerBodyProps {
  workflows: readonly IssueWorkflow[] | undefined;
  /** The workflow read's state — `undefined` data with `"failed"` is NOT
   *  "no workflows", and the body must not say so. */
  state: WorkflowReadState;
  /** The project list, for the usage lines. `undefined` while loading. */
  projects: readonly Pick<Project, "id" | "title" | "workflow_id">[] | undefined;
  /** The workflow the project uses now, if it is resolved. */
  currentWorkflowId: string | null | undefined;
  onChoose: (workflow: IssueWorkflow) => void;
  /** Re-runs both reads. Wired to the error state's retry. */
  onRetry: () => void;
}

export function WorkflowPickerBody({
  workflows,
  state,
  projects,
  currentWorkflowId,
  onChoose,
  onRetry,
}: WorkflowPickerBodyProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const separator = t("workflow.listSeparator");

  // `state` decides, never `workflows.length`: an empty list from a FAILED read
  // is not "this workspace has no workflows", and painting the empty sentence
  // there is the exact defect `lib/catalog-state.ts` exists to prevent.
  if (state === "failed") {
    return (
      <CatalogStatus
        state="error"
        layout="centered"
        errorMessage={t("workflow.project.unverified")}
        onRetry={onRetry}
      />
    );
  }
  if (state === "pending" && !workflows) {
    return (
      <View className="gap-2 px-4 pt-3">
        {[0, 1, 2].map((i) => (
          <View key={i} className="gap-1.5 rounded-lg border border-border px-3 py-3">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-32" />
          </View>
        ))}
      </View>
    );
  }

  return (
    <FlatList
      data={workflows ?? []}
      keyExtractor={(workflow) => workflow.id}
      contentContainerClassName="px-3 pb-6 pt-2"
      ListEmptyComponent={
        <CatalogEmptySlot
          states={["ready"]}
          onRetry={onRetry}
          emptyMessage={t("workflow.project.noWorkflows")}
        />
      }
      renderItem={({ item: workflow }) => {
        const selected = workflow.id === currentWorkflowId;
        const handoffs = handoffStepCount(workflow);
        const usedBy = workflowsProjectNames({ workflow, projects }).join(separator);
        const statuses = t(
          workflow.steps.length === 1
            ? "workflow.project.statuses_one"
            : "workflow.project.statuses_other",
          { count: workflow.steps.length },
        );
        const handoffLabel =
          handoffs > 0
            ? t(
                handoffs === 1
                  ? "workflow.project.handoffs_one"
                  : "workflow.project.handoffs_other",
                { count: handoffs },
              )
            : t("workflow.project.noHandoffs");
        return (
          <Pressable
            onPress={() => onChoose(workflow)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            className="flex-row items-start gap-2.5 rounded-lg px-2.5 py-3 active:bg-secondary"
          >
            <Ionicons
              name="git-branch-outline"
              size={15}
              color={theme.mutedForeground}
              style={{ marginTop: 2 }}
            />
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-2">
                <Text
                  className="shrink text-body font-medium text-foreground"
                  numberOfLines={1}
                >
                  {workflow.name}
                </Text>
                {workflow.is_default ? (
                  <View className="rounded bg-secondary px-1.5 py-0.5">
                    <Text className="text-caption text-muted-foreground">
                      {t("workflow.project.defaultBadge")}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text className="mt-0.5 text-caption text-muted-foreground">
                {statuses}
                {handoffs > 0 ? ` · ${handoffLabel}` : ""}
              </Text>
              <Text
                className="mt-0.5 text-caption text-muted-foreground"
                numberOfLines={1}
              >
                {usedBy
                  ? t("workflow.project.usedBy", { names: usedBy })
                  : t("workflow.project.usedByNobody")}
              </Text>
            </View>
            {selected ? (
              <Ionicons
                name="checkmark"
                size={18}
                color={theme.primary}
                style={{ marginTop: 2 }}
              />
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}
