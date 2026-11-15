/**
 * The workflow card on the issue detail screen (MYS-2889) — web's
 * `IssueFlowCard` (`packages/views/workflows/issue-flow-card.tsx`), mounted
 * under the issue's Project row (`issue-detail.tsx:3167`).
 *
 * ## What it is for
 *
 * Iterations 288–291 taught the phone one column at a time: which statuses the
 * workflow allows, what each column hands off to, who receives it. This is the
 * missing PANORAMA: the pipeline in order, with the issue's own column marked,
 * so 「后面还有哪些列、每列交给谁」 is one tap away instead of a guess.
 *
 * The row is a `Workflow` chip in the header's attribute row — the same shape
 * web uses (a caption row of `icon + workflow name`), rendered with the chip
 * the rest of this header already uses so it reads as one more property. The
 * body it opens is a bottom sheet, because a phone has no popover to anchor.
 *
 * ## The four states, and why absence is never assumed
 *
 * `lib/workflow-card.ts` decides; this file draws. The one rule that matters
 * here: **`pending` and `failed` do not look like `hidden`.** Upstream's
 * `if (!workflow) return null` is right for a settled popover read and wrong
 * for a client that reads its own cache — a failed read would silently claim
 * "this project runs no workflow". So:
 *
 *   - `hidden` → nothing at all (no project, or a settled read that genuinely
 *     resolved no workflow: an older server);
 *   - `pending` → the row is not drawn yet. A skeleton in the header would
 *     shove every other chip sideways on each issue open, and this row has no
 *     value to hold a place for — unlike the project page's Workflow row, which
 *     is a fixed settings row;
 *   - `failed` → a row that says the workflow could not be loaded and offers a
 *     retry, so the reader learns the pipeline is unknown rather than absent.
 *
 * ## Where it diverges from web, and why
 *
 *   - **A sheet, not a popover.** A phone has no anchor point and no hover. The
 *     sheet is this app's drill-in container.
 *   - **The manage entry point is absent.** Web's card ends with a
 *     「管理工作流」 button into the workflow settings tab. Mobile has no
 *     workflow editor (`apps/mobile` ships no such screen; the project page can
 *     already switch a project's workflow), so the button is omitted rather
 *     than rendered dead.
 *   - **The current column is announced.** Web marks it with `bg-accent` and
 *     `aria-current="step"`. A coloured row is invisible to a screen reader, so
 *     the cell also carries `accessibilityState.selected` plus a spoken
 *     sentence, which is what `aria-current` means for the web reader.
 */
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { AttributeChip } from "@/components/issue/attribute-chip";
import { PickerSheet } from "@/components/issue/pickers/picker-sheet";
import {
  HandoffHintRow,
  useHandoffHintDisplay,
} from "@/components/issue/handoff-hint";
import { useIssueWorkflows } from "@/data/queries/workflows";
import {
  findProject,
  projectListOptions,
} from "@/data/queries/projects";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useStatusLabel } from "@/lib/status-options";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  workflowCardState,
  type WorkflowCard,
  type WorkflowCardProject,
  type WorkflowCardStep,
} from "@/lib/workflow-card";

/**
 * The card's own state, resolved once for both the row and the sheet, so the
 * trigger and the body can never disagree about whether there is a workflow.
 *
 * The projects list is read here rather than passed in: the issue id alone is
 * not enough to name a project's workflow, and the header's own read of that
 * list is a sibling cache entry (`projectListOptions` is the same key, so this
 * is one query, not two).
 */
export function useIssueWorkflowCard(issue: {
  project_id: string | null;
  status: string | null;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { workflows, state, refetch } = useIssueWorkflows(wsId);
  const { data: projects } = useQuery({
    ...projectListOptions(wsId),
    // Only a named project needs its row; an issue outside any project resolves
    // to `hidden` without reading the list at all.
    enabled: !!wsId && !!issue.project_id,
  });

  const project: WorkflowCardProject | undefined =
    issue.project_id != null
      ? findProject(projects ?? [], issue.project_id)
      : undefined;

  return {
    state: workflowCardState({
      workflows,
      state,
      projectId: issue.project_id,
      project,
      currentStatus: issue.status,
    }),
    refetch,
  };
}

/**
 * The `Workflow` row for the issue detail header, or null when there is nothing
 * to say. Sits directly under `AttributeRow`, where web puts it under the
 * Project property.
 */
export function IssueWorkflowCardRow({ issue }: { issue: { project_id: string | null; status: string } }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const { state, refetch } = useIssueWorkflowCard(issue);

  if (state.kind === "hidden" || state.kind === "pending") return null;

  if (state.kind === "failed") {
    // The pipeline is UNKNOWN, not empty. Drawing nothing would assert the
    // project runs no workflow; printing a name would invent one. So the row
    // says what could not be established and offers the retry.
    return (
      <Pressable
        onPress={refetch}
        accessibilityRole="button"
        accessibilityLabel={`${t("workflow.project.label")}: ${t("workflow.detail.unverified")}`}
        className="flex-row items-center gap-1.5 self-start rounded-full border border-dashed border-muted-foreground/30 px-2.5 py-1 active:bg-secondary"
        hitSlop={4}
      >
        <Ionicons
          name="git-branch-outline"
          size={14}
          color={THEME[colorScheme].mutedForeground}
        />
        <Text className="text-caption text-muted-foreground">
          {t("workflow.project.label")}
        </Text>
        <Text className="text-caption text-muted-foreground/70">
          {t("common.retry")}
        </Text>
      </Pressable>
    );
  }

  return <WorkflowCardTrigger card={state.card} />;
}

/** The trigger chip and the sheet it opens, sharing one piece of open state. */
function WorkflowCardTrigger({ card }: { card: WorkflowCard }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { colorScheme } = useColorScheme();

  return (
    <>
      <AttributeChip
        icon={
          <Ionicons
            name="git-branch-outline"
            size={14}
            color={THEME[colorScheme].mutedForeground}
          />
        }
        label={card.workflowName}
        variant="filled"
        onPress={() => setOpen(true)}
        accessibilityLabel={t("workflow.detail.openAria", { name: card.workflowName })}
      />
      <WorkflowCardSheet
        card={card}
        visible={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/**
 * The sheet: the workflow's columns in pipeline order, each with its handoff.
 *
 * Split from the trigger so the rows below can be components of their own —
 * each one resolves an actor name through a hook, and a hook cannot be called
 * from inside a `.map()` whose length follows the workflow's data.
 */
export function WorkflowCardSheet({
  card,
  visible,
  onClose,
}: {
  card: WorkflowCard;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PickerSheet
      title={card.workflowName}
      visible={visible}
      onClose={onClose}
      // `fill` — the body is a scrolling LIST, and `PickerSheet`'s own doc says
      // this mode exists for exactly that: a `flex-1` child inside a
      // content-sized parent resolves to zero height. Both shapes were measured
      // on device this iteration: without `fill` the sheet opened to a title bar
      // and one clipped row; with it, the rows lay out and scroll.
      fill
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-6"
        showsVerticalScrollIndicator={false}
      >
        <Text className="px-4 pb-2 text-caption text-muted-foreground" numberOfLines={2}>
          {t("workflow.detail.card_title", {
            workflow: card.workflowName,
            project: card.projectTitle,
          })}
        </Text>
        <View className="px-2">
          {card.steps.map((step) => (
            <WorkflowCardStepRow key={step.statusKey} step={step} />
          ))}
        </View>
      </ScrollView>
    </PickerSheet>
  );
}

/**
 * One column of the pipeline.
 *
 * The current row is highlighted the way web highlights it (`bg-accent`), and
 * says so to a screen reader through `accessibilityState.selected` plus the
 * `currentAria` sentence — a background colour is not an announcement.
 *
 * The hint goes through `HandoffHintRow`, the SAME component the status picker
 * uses, so a column describes its handoff identically on both surfaces (name,
 * avatar, role-first layout under truncation). `lib/workflow-card.ts` already
 * derived the hint from the gate's own predicate.
 *
 * A row is its own component because `useHandoffHintDisplay` is a hook and the
 * number of columns follows the workflow's data — the same reason the status
 * picker hoists `StatusPickerRow`. It always calls every hook before deciding
 * anything, so a row whose hint is null does not change the hook count.
 */
function WorkflowCardStepRow({ step }: { step: WorkflowCardStep }) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const statusLabel = useStatusLabel(wsId);
  const { entryOf } = useIssueStatuses(wsId);
  const entry = entryOf(step.statusKey);
  const display = useHandoffHintDisplay(step.hint);

  // The row's own label carries everything a screen reader cannot see: the
  // highlight is a background colour, and the hint is an icon plus a name
  // inside a subtree marked `accessibilityElementsHidden` (`HandoffHintRow`
  // deliberately announces nothing twice). Same placement as the picker's rows.
  const rowLabel = [
    statusLabel(step.statusKey),
    step.current ? t("workflow.detail.currentAria") : "",
    display?.sentence ?? "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <View
      className={cn(
        "flex-row items-center gap-2 rounded-md px-2 py-2",
        step.current && "bg-accent",
      )}
      accessible
      accessibilityLabel={rowLabel}
      // Web's `aria-current="step"`. `selected` is the closest thing a phone
      // exposes, and it is what a screen reader announces as "selected".
      accessibilityState={step.current ? { selected: true } : undefined}
    >
      <StatusIcon
        status={step.statusKey}
        category={entry?.category}
        // A custom status brings its own colour; a built-in one is coloured by
        // category, and passing `undefined` is what lets `StatusIcon` do that.
        color={entry && !entry.is_system ? (entry.color ?? undefined) : undefined}
        size={14}
      />
      <Text
        className={cn(
          "min-w-0 flex-1 text-body text-foreground",
          step.current && "font-medium",
        )}
        numberOfLines={1}
      >
        {statusLabel(step.statusKey)}
      </Text>
      <HandoffHintRow display={display} />
    </View>
  );
}
