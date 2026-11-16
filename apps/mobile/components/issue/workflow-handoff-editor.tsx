/**
 * The handoff editor sheet — web `WorkflowHandoffForm`
 * (`packages/views/workflows/handoff-form.tsx`, MUL-7420) as a phone sheet
 * (MYS-2889 follow-up).
 *
 * ## Why this exists
 *
 * Iterations 288–292 taught the phone to READ the pipeline: which statuses a
 * project allows, what each column hands the issue to, who receives it, and the
 * whole flow at a glance. Editing was the missing half — `setWorkflowHandoff`
 * had no call site anywhere in `apps/mobile`, so 「每列交给谁」 could be seen and
 * never changed. Web edits it from the board column's badge and from the
 * project's flow sheet; on the phone there was no entry at all.
 *
 * ## What it mirrors, point by point
 *
 * | Web (`handoff-form.tsx`) | Here |
 * |---|---|
 * | three 「交给」 modes, radio rows with hints | `HandoffMode` rows (`handoffModeOf`) |
 * | a picker for the agent/squad or the member | `HandlerPickerRows` (same directories) |
 * | instructions textarea, agent/squad only | the same, gated on the mode |
 * | next / back status selectors with a computed default | `handoffTargetStatusKeys`, `handoffDefaultNextStatus` |
 * | 「预览说明」 → server-rendered brief | `BriefPreviewSheet` |
 * | scope question when a shared workflow is edited | `handoffAsksSaveScope` |
 * | Save disabled while half-made or unchanged | `handoffNeedsTarget`, `isHandoffDirty` |
 * | read-only sentence naming who CAN edit | `workflow.handoff.readOnly` |
 *
 * ## Where it must differ, and why
 *
 *   - **A sheet, not a popover.** A phone has no anchor and no hover; this is
 *     the container every other drill-in in the app uses.
 *   - **The three modes are a radio LIST, not a bordered card per mode.** Web's
 *     cards hold their own nested picker on a 26rem popover. At phone width the
 *     nesting doubles the scroll distance, so the nested picker opens its own
 *     small sheet instead — same two-step choice, one level at a time.
 *   - **Save lives in the sheet's footer, always reachable.** Web's Save sits at
 *     the end of a short popover; this form scrolls, and a Save button below the
 *     fold on a form with unsaved changes is how users lose work.
 *   - **The scope question is inline, above the footer.** It changes what Save
 *     will do, so it has to be visible at the moment of pressing, not behind a
 *     second dialog.
 *
 * ## The one thing that must not regress
 *
 * **A failed write must not look saved.** The sheet stays open on failure, the
 * failure is reported through the shared channel with this write's own title
 * (`data/mutations/workflow-handoff.ts`), and the draft is kept so the user can
 * retry. Closing optimistically is the failure mode worth naming because the
 * sheet would then be indistinguishable from a successful save.
 */
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueWorkflow, Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Skeleton } from "@/components/ui/skeleton";
import { HandoffFields } from "@/components/workflow/handoff-fields";
import { useQuery } from "@tanstack/react-query";
import { projectListOptions } from "@/data/queries/projects";
import { useSetWorkflowHandoff } from "@/data/mutations/workflow-handoff";
import { useWorkflowEditPermissions } from "@/data/use-workflow-edit-permissions";
import { useWorkspaceStore } from "@/data/workspace-store";
import { api } from "@/data/api";
import { useStatusLabel } from "@/lib/status-options";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  handoffAsksSaveScope,
  handoffDefaultNextStatus,
  handoffNeedsTarget,
  handoffSharingProjects,
  handoffTargetStatusKeys,
  initialHandoffDraft,
  isHandoffDirty,
  savedHandoff,
  type HandoffDraft,
  type HandoffSaveScope,
} from "@/lib/workflow-handoff-edit";

export interface WorkflowHandoffEditorProps {
  /** The workflow being edited; the sheet is closed when null. */
  workflow: IssueWorkflow | null;
  /** The column being edited. */
  statusKey: string;
  /** The project the editor was opened from — scopes the copy and the brief. */
  project?: Pick<Project, "id" | "title"> | null;
  visible: boolean;
  onClose: () => void;
}

export function WorkflowHandoffEditor({
  workflow,
  statusKey,
  project,
  visible,
  onClose,
}: WorkflowHandoffEditorProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const statusLabel = useStatusLabel(wsId);
  const { canEdit, roleResolved } = useWorkflowEditPermissions(workflow);
  const save = useSetWorkflowHandoff();
  const { data: projects } = useQuery(projectListOptions(wsId));

  const savedDraft = useMemo<HandoffDraft>(
    () => initialHandoffDraft(workflow?.steps ?? [], statusKey),
    [workflow?.steps, statusKey],
  );
  const [draft, setDraft] = useState<HandoffDraft>(savedDraft);
  const [scope, setScope] = useState<HandoffSaveScope>("all");
  const [previewOpen, setPreviewOpen] = useState(false);

  // Re-seed when the sheet opens on a different column, or when the saved row
  // changes under it (someone else edited the workflow and the read refreshed).
  // Keyed on the saved value rather than on `visible`, so reopening the sheet on
  // the same column keeps an abandoned draft — which is what a user who
  // dismissed the sheet by accident expects.
  useEffect(() => {
    setDraft(savedDraft);
  }, [savedDraft]);

  const dirty = isHandoffDirty(draft, savedDraft);
  const needsTarget = handoffNeedsTarget(draft.handler);

  // The scope question's inputs. `others` is computed from the workflow's own
  // `project_ids` intersected with the caller's project list, and projects the
  // list does not know are DROPPED rather than counted — see
  // `handoffSharingProjects`.
  const sharing = useMemo(
    () =>
      handoffSharingProjects({
        projectIds: workflow?.project_ids ?? [],
        projectId: project?.id,
        projects: projects ?? [],
      }),
    [workflow?.project_ids, project?.id, projects],
  );
  const askScope = handoffAsksSaveScope({
    canEdit,
    canCopyForProject: !!project,
    dirty,
    hasProject: !!project,
    isDefaultWorkflow: !!workflow?.is_default,
    otherProjectCount: sharing.others.length,
  });

  // A collapsed scope answer when the question is no longer asked, so a draft
  // that becomes clean (the user undid their edit) cannot leave "only this
  // project" selected and silently copy a workflow on the next save.
  useEffect(() => {
    if (!askScope) setScope("all");
  }, [askScope]);

  if (!workflow) return null;

  const statusText = statusLabel(statusKey);
  const nextDefaultKey = handoffDefaultNextStatus(workflow.steps, statusKey);
  const nextDefaultLabel = nextDefaultKey ? statusLabel(nextDefaultKey) : "";
  const targetKeys = handoffTargetStatusKeys(workflow.steps, statusKey);

  /**
   * Saves, and closes ONLY once the server has accepted.
   *
   * `mutateAsync` rather than `mutate` on purpose. Closing on `mutate` would
   * make a refused save indistinguishable from a successful one: the sheet
   * would be gone, the card would still show the old handoff, and the shared
   * failure alert would be the only trace. That matters here more than on a
   * picker route, because this write is admin- or owner-only — a 403 is an
   * expected answer, not an exceptional one.
   *
   * On failure the sheet stays open with the draft intact so the user can
   * correct it or retry. The failure sentence is raised by the mutation's own
   * `meta` through the shared channel, so this catch deliberately says nothing
   * more — a second alert for one failure is noise.
   */
  const submit = async () => {
    const out = savedHandoff(draft);
    try {
      await save.mutateAsync({
        workflowId: workflow.id,
        statusKey,
        handler: out.handler,
        instructions: out.instructions,
        next_status_key: out.next_status_key,
        back_status_key: out.back_status_key,
        copyForProjectId: askScope && scope === "project" ? project?.id : undefined,
      });
      onClose();
    } catch {
      // Reported by the shared channel; the sheet stays open by design.
    }
  };

  const scopeLine =
    sharing.others.length > 0
      ? t("workflow.handoff.scopeLineShared", {
          workflow: workflow.name,
          projects: sharingLabel(sharing, t),
        })
      : t("workflow.handoff.scopeLine", { workflow: workflow.name });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-end">
          <Pressable onPress={() => {}} className="rounded-t-2xl bg-popover" style={{ maxHeight: "88%" }}>
            {/* Header */}
            <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
              <Text className="flex-1 text-title-sm font-semibold text-foreground" numberOfLines={2}>
                {t("workflow.handoff.title", { status: statusText })}
              </Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={t("common.close")}>
                <Ionicons name="close" size={20} color={theme.foreground} />
              </Pressable>
            </View>

            <ScrollView
              className="flex-shrink"
              contentContainerClassName="pb-4"
              showsVerticalScrollIndicator={false}
            >
              {/* Which workflow, and who else it reaches — web's scope_line. */}
              <View className="flex-row items-start gap-1.5 px-4 pt-3">
                <Ionicons
                  name="git-branch-outline"
                  size={13}
                  color={theme.mutedForeground}
                  style={{ marginTop: 2 }}
                />
                <Text className="flex-1 text-caption text-muted-foreground">{scopeLine}</Text>
              </View>

              <View className="gap-4 px-4 pt-4">
                {/* The fields themselves are shared with the workflow editor
                    (iteration 294) — one implementation of 「交给谁 / 说明 /
                    完成时移到」, two call sites, exactly as upstream has it
                    (`handoff-form.tsx`'s `HandoffFields`). The status list they
                    offer is this sheet's own: the workflow's SAVED columns,
                    because a save here writes one column on its own. */}
                <HandoffFields
                  draft={draft}
                  canEdit={canEdit}
                  targetKeys={targetKeys}
                  defaultNextLabel={nextDefaultLabel}
                  onPreview={() => setPreviewOpen(true)}
                  onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
                />

                {/* ── Where the change applies ────────────────────────── */}
                {askScope && project ? (
                  <View className="gap-1.5 rounded-lg border border-border bg-muted/40 p-2.5">
                    <Text className="px-1 pb-1 text-caption font-medium text-muted-foreground">
                      {t("workflow.handoff.scopeQuestion")}
                    </Text>
                    <ScopeRow
                      selected={scope === "all"}
                      onPress={() => setScope("all")}
                      title={t("workflow.handoff.scopeAll", {
                        workflow: workflow.name,
                        count: sharing.others.length + 1,
                      })}
                      hint={t("workflow.handoff.scopeAllHint", {
                        projects: [project.title, sharingLabel(sharing, t)].filter(Boolean).join(t("workflow.listSeparator")),
                      })}
                    />
                    <ScopeRow
                      selected={scope === "project"}
                      onPress={() => setScope("project")}
                      title={t("workflow.handoff.scopeProject", { project: project.title })}
                      hint={t("workflow.handoff.scopeProjectHint", {
                        copy: `${workflow.name} (${project.title})`,
                        project: project.title,
                      })}
                    />
                  </View>
                ) : null}

                {!canEdit && roleResolved ? (
                  <Text className="text-caption text-muted-foreground">
                    {t("workflow.handoff.readOnly")}
                  </Text>
                ) : null}
              </View>
            </ScrollView>

            {/* ── Footer: the save decision, always visible ────────────── */}
            {canEdit ? (
              <View className="flex-row items-center justify-end gap-2 border-t border-border px-4 py-3">
                {dirty ? (
                  <Pressable
                    onPress={() => setDraft(savedDraft)}
                    hitSlop={6}
                    accessibilityRole="button"
                    className="rounded-md px-3 py-2 active:bg-secondary"
                  >
                    <Text className="text-body text-muted-foreground">
                      {t("workflow.handoff.cancel")}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => void submit()}
                  disabled={!dirty || needsTarget || save.isPending}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !dirty || needsTarget || save.isPending }}
                  className={cn(
                    "rounded-md px-4 py-2",
                    !dirty || needsTarget || save.isPending
                      ? "bg-muted"
                      : "bg-primary active:bg-primary/90",
                  )}
                >
                  <Text
                    className={cn(
                      "text-body font-medium",
                      !dirty || needsTarget || save.isPending
                        ? "text-muted-foreground"
                        : "text-primary-foreground",
                    )}
                  >
                    {t("workflow.handoff.save")}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        </View>
      </Pressable>

      <BriefPreviewSheet
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        workflowId={workflow.id}
        projectId={project?.id}
        statusKey={statusKey}
        statusText={statusText}
        draft={draft}
      />
    </Modal>
  );
}

/** One scope answer. */
function ScopeRow({
  selected,
  onPress,
  title,
  hint,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  hint: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className={cn(
        "flex-row items-start gap-2.5 rounded-md px-2 py-1.5",
        selected ? "bg-background" : "active:bg-accent/60",
      )}
    >
      <View
        className={cn(
          "mt-0.5 size-4 items-center justify-center rounded-full border",
          selected ? "border-brand" : "border-input",
        )}
      >
        {selected ? <View className="size-2 rounded-full bg-brand" /> : null}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-body font-medium text-foreground">{title}</Text>
        <Text className="text-caption text-muted-foreground">{hint}</Text>
      </View>
    </Pressable>
  );
}

/** The 「A、B、C 以及另外 N 个」 label, or "" when nothing else uses it. */
function sharingLabel(
  sharing: ReturnType<typeof handoffSharingProjects>,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (sharing.others.length === 0) return "";
  const names = sharing.shown.map((p) => p.title).join(t("workflow.listSeparator"));
  return sharing.more > 0
    ? t("workflow.handoff.scopeMore", { names, count: sharing.more })
    : names;
}

/**
 * The brief a column's handler would receive, rendered by the server from the
 * UNSAVED draft — web's `BriefPreviewDialog` (`handoff-form.tsx:660`).
 *
 * ## Three states, and why the failure is not an empty brief
 *
 * `previewWorkflowBrief` rejects on a failed request, and `useQuery` therefore
 * goes to `error`. Printing an empty block there would say 「这位负责人不会收到
 * 说明」 about a brief nobody managed to render — the read-failure-as-absence
 * defect this repo has fixed repeatedly. So `error` gets its own sentence and a
 * retry, and only a SUCCESSFUL read whose body is empty gets the "nothing extra"
 * line.
 */
function BriefPreviewSheet({
  visible,
  onClose,
  workflowId,
  projectId,
  statusKey,
  statusText,
  draft,
}: {
  visible: boolean;
  onClose: () => void;
  workflowId: string;
  projectId: string | undefined;
  statusKey: string;
  statusText: string;
  draft: HandoffDraft;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const query = useQuery({
    // The draft is part of the key: two different drafts for one column are two
    // different briefs, and reusing the first answer would show a preview of
    // text the user has since deleted.
    queryKey: [
      "issue-workflows",
      wsId,
      "brief-preview",
      workflowId,
      projectId ?? "",
      statusKey,
      draft.handler.type,
      draft.handler.id ?? "",
      draft.instructions,
      draft.next_status_key ?? "",
      draft.back_status_key ?? "",
    ] as const,
    queryFn: ({ signal }) =>
      api.previewWorkflowBrief(
        workflowId,
        {
          status_key: statusKey,
          ...(projectId ? { project_id: projectId } : {}),
          handler: draft.handler,
          instructions: draft.instructions,
          next_status_key: draft.next_status_key,
          back_status_key: draft.back_status_key,
        },
        { signal },
      ),
    enabled: visible,
    // The server renders from the draft the client holds, so the answer cannot
    // go stale on its own — but it is cheap and only read while open.
    staleTime: 30_000,
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-end">
          <Pressable onPress={() => {}} className="max-h-[80%] rounded-t-2xl bg-popover">
            <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
              <Text className="flex-1 text-title-sm font-semibold text-foreground">
                {t("workflow.handoff.previewTitle", { status: statusText })}
              </Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={t("common.close")}>
                <Ionicons name="close" size={20} color={theme.foreground} />
              </Pressable>
            </View>
            <ScrollView contentContainerClassName="px-4 py-3 pb-6">
              <Text className="pb-3 text-caption text-muted-foreground">
                {t("workflow.handoff.previewDescription")}
              </Text>
              <View className="rounded-lg border border-border bg-muted/40 p-3">
                {query.isPending ? (
                  <View className="gap-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                    <Skeleton className="h-3 w-3/5" />
                  </View>
                ) : query.isError ? (
                  <View className="gap-2">
                    <Text className="text-caption text-destructive">
                      {t("workflow.handoff.briefFailed")}
                    </Text>
                    <Pressable
                      onPress={() => void query.refetch()}
                      accessibilityRole="button"
                      className="self-start rounded-md border border-border px-3 py-1.5 active:bg-secondary"
                    >
                      <Text className="text-caption text-foreground">{t("common.retry")}</Text>
                    </Pressable>
                  </View>
                ) : query.data ? (
                  <Text className="font-mono text-caption leading-5 text-foreground">
                    {query.data}
                  </Text>
                ) : (
                  <Text className="text-caption text-muted-foreground">
                    {t("workflow.handoff.briefEmpty")}
                  </Text>
                )}
              </View>
            </ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
