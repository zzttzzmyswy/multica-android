/**
 * Project properties section. Tappable rows for Status / Priority / Lead /
 * Start date / Due date. Each row opens a picker sheet via the corresponding
 * `onPress*` callback.
 *
 * Layout mirrors iOS Settings rows: label on left, current value on right
 * with a disclosure chevron, full-width separator below each row. Tapping
 * anywhere on the row triggers the picker.
 *
 * Lead supports both member and agent (Project.lead_type), resolved via
 * useActorLookup so it shares the same lookup with my-issues + issue detail.
 *
 * Start/due dates (web project-detail PropRow parity) reuse the issue-side
 * calendar-day convention and DueDatePickerBody; a past due date paints red
 * like web's `highlightOverdue` pill.
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { isPastDateOnly } from "@multica/core/issues/date";
import { formatIssueDate } from "@/lib/format-date";
import type { Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Skeleton } from "@/components/ui/skeleton";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ProjectStatusIcon } from "@/components/ui/project-status-icon";
import { ProjectPriorityIcon } from "@/components/ui/project-priority-icon";
import {
  projectPriorityLabel,
  projectStatusLabel,
} from "@/lib/project-status";
import { useActorLookup } from "@/data/use-actor-name";
import { useIssueWorkflows } from "@/data/queries/workflows";
import { useProjectWorkflowPermissions } from "@/data/use-project-workflow-permissions";
import { useProjectAccessPermissions } from "@/data/use-project-access-permissions";
import { projectVisibilityIsPrivate } from "@/lib/project-access";
import { useWorkspaceStore } from "@/data/workspace-store";
import { handoffStepCount, resolveProjectWorkflow } from "@/lib/workflow";
import { isActorTypeResolved } from "@/lib/actor-name-state";
import { projectLeadCell } from "@/lib/project-inline-edit";
import { useIntlLocale, useTranslation } from "@/lib/i18n/react";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";

interface Props {
  project: Project;
  onPressStatus: () => void;
  onPressPriority: () => void;
  onPressLead: () => void;
  onPressStartDate: () => void;
  onPressDueDate: () => void;
  /** Opens the workflow picker. Omitted by a caller with no such route (there
   *  is only one today); the row then renders read-only. */
  onPressWorkflow?: () => void;
  /** Opens the access sheet (MUL-8472). Omitted by a caller with no such
   *  route; the row then renders read-only. */
  onPressAccess?: () => void;
}

export function ProjectPropertiesSection({
  project,
  onPressStatus,
  onPressPriority,
  onPressLead,
  onPressStartDate,
  onPressDueDate,
  onPressWorkflow,
  onPressAccess,
}: Props) {
  const { t } = useTranslation();
  const intlLocale = useIntlLocale();
  const { getName, resolvedBy } = useActorLookup();
  // The lead is printed as a property value, so it is an ASSERTION and goes
  // through the same tested decision the projects list's lead column uses
  // (`projectLeadCell`, iteration 253) rather than a bare `getName` — which
  // answers 「Unknown」 both while the directory is in flight and when the lead
  // is genuinely gone (MYS-2227).
  //
  // Readiness is taken for the lead's OWN type, not the combined flag: a
  // `lead_type` of "member" has nothing to learn from the agent directory, and
  // waiting on both would keep the row pending for a read it cannot use.
  const leadCell = projectLeadCell({
    leadType: project.lead_type,
    leadId: project.lead_id,
    catalogsResolved: isActorTypeResolved(resolvedBy, project.lead_type),
    resolveName: getName,
  });
  const leadName = leadCell.kind === "none" ? null : leadCell;
  const leadKnown = leadCell.kind === "name";

  return (
    <View className="mx-4 overflow-hidden rounded-2xl border border-border bg-background">
      <View className="px-4 py-3 bg-secondary/30 border-b border-border">
        <Text accessibilityRole="header" className="text-label font-semibold text-muted-foreground">
          {t("project.propertiesTitle")}
        </Text>
      </View>
      <Row
        label={t("picker.status")}
        onPress={onPressStatus}
        left={<ProjectStatusIcon status={project.status} size={16} />}
        right={
          <Text className="text-body text-foreground">
            {projectStatusLabel(project.status)}
          </Text>
        }
      />
      <Separator />
      <Row
        label={t("picker.priority")}
        onPress={onPressPriority}
        left={<ProjectPriorityIcon priority={project.priority} size={16} />}
        right={
          <Text className="text-body text-foreground">
            {projectPriorityLabel(project.priority)}
          </Text>
        }
      />
      <Separator />
      <Row
        label={t("picker.lead")}
        onPress={onPressLead}
        left={
          leadName ? (
            <ActorAvatar
              type={project.lead_type}
              id={project.lead_id}
              size={20}
              showPresence
            />
          ) : (
            <PlaceholderAvatar />
          )
        }
        right={
          /* Three states, three renderings. `pending` draws the load mark
           * where the name goes — the row keeps its shape and claims nothing;
           * `none` keeps 「未指派」, which is a measurement of the project's own
           * `lead_id` field and stays true even mid-read. The AVATAR follows
           * `none` alone: a lead the client cannot name yet still has a face
           * to load, and swapping it for the placeholder would claim there is
           * no lead. */
          leadCell.kind === "pending" ? (
            <Skeleton
              className="h-3.5 w-16"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          ) : (
            <Text
              className={
                leadKnown
                  ? "text-body text-foreground"
                  : "text-body text-muted-foreground"
              }
            >
              {leadKnown ? leadCell.name : t("picker.unassigned")}
            </Text>
          )
        }
      />
      <Separator />
      <WorkflowRow project={project} onPress={onPressWorkflow} />
      <Separator />
      <AccessRow project={project} onPress={onPressAccess} />
      <Separator />
      <DateRow
        label={t("projects.detail.startDate")}
        value={project.start_date}
        emptyLabel={t("projects.detail.noStartDate")}
        onPress={onPressStartDate}
      />
      <Separator />
      <DateRow
        label={t("projects.detail.dueDate")}
        value={project.due_date}
        emptyLabel={t("projects.detail.noDueDate")}
        highlightOverdue
        onPress={onPressDueDate}
      />
    </View>
  );
}

/**
 * The project's Workflow property (MUL-7420, MYS-2690) — web's
 * `ProjectWorkflowPropRow` (`packages/views/projects/components/project-detail.tsx:104`).
 *
 * Web renders this row for EVERYONE and only lets admins/leads change it; a
 * plain member sees the name as text. Mobile keeps that split and expresses it
 * the way a touch UI must: the row stays visible (the fact "this project runs
 * Content" is not privileged), but a member without the permission gets a
 * non-pressable row with no chevron, so it does not invite a tap that can only
 * end in a 403.
 *
 * ## The three states the value can be in, and why they must not collapse
 *
 *   - the read is still in flight → the name slot draws a skeleton. Printing
 *     「Default」 here would be an assertion the client cannot yet make, and it
 *     is the specific wrong answer most of the time (a project on a named
 *     workflow would flash Default first).
 *   - the read FAILED → 「—」 plus the unverified sentence as a subtitle. The
 *     `workflows` hook distinguishes this from "no workflows"; folding the two
 *     would claim the project uses Default when nobody knows.
 *   - resolved → the workflow's own name, or 「Default」 for the workspace
 *     Default (which is also what a project naming a deleted workflow gets —
 *     `resolveProjectWorkflow` treats a dangling id as Default, as the server
 *     does).
 *
 * The handoff count rides in the subtitle rather than beside the name: this
 * row's value column is narrow on a phone, and a sibling summary takes width
 * from the one word that matters. Same call web made for its sidebar row
 * (MUL-8119, `project-workflow-row.tsx:171`).
 */
function WorkflowRow({
  project,
  onPress,
}: {
  project: Project;
  onPress?: () => void;
}) {
  const palette = useThemePalette();
  const { t } = useTranslation();
  const { workflows, state } = useIssueWorkflows(useWorkspaceStore((s) => s.currentWorkspaceId));
  const { canManageProject, roleResolved } = useProjectWorkflowPermissions(project);
  const current = resolveProjectWorkflow(workflows, project);

  const pending = state === "pending" && !workflows;
  const failed = state === "failed";

  // No permission, no route, or an unresolved read → not pressable. The
  // permission half is `canManageProject`, which mirrors the server; the
  // affordance only ever SHOWS the write, it never substitutes for the gate.
  const pressable = !!onPress && canManageProject && !pending && !failed;

  const handoffs = current ? handoffStepCount(current) : 0;
  const subtitle = current
    ? [
        t(
          current.steps.length === 1
            ? "workflow.project.statuses_one"
            : "workflow.project.statuses_other",
          { count: current.steps.length },
        ),
        handoffs > 0
          ? t(
              handoffs === 1
                ? "workflow.project.handoffs_one"
                : "workflow.project.handoffs_other",
              { count: handoffs },
            )
          : t("workflow.project.noHandoffs"),
      ].join(" · ")
    : null;

  const body = (
    <>
      <Text className="w-20 text-body text-muted-foreground">
        {t("workflow.project.label")}
      </Text>
      <Ionicons
        name="git-branch-outline"
        size={15}
        color={palette.mutedForeground}
      />
      <View className="min-w-0 flex-1">
        {pending ? (
          <Skeleton
            className="h-3.5 w-20"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : (
          <Text
            className={
              failed || !current
                ? "text-body text-muted-foreground"
                : "text-body text-foreground"
            }
            numberOfLines={1}
          >
            {failed || !current ? "—" : current.name}
          </Text>
        )}
        {subtitle && !failed ? (
          <Text className="mt-0.5 text-caption text-muted-foreground" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {failed ? (
          <Text className="mt-0.5 text-caption text-muted-foreground" numberOfLines={2}>
            {t("workflow.project.unverified")}
          </Text>
        ) : null}
        {/* A member without the permission sees the fact but not a tap that can
            only end in a 403. Saying WHY is what keeps the missing chevron from
            reading as a rendering bug — the same reason web's read-only branch
            keeps the row (project-workflow-row.tsx:157). */}
        {!failed && !!onPress && !canManageProject && roleResolved ? (
          <Text className="mt-0.5 text-caption text-muted-foreground" numberOfLines={2}>
            {t("workflow.project.readOnly")}
          </Text>
        ) : null}
      </View>
    </>
  );

  if (!pressable) {
    return (
      <View
        className="flex-row items-center gap-3 px-4 py-3"
        accessibilityRole="text"
        accessibilityLabel={`${t("workflow.project.label")}: ${
          failed || !current ? t("workflow.project.unverified") : current.name
        }`}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("workflow.project.pickerTitle")}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
    >
      {body}
      <Chevron />
    </Pressable>
  );
}

/**
 * The project's Access property (MUL-8472, MYS-2915) — web's
 * `ProjectAccessControl` trigger (`project-access.tsx:118-121`).
 *
 * Web renders this in the detail sidebar's property list, and so does mobile:
 * "who can see this" is a property of the project in exactly the sense status
 * and lead are, and it belongs beside them rather than behind the "…" menu.
 *
 * The row is a READ for everyone and a WRITE only for those the server would
 * accept (`canManageProjectAccess`) — the row stays visible either way, because
 * the fact that a project is private is not privileged, but a tap that can only
 * end in a 403 must not be offered. That mirrors the workflow row above and
 * web's own split (`canChangeScope` disables the radios without hiding them).
 *
 * Until the role read answers, the value still renders: the visibility itself
 * comes from the project row and is always known.
 */
function AccessRow({
  project,
  onPress,
}: {
  project: Project;
  onPress?: () => void;
}) {
  const palette = useThemePalette();
  const { t } = useTranslation();
  const isPrivate = projectVisibilityIsPrivate(project);
  const { canManageProject, roleResolved } = useProjectAccessPermissions(project);
  const pressable = !!onPress;

  const body = (
    <>
      <Text className="w-20 text-body text-muted-foreground">
        {t("projects.access.label")}
      </Text>
      <Ionicons
        name={isPrivate ? "lock-closed-outline" : "globe-outline"}
        size={15}
        color={palette.mutedForeground}
      />
      <View className="min-w-0 flex-1">
        <Text className="text-body text-foreground" numberOfLines={1}>
          {isPrivate
            ? t("projects.access.private")
            : t("projects.access.workspace")}
        </Text>
        {/* A member who may not change it is told who can, for the same reason
            the workflow row says it: the missing affordance is otherwise
            indistinguishable from a rendering bug. */}
        {pressable && roleResolved && !canManageProject ? (
          <Text
            className="mt-0.5 text-caption text-muted-foreground"
            numberOfLines={2}
          >
            {t("projects.access.read_only")}
          </Text>
        ) : null}
      </View>
    </>
  );

  if (!pressable) {
    return (
      <View
        className="flex-row items-center gap-3 px-4 py-3"
        accessibilityRole="text"
        accessibilityLabel={`${t("projects.access.label")}: ${
          isPrivate ? t("projects.access.private") : t("projects.access.workspace")
        }`}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("projects.access.label")}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
    >
      {body}
      <Chevron />
    </Pressable>
  );
}

function DateRow({
  label,
  value,
  emptyLabel,
  highlightOverdue = false,
  onPress,
}: {
  label: string;
  value: string | null;
  emptyLabel: string;
  highlightOverdue?: boolean;
  onPress: () => void;
}) {
  const palette = useThemePalette();
  const intlLocale = useIntlLocale();
  const overdue = highlightOverdue && !!value && isPastDateOnly(value);
  const display = value
    ? formatIssueDate(
        value,
        { year: "numeric", month: "short", day: "numeric" },
        intlLocale,
      )
    : "";
  return (
    <Row
      label={label}
      onPress={onPress}
      left={
        <Ionicons
          name="calendar-outline"
          size={15}
          color={palette.mutedForeground}
        />
      }
      right={
        <Text
          className={
            !value
              ? "text-body text-muted-foreground"
              : overdue
                ? "text-body text-destructive"
                : "text-body text-foreground"
          }
        >
          {value ? display : emptyLabel}
        </Text>
      }
    />
  );
}

function Row({
  label,
  onPress,
  left,
  right,
}: {
  label: string;
  onPress: () => void;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-12 flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
    >
      <Text className="text-label text-muted-foreground w-20">{label}</Text>
      <View className="min-w-0 flex-row items-center gap-2 flex-1">
        {left}
        <View className="min-w-0 flex-1">{right}</View>
      </View>
      <Chevron />
    </Pressable>
  );
}

function Separator() {
  return <View className="h-px bg-border ml-4" />;
}

function Chevron() {
  const palette = useThemePalette();
  return (
    <Ionicons
      name="chevron-forward"
      size={14}
      color={palette.mutedForeground}
    />
  );
}

function PlaceholderAvatar() {
  return (
    <View
      style={{ width: 20, height: 20, borderRadius: 10 }}
      className="border border-dashed border-muted-foreground/40"
    />
  );
}
