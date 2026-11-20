/**
 * Shared issue row used by every list-style issue surface on mobile —
 * (tabs)/my-issues, more/issues (workspace-wide), and project detail's
 * related-issues bucket.
 *
 * Web uses one desktop-width line. Mobile gives the title its own line(s)
 * and wraps the metadata under it without changing the fields or actions.
 *
 * `showStatus` is opt-in because the my-issues SectionList already groups
 * by status (rendering it again per-row would be visual noise). The
 * project-related-issues view doesn't section by status, so it asks for
 * the inline status icon. New callers should default to false unless they
 * mix multiple statuses inside a single ungrouped list.
 *
 * Behavioral parity:
 *   - Same `Issue` type, same `assignee_type`/`assignee_id` semantics
 *     (root CLAUDE.md "Data identity must agree").
 *   - Mirrors web `packages/views/issues/components/list-row.tsx:52`:
 *     render the assignee whenever `assignee_type && assignee_id` are both
 *     truthy — `ActorAvatar` itself handles member / agent / squad rendering
 *     (rounded square + people glyph or `squad.avatar_url` for squads). A
 *     future fourth enum value falls through to ActorAvatar's initials
 *     fallback, which is the real "enum drift downgrades, not crashes"
 *     behavior — earlier whitelist (member/agent only) silently dropped
 *     squad assignees instead.
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Issue } from "@multica/core/types";
import { ISSUE_DATE_SHORT, formatIssueDate } from "@/lib/format-date";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { StatusIcon } from "@/components/ui/status-icon";
import { ProgressRing } from "@/components/ui/progress-ring";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useIntlLocale, useTranslation } from "@/lib/i18n/react";
import { useActorLookup } from "@/data/use-actor-name";
import { actorNameText } from "@/components/ui/actor-name";
import { useActorProfileStore } from "@/data/stores/actor-profile-store";
import { cn } from "@/lib/utils";
import type { CardProperties } from "@/data/stores/issue-filter-slice";
import {
  issueRowProjectChip,
  type RowProject,
} from "@/lib/issue-row-project";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";
import { ProjectIcon } from "@/components/ui/project-icon";
import { CustomStatusChip } from "./custom-status-chip";
import { IssueDuplicateOfMarker } from "./issue-duplicates";
import { IssueAgentActivityIndicator } from "./issue-agent-activity-indicator";
import type { ChildProgress } from "@/data/queries/issues";

interface Props {
  issue: Issue;
  onPress: () => void;
  /** Render the status icon inline at the start of the row. Default: false. */
  showStatus?: boolean;
  /**
   * Multi-select mode (batch actions). When true, the row renders a leading
   * selection indicator and `onPress` toggles membership instead of
   * navigating. Opted in by list surfaces that host the BatchActionBar.
   */
  selectionMode?: boolean;
  /** Whether this row's issue is in the active selection. */
  selected?: boolean;
  /** Long-press enters multi-select pre-selecting this row. */
  onLongPress?: () => void;
  /** THIS issue's own children progress (it can itself be a parent). When
   *  set and `total > 0`, a small ring + "done/total" renders at the row's
   *  trailing edge — mirrors web's SubIssueRow `childProgress` chip
   *  (issue-detail.tsx:775). Drives the nested progress ring on sub-issue
   *  rows (MYS-493). */
  childProgress?: ChildProgress;
  /**
   * Inline edit triggers, mirroring web's SubIssueRow ("inline status &
   * assignee editing", issue-detail.tsx:717-831). Each supplied handler
   * turns its icon into its own press target: React Native gives the
   * innermost Pressable the touch, so tapping the icon edits in place while
   * the rest of the row still runs `onPress` (navigate). Omit a handler and
   * that affordance stays a plain, non-interactive icon.
   */
  onPressStatus?: () => void;
  onPressAssignee?: () => void;
  onPressDueDate?: () => void;
  /**
   * Due date as a date-only "YYYY-MM-DD" string. Rendered as a trailing
   * chip whenever `onPressDueDate` is set — dimmed placeholder when the
   * issue has no date, so the row keeps a stable tap target (web's
   * DueDatePicker renders a dashed placeholder for the same reason).
   */
  dueDate?: string | null;
  /**
   * The project this issue belongs to, already resolved by the hosting
   * surface from its project catalog. Web's row takes exactly this prop
   * (`list-view.tsx:483`/`:492` → `list-row.tsx:60`) and draws the chip only
   * when `cardProperties.project` is on; `lib/issue-row-project.ts` owns the
   * gate. Omit it and the row draws nothing — which is the correct pixel for
   * "no project" and for "the catalog has not answered" alike.
   */
  project?: RowProject | null;
  /** The hosting surface's display toggles. Only `project` is read here. */
  cardProperties?: CardProperties;
}

export function IssueRow({
  issue,
  onPress,
  showStatus = false,
  selectionMode = false,
  selected = false,
  onLongPress,
  childProgress,
  onPressStatus,
  onPressAssignee,
  onPressDueDate,
  dueDate,
  project,
  cardProperties,
}: Props) {
  const palette = useThemePalette();
  // Subscribes, so a language switch re-renders the due-date chip below.
  const intlLocale = useIntlLocale();
  const statusEntry = useIssueStatuses().entryOf(issue.status);
  const { t } = useTranslation();
  const { resolveActorName } = useActorLookup();
  const openProfile = useActorProfileStore((s) => s.open);
  // The assignee avatar already owns its tap (assignee picker), so the card
  // rides long-press. `assignee_type` is member/agent/squad only — every value
  // has a card.
  const profileFor = (
    type: Issue["assignee_type"],
    id: string,
  ): (() => void) | undefined =>
    type ? () => openProfile(type, id) : undefined;
  const checkColor = palette.primary;
  const showChildProgress = childProgress && childProgress.total > 0;
  const dueLabel = formatIssueDate(dueDate ?? null, ISSUE_DATE_SHORT, intlLocale);
  // Web's `showProject` slot (`list-row.tsx:60`、`:151-156`): icon + title,
  // before the dates. Silence when the project is unknown — see
  // `lib/issue-row-project.ts` for why that is the honest pixel.
  const projectChip = issueRowProjectChip({ issue, project, cardProperties });
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className={cn("px-4 py-3.5 active:bg-secondary", selected && "bg-brand/10")}
      accessibilityState={selectionMode ? { selected } : undefined}
    >
      <View className="flex-row items-start gap-2.5">
        {selectionMode ? (
          <Ionicons
            style={{ marginTop: 1 }}
            name={selected ? "checkmark-circle" : "ellipse-outline"}
            size={22}
            color={selected ? checkColor : palette.mutedForeground}
          />
        ) : null}
        <View className="min-w-0 flex-1 gap-1.5">
          <Text className="text-body-lg font-semibold text-foreground" numberOfLines={2}>
            {issue.title}
          </Text>
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            {showStatus ? (
              <Pressable
                onPress={onPressStatus}
                disabled={!onPressStatus}
                accessibilityRole={onPressStatus ? "button" : undefined}
                className={cn(
                  "max-w-full shrink flex-row items-center gap-1.5",
                  onPressStatus && "min-h-9 min-w-9 px-2 active:opacity-60",
                )}
              >
                <StatusIcon
                  status={issue.status}
                  category={statusEntry?.category}
                  color={statusEntry?.is_system ? undefined : (statusEntry?.color ?? undefined)}
                  size={14}
                />
                <CustomStatusChip status={issue.status} className="shrink" />
              </Pressable>
            ) : null}
            <PriorityIcon priority={issue.priority} size={14} />
            <Text className="max-w-full shrink text-caption font-medium text-muted-foreground" numberOfLines={1}>
              {issue.identifier}
            </Text>
            <IssueAgentActivityIndicator issueId={issue.id} />
            <IssueDuplicateOfMarker issue={issue} />
            {showChildProgress ? (
              <View className="flex-row items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary shrink-0">
                <ProgressRing done={childProgress.done} total={childProgress.total} size={11} />
                <Text className="text-micro text-muted-foreground tabular-nums font-medium">
                  {childProgress.done}/{childProgress.total}
                </Text>
              </View>
            ) : null}
            {projectChip ? (
              <View className="flex-row items-center gap-1 shrink max-w-[144px]">
                <ProjectIcon icon={projectChip.icon} size="sm" />
                <Text
                  className="text-caption text-muted-foreground shrink"
                  numberOfLines={1}
                >
                  {projectChip.title}
                </Text>
              </View>
            ) : null}
            {onPressDueDate ? (
              <Pressable
                onPress={onPressDueDate}
                accessibilityRole="button"
                accessibilityLabel={dueLabel ? `${t("attr.dueDate")}: ${dueLabel}` : t("attr.dueDate")}
                className="flex-row items-center gap-0.5 min-h-9 rounded-full px-2 active:opacity-60"
              >
                <Ionicons
                  name="calendar-outline"
                  size={12}
                  color={palette.mutedForeground}
                />
                <Text
                  className={cn(
                    "text-micro tabular-nums",
                    dueLabel ? "text-muted-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {dueLabel ?? "–"}
                </Text>
              </Pressable>
            ) : null}
            {issue.assignee_type && issue.assignee_id ? (
              /* Tap keeps its existing meaning (open the assignee picker — the
                 row's inline edit affordance, web parity). The profile card goes
                 on LONG-press instead: this avatar is already inside a control
                 that owns the tap, so an inner press target would shadow it.
                 Long-press has no other meaning here — the row's own long-press
                 (multi-select) is on the outer Pressable and only fires when this
                 inner one does not. */
              <Pressable
                onPress={onPressAssignee}
                onLongPress={profileFor(issue.assignee_type, issue.assignee_id)}
                disabled={!onPressAssignee}
                accessibilityRole={onPressAssignee ? "button" : undefined}
                accessibilityLabel={(() => {
                  if (!profileFor(issue.assignee_type, issue.assignee_id)) {
                    return undefined;
                  }
                  // The row's only text-free claim about the assignee. Until the
                  // directory for this actor's type answers there is no name to
                  // announce — the generic profile-call label says what the tap
                  // does without naming someone the row cannot identify
                  // (MYS-2215).
                  const name = actorNameText(
                    resolveActorName(issue.assignee_type, issue.assignee_id),
                  );
                  return name
                    ? t("profileCard.openAria", { name })
                    : t("profileCard.title");
                })()}
                className={onPressAssignee ? "size-9 items-center justify-center rounded-full active:bg-secondary" : undefined}
              >
                <ActorAvatar
                  type={issue.assignee_type}
                  id={issue.assignee_id}
                  size={20}
                  showPresence
                />
              </Pressable>
            ) : onPressAssignee ? (
              /* No assignee yet — web's SubIssueRow renders a dashed placeholder
                 so the row keeps a tap target for "assign someone". */
              <Pressable
                onPress={onPressAssignee}
                accessibilityRole="button"
                accessibilityLabel={t("attr.assignee")}
                className="size-9 items-center justify-center rounded-full active:bg-secondary"
              >
                <View className="size-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/40">
                  <Ionicons
                    name="person-add-outline"
                    size={11}
                    color={palette.mutedForeground}
                  />
                </View>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
