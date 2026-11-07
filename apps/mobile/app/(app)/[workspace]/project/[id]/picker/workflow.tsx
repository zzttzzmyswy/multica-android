/**
 * Project workflow picker route (MUL-7420, MYS-2690).
 *
 * Owns the whole switch: choose → dry run → confirm (mapping if needed) →
 * write. Presented as a `formSheet` by the parent Stack, like every other
 * project property picker, and self-contained for the same reason those are:
 * it reads the project and workflows from cache and needs nothing from the
 * screen that pushed it.
 *
 * ## Why the dry run sits between choose and confirm
 *
 * The switch can move issues, and the server will not do it blind: a status the
 * target workflow lacks has to be mapped, and a write that omits the mapping
 * earns `409 workflow_status_mapping_required`. The dry run is what turns that
 * refusal into a question asked BEFORE the user commits — which statuses are
 * affected, how many issues each holds, and where they could go. Web does the
 * same thing in the same order (`useProjectWorkflowSwitch`,
 * `project-workflow-row.tsx:47-63`).
 *
 * So the sequence here is deliberately three-phase:
 *
 *   choose   → `dryRunProjectWorkflow` (writes nothing)      → spinner on row
 *   preview  → mapping dialog, pre-filled from the plan      → confirm
 *   write    → `setProjectWorkflow`                          → dismiss
 *
 * ## Two failures, two different answers
 *
 *   - the DRY RUN failed → nothing was written. Say so and leave the sheet
 *     open: the user can retry the tap. (A silent dismiss here would look like
 *     success.)
 *   - the WRITE was refused for a stale plan → the server sent a new plan. Re-
 *     open the dialog from it with `stalePlan` above the rows, so the user
 *     corrects the mapping instead of reading an agent-facing sentence.
 *
 * Every other write failure goes to the shared channel, which is why the
 * mutation's per-call `onError` is the only place that reports here.
 */
import { useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { IssueWorkflow, IssueWorkflowMappingPlan } from "@multica/core/types";
import { PickerBodyShell } from "@/components/pickers/picker-body-shell";
import { WorkflowPickerBody } from "@/components/project/workflow-picker-body";
import { WorkflowMappingDialog } from "@/components/project/workflow-mapping-dialog";
import { Text } from "@/components/ui/text";
import { api } from "@/data/api";
import { projectDetailOptions, projectListOptions } from "@/data/queries/projects";
import { useIssueWorkflows } from "@/data/queries/workflows";
import { useSetProjectWorkflow } from "@/data/mutations/project-workflow";
import { useWorkspaceStore } from "@/data/workspace-store";
import { usePickerSearch } from "@/lib/use-picker-search";
import { useTranslation } from "@/lib/i18n/react";
import {
  projectWorkflowChoiceChanges,
  projectWorkflowIdFor,
  statusMappingPayload,
} from "@/lib/project-workflow";
import { projectWorkflowWriteRefusal } from "@/lib/workflow-mapping-refusal";
import { resolveProjectWorkflow } from "@/lib/workflow";

interface PendingSwitch {
  workflowId: string | null;
  workflowName: string;
  plan: IssueWorkflowMappingPlan;
  targetKeys: string[];
  /** Set when this dialog was re-opened from a 409 rather than a fresh dry
   *  run — the copy above the rows says the preview went stale. */
  fromRefusal: boolean;
}

export default function ProjectWorkflowPickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: project } = useQuery(projectDetailOptions(wsId, id));
  const { data: projects } = useQuery(projectListOptions(wsId));
  const { workflows, state, refetch: refetchWorkflows } = useIssueWorkflows(wsId);
  const setWorkflow = useSetProjectWorkflow(id);
  const search = usePickerSearch(t("workflow.project.pickerTitle"));

  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);

  const current = resolveProjectWorkflow(workflows, project);

  const choose = async (workflow: IssueWorkflow) => {
    if (!project) return;
    // Re-picking what is already in use is a no-op. Without this, the sheet
    // would run a dry run, show a dialog that moves nothing, and write the
    // same value back (`project-workflow-row.tsx:57`).
    if (!projectWorkflowChoiceChanges({ project, workflow })) {
      router.back();
      return;
    }
    const workflowId = projectWorkflowIdFor(workflow);
    setCheckFailed(false);
    setChecking(true);
    try {
      const { plan } = await api.dryRunProjectWorkflow(project.id, workflowId);
      // The filter is what the route always does next: hold the plan and let
      // the dialog decide whether the user has anything to choose.
      setPending({
        workflowId,
        workflowName: workflow.name,
        plan,
        targetKeys: workflow.steps.map((step) => step.status_key),
        fromRefusal: false,
      });
    } catch {
      // Nothing was written. Keep the sheet open so the tap can be retried —
      // dismissing here would be indistinguishable from a successful switch.
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  };

  const confirm = (mapping: Record<string, string>) => {
    if (!pending) return;
    setWorkflow.mutate(
      {
        projectId: id,
        workflow_id: pending.workflowId,
        status_mapping: statusMappingPayload(pending.plan, mapping),
      },
      {
        onSuccess: () => {
          setPending(null);
          router.back();
        },
        onError: (error) => {
          // A stale plan is a QUESTION, not a failure: the server sent the plan
          // it now wants. Re-open the dialog with it so the user can answer.
          const refusal = projectWorkflowWriteRefusal(error);
          if (refusal) {
            setPending({
              workflowId: pending.workflowId,
              workflowName: pending.workflowName,
              plan: refusal.plan,
              targetKeys: pending.targetKeys,
              fromRefusal: true,
            });
            return;
          }
          // The hook took this write off the shared failure channel
          // (`WRITE_FAILURE_HANDLED_KEY`), so every remaining failure has to be
          // reported HERE — a 403 for a member who lost the lead role, a
          // network drop, a 500. Silence would be indistinguishable from a
          // successful switch, which is the one outcome this must never fake.
          setPending(null);
          Alert.alert(
            t("workflow.project.switchFailed"),
            error instanceof Error && error.message.trim()
              ? error.message
              : undefined,
          );
          router.back();
        },
      },
    );
  };

  return (
    <PickerBodyShell search={search} title={t("workflow.project.pickerTitle")}>
      {checking ? (
        <View
          className="flex-row items-center gap-2 px-4 py-2"
          accessibilityRole="progressbar"
        >
          <ActivityIndicator size="small" />
          <Text className="text-caption text-muted-foreground">
            {t("workflow.project.checking")}
          </Text>
        </View>
      ) : null}
      {checkFailed ? (
        <View
          accessibilityRole="alert"
          className="mx-4 mt-1 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2"
        >
          <Text className="text-caption text-foreground">
            {t("workflow.project.checkFailed")}
          </Text>
        </View>
      ) : null}
      <WorkflowPickerBody
        workflows={workflows}
        state={state}
        projects={projects}
        currentWorkflowId={current?.id ?? null}
        onChoose={(workflow) => {
          // While a dry run or the write is in flight, a second tap would start
          // a competing switch on the same project.
          if (checking || setWorkflow.isPending) return;
          void choose(workflow);
        }}
        onRetry={() => {
          void refetchWorkflows();
        }}
      />
      <WorkflowMappingDialog
        pending={
          pending
            ? {
                workflowName: pending.workflowName,
                projectName: project?.title ?? "",
                plan: pending.plan,
                targetKeys: pending.targetKeys,
              }
            : null
        }
        staleNotice={pending?.fromRefusal ?? false}
        submitting={setWorkflow.isPending}
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      />
    </PickerBodyShell>
  );
}
