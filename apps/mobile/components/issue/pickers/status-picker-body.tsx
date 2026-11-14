/**
 * Pure picker body for issue status — grouped by the 7 categories with every
 * status per category (built-ins + custom rows with their color dot). No shell,
 * no modal — the caller (a formSheet route screen, or any embedding surface)
 * renders it inside whatever container it needs.
 *
 * Split from the old `status-picker-sheet.tsx` so the same row UI can serve
 * both the issue-detail route (`issue/[id]/picker/status.tsx`, which writes
 * via useUpdateIssue) and the new-issue draft route
 * (`new-issue-picker/status.tsx`, which writes via useNewIssueDraftStore).
 *
 * Group headings only render when a category holds more than one status —
 * a workspace with no custom statuses renders exactly the old 7 flat rows.
 *
 * ## Project workflows (MUL-7420, iter-288)
 *
 * The option list is no longer "the whole catalog": when the caller names a
 * project (or the issue has none), the issue's workflow decides which statuses
 * exist. Web does the same through `useIssueStatusOptions`; before this, the
 * phone offered columns the server refuses, on every issue of a workspace that
 * had narrowed any workflow.
 *
 * `projectId` is three-valued and the three cases are NOT interchangeable —
 * see the prop's own doc.
 *
 * When the workflow read fails, the list falls back to the catalog but the
 * body says so (`unverified` line). That is deliberate: the alternative was to
 * present an un-corroborated list as the answer, which is the defect being
 * removed. The picker stays usable, it just stops claiming to be complete.
 *
 * ## The handoff hint (MYS-2874)
 *
 * Every row that REASSIGNS now says who it hands the issue to, on the right.
 * Iteration 290 made the phone intercept a handoff; the desktop also warns
 * before the tap (`StepHandoffHint`), and on the phone the only way to learn
 * what a column does was to pick it and get stopped. `lib/handoff-hint.ts`
 * decides, sharing `stepHandsOff` with the gate so the promise and the
 * interception can never disagree.
 *
 * `projectId` alone is not enough to draw it: a `project_lead` handler resolves
 * through the project's own lead, so the caller passes `projectLead` when it has
 * the project row. Omitted means "not known", which degrades that one handler
 * kind to the role noun rather than to a guessed name.
 */
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import type { IssueStatus, Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import {
  HandoffHintRow,
  useHandoffHintDisplay,
} from "@/components/issue/handoff-hint";
import { useIssueStatusOptions, type StatusOption } from "@/lib/status-options";
import { statusHandoffHint } from "@/lib/handoff-hint";
import type { StatusScope } from "@/lib/workflow-status-scope";
import { useWorkspaceStore } from "@/data/workspace-store";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  /** Currently selected status. `null` means "mixed selection" for batch
   *  pickers — no row is checked, and picking one applies it to the batch. */
  value: IssueStatus | null;
  onChange: (next: IssueStatus) => void;
  /**
   * The issue's project, which selects the workflow that limits its statuses.
   *
   * - a project id → that project's workflow;
   * - `null` → the issue is outside any project, so the workspace Default
   *   applies and nothing else (the server enforces the same);
   * - **omitted** → a surface that spans projects (a batch selection), or one
   *   that predates workflows. No single workflow limits it, so the full
   *   catalog is offered — which is the honest answer, not a shortcut.
   *
   * Callers editing ONE issue must pass `issue.project_id` (which may be
   * null); omitting it there would silently restore the unlimited catalog.
   */
  projectId?: string | null;
  /**
   * The project row, for the one handler kind that resolves through it: a
   * `project_lead` step hands the issue to THAT project's lead, and the id
   * above cannot name a person (MYS-2874).
   *
   * Omitted means "not available here" and degrades that hint to the role noun
   * — never to a guessed name. Only read for the hint; the option list comes
   * from `projectId`.
   */
  projectLead?: Pick<Project, "lead_type" | "lead_id"> | null;
}

export function StatusPickerBody({ value, onChange, projectId, projectLead }: Props) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // One hook for both shapes: `resolveStatusScope` already returns the plain
  // catalog for a spanning surface (`projectId === undefined`), so a second
  // code path here could only drift from it.
  const scoped = useIssueStatusOptions(wsId, projectId, value);
  const { groups, hasCustom } = scoped;
  const unverified = !scoped.authoritative;
  const checkColor =
    colorScheme === "dark" ? THEME.dark.primary : THEME.light.primary;

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View className="px-4 pt-3 pb-2">
        <Text className="text-title font-semibold text-foreground">{t("picker.status")}</Text>
        {unverified ? (
          <Text className="mt-1 text-caption text-muted-foreground">
            {t("workflow.statusUnverified")}
          </Text>
        ) : null}
      </View>
      <View className="px-2">
        {groups.map((group) => {
          const heading = hasCustom && group.options.length > 1;
          return (
            <View key={group.category}>
              {heading ? (
                <View className="px-3 pt-2 pb-1">
                  <Text className="text-caption font-medium uppercase tracking-wider text-muted-foreground/70">
                    {t(`enum.status.${group.category}`)}
                  </Text>
                </View>
              ) : null}
              {group.options.map((option) => (
                <StatusPickerRow
                  key={option.key}
                  option={option}
                  selected={value !== null && option.key === value}
                  currentStatus={value}
                  scope={scoped}
                  projectLead={projectLead}
                  checkColor={checkColor}
                  onChange={onChange}
                />
              ))}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

/**
 * One row, as its own component so the hint's hooks run per row.
 *
 * A `.map()` cannot call `useHandoffHintDisplay` — the number of rows changes
 * with the workflow's own data, so the hook count would change with it. Hoisting
 * the row is the standard answer and costs nothing: the list is at most a
 * workflow's columns plus a workspace's custom statuses, and every row was
 * already re-rendered by the parent on each `value` change (the selection
 * checkmark moves between them).
 */
function StatusPickerRow({
  option,
  selected,
  currentStatus,
  scope,
  projectLead,
  checkColor,
  onChange,
}: {
  option: StatusOption;
  selected: boolean;
  currentStatus: IssueStatus | null;
  scope: Pick<StatusScope, "workflow" | "defaultScope">;
  projectLead: Props["projectLead"];
  checkColor: string;
  onChange: (next: IssueStatus) => void;
}) {
  const hint = statusHandoffHint({
    scope,
    project: projectLead,
    statusKey: option.key,
    // The row the issue is ALREADY on draws no hint: re-entering a column
    // reassigns nothing, so 「交给 X」 there would describe a move that does not
    // happen. Upstream's `option.key !== status` guard.
    currentStatus,
  });
  const display = useHandoffHintDisplay(hint);

  return (
    <Pressable
      onPress={() => onChange(option.key)}
      className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-secondary"
      // The hint is a visual affordance with no text of its own, so its
      // sentence belongs here — a screen reader must hear 「交给 Ada」 with the
      // row it describes, not a bare status name that silently reassigns.
      accessibilityLabel={display ? `${option.label}, ${display.sentence}` : option.label}
    >
      <StatusIcon
        status={option.key}
        category={option.category}
        color={option.color ?? undefined}
        size={18}
      />
      <Text className="flex-1 text-title-sm text-foreground">{option.label}</Text>
      <HandoffHintRow display={display} />
      {selected ? <Ionicons name="checkmark" size={20} color={checkColor} /> : null}
    </Pressable>
  );
}