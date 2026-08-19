/**
 * Bottom chip row for the new-issue form. Mirrors `attribute-row.tsx`'s
 * visual pattern but operates on the `useNewIssueDraftStore` instead of an
 * `issue` object + mutation. Tapping a chip pushes a formSheet picker
 * route under `new-issue-picker/<field>` — the route reads/writes the same
 * draft store, so the chip rehydrates automatically when the sheet
 * dismisses.
 *
 * Why a draft store: the picker routes are siblings of new-issue.tsx in
 * the Stack — they can't reach into the new-issue screen's local state.
 * The draft store is the cross-screen channel.
 *
 * ## Field visibility (mode prop) — mirrors web Issue create settings
 *
 * When `mode` is set ("manual" | "agent"), the row consults the
 * per-workspace issue-create settings store (web
 * `issue-create-settings-store.ts`) for which fields this create mode
 * keeps on its toolbar:
 *
 *   - a field is rendered when it is in the configured visible list, OR
 *     it currently holds a non-default value (web's "a field holding a
 *     value always re-surfaces" rule — nothing applied is ever invisible);
 *   - hidden fields stay reachable from the trailing ⋯ chip, which lists
 *     them alongside a "Customize fields" entry that jumps to
 *     Settings → Issue;
 *   - the row falls back to rendering every field with no ⋯ when `mode`
 *     is omitted (legacy call sites keep their exact behavior).
 *
 * This is the same contract web encodes in `create-issue.tsx` /
 * `quick-create-issue.tsx` (`visibleFields.includes(f) || value || open`).
 */
import { View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Label } from "@multica/core/types";
import { AttributeChip } from "@/components/issue/attribute-chip";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { ProjectIcon } from "@/components/ui/project-icon";
import { StatusIcon } from "@/components/ui/status-icon";
import { formatDateOnly } from "@multica/core/issues/date";
import { useActorLookup } from "@/data/use-actor-name";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useStatusLabel } from "@/lib/status-options";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  useIssueCreateSettings,
  MANUAL_CREATE_FIELDS,
  QUICK_CREATE_FIELDS,
} from "@/data/issue-create-settings-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { ActionSheet } from "@/lib/action-sheet";
import {
  overflowFields,
  visibleFields,
} from "@/lib/issue-create-field-visibility";

/** Picker fields the new-issue draft form can open. Bound to a typed map
 *  of Expo Router pathnames so typos become compile errors (previously
 *  the call site used `as never` on a template string). Shared with the
 *  issue-create-settings store constants. Covers the full web manual field
 *  set (labels / start-date included since iteration 58). */
export type NewIssuePickerField =
  | "status"
  | "priority"
  | "assignee"
  | "labels"
  | "project"
  | "due-date"
  | "start-date";

const NEW_ISSUE_PICKER_PATHNAMES = {
  status: "/[workspace]/new-issue-picker/status",
  priority: "/[workspace]/new-issue-picker/priority",
  assignee: "/[workspace]/new-issue-picker/assignee",
  labels: "/[workspace]/new-issue-picker/labels",
  project: "/[workspace]/new-issue-picker/project",
  "due-date": "/[workspace]/new-issue-picker/due-date",
  "start-date": "/[workspace]/new-issue-picker/start-date",
} as const satisfies Record<NewIssuePickerField, string>;

/** Stable default for `fields` — module-level so the component keeps
 *  rendering the full chip row when the prop is omitted. Canonical order
 *  mirrors web `MANUAL_CREATE_FIELDS`. */
const ALL_FIELDS: NewIssuePickerField[] = [
  "status",
  "priority",
  "assignee",
  "labels",
  "project",
  "due-date",
  "start-date",
];

/** Which toolbar this row is rendering for. Drives which settings list
 *  (web Issue create settings: quick agent / manual) filters the chips. */
export type CreateFormMode = "manual" | "agent";

interface Props {
  /** Optional static chip list, used without `mode` for legacy call sites
   *  that don't consult the settings store. Default: all five fields. */
  fields?: NewIssuePickerField[];
  /** When set, the row consults the per-workspace issue-create settings
   *  for this mode and renders the configured subset + value-held fields,
   *  with a trailing ⋯ overflow for hidden fields. Legacy call sites
   *  omit it and keep rendering `fields` unchanged. */
  mode?: CreateFormMode;
}

export function CreateFormAttributeRow({ fields = ALL_FIELDS, mode }: Props) {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const settings = useIssueCreateSettings(mode ? wsId : null);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const statusLabel = useStatusLabel(wsId);
  const status = useNewIssueDraftStore((s) => s.status);
  const statusEntry = useIssueStatuses(wsId).entryOf(status);
  const priority = useNewIssueDraftStore((s) => s.priority);
  const assignee = useNewIssueDraftStore((s) => s.assignee);
  const dueDate = useNewIssueDraftStore((s) => s.dueDate);
  const startDate = useNewIssueDraftStore((s) => s.startDate);
  const labels = useNewIssueDraftStore((s) => s.labels);
  const project = useNewIssueDraftStore((s) => s.project);

  const { getName } = useActorLookup();
  const assigneeLabel = assignee
    ? getName(assignee.type, assignee.id)
    : t("attr.assignee");
  const priorityLabel =
    priority === "none" ? t("attr.priority") : t(`enum.priority.${priority}`);

  const open = (field: NewIssuePickerField) => {
    if (!wsSlug) return;
    router.push({
      pathname: NEW_ISSUE_PICKER_PATHNAMES[field],
      params: { workspace: wsSlug },
    });
  };

  const openFieldSettings = () => {
    if (!wsSlug) return;
    router.push(`/${wsSlug}/more/settings/issues`);
  };

  // A field holds a value when it deviates from its empty draft default —
  // web's "nothing applied is ever invisible" rule.
  const holdsValue = (field: NewIssuePickerField): boolean => {
    switch (field) {
      case "status":
        return status !== "todo";
      case "priority":
        return priority !== "none";
      case "assignee":
        return assignee !== null;
      case "labels":
        return labels.length > 0;
      case "project":
        return project !== null;
      case "due-date":
        return dueDate !== null;
      case "start-date":
        return startDate !== null;
    }
  };

  const fieldLabel = (field: NewIssuePickerField): string => {
    switch (field) {
      case "status":
        return t("attr.status");
      case "priority":
        return t("attr.priority");
      case "assignee":
        return t("attr.assignee");
      case "labels":
        return t("attr.labels");
      case "project":
        return t("attr.project");
      case "due-date":
        return t("attr.dueDate");
      case "start-date":
        return t("attr.startDate");
    }
  };

  // The candidate pool for this mode: web's quick/manual field lists. The
  // mobile capability set now matches web's full manual field set.
  const pool: NewIssuePickerField[] = mode
    ? mode === "agent"
      ? (QUICK_CREATE_FIELDS as NewIssuePickerField[])
      : (MANUAL_CREATE_FIELDS as NewIssuePickerField[])
    : ALL_FIELDS;

  const configuredVisible = mode
    ? (mode === "agent" ? settings.quick : settings.manual) as NewIssuePickerField[]
    : [];

  const visibleFieldsFor = mode
    ? visibleFields(pool, configuredVisible, holdsValue)
    : fields;

  // Hidden AND valueless fields go into the ⋯ overflow (web hides a menu
  // item once the field re-surfaces with a value).
  const menuFields = mode
    ? overflowFields(pool, configuredVisible, holdsValue)
    : [];

  const openMore = () => {
    if (!wsSlug) return;
    const fieldLabels = menuFields.map((f) => fieldLabel(f));
    const customizeIndex = fieldLabels.length;
    const cancelIndex = customizeIndex + 1;
    ActionSheet.showActionSheetWithOptions(
      {
        options: [
          ...fieldLabels,
          t("settings.issue.customizeFields"),
          t("common.cancel"),
        ],
        cancelButtonIndex: cancelIndex,
        title: t("newIssue.moreFieldsTitle"),
      },
      (i) => {
        if (i >= 0 && i < menuFields.length) {
          open(menuFields[i]);
        } else if (i === customizeIndex) {
          openFieldSettings();
        }
      },
    );
  };

  // Field → chip element. `visibleFieldsFor`/`menuFields` control which
  // render (mode-driven store config + value-held re-surfacing + overflow).
  const renderChip = (field: NewIssuePickerField) => {
    switch (field) {
      case "status":
        return (
          <AttributeChip
            icon={
              <StatusIcon
                status={status}
                category={statusEntry?.category}
                color={statusEntry?.is_system ? undefined : (statusEntry?.color ?? undefined)}
                size={12}
              />
            }
            label={statusLabel(status)}
            variant="filled"
            onPress={() => open("status")}
          />
        );
      case "priority":
        return (
          <AttributeChip
            icon={<PriorityIcon priority={priority} />}
            label={priorityLabel}
            variant={priority === "none" ? "dimmed" : "filled"}
            onPress={() => open("priority")}
          />
        );
      case "assignee":
        return (
          <AttributeChip
            icon={
              assignee ? (
                <ActorAvatar
                  type={assignee.type}
                  id={assignee.id}
                  size={16}
                  showPresence
                />
              ) : (
                <Ionicons
                  name="person-circle-outline"
                  size={16}
                  color="#a1a1aa"
                />
              )
            }
            label={assigneeLabel}
            variant={assignee ? "filled" : "dimmed"}
            onPress={() => open("assignee")}
          />
        );
      case "due-date":
        return (
          <AttributeChip
            icon={
              <Ionicons
                name="calendar-outline"
                size={14}
                color={dueDate ? undefined : "#a1a1aa"}
              />
            }
            label={dueDate ? formatDueDate(dueDate, t) : t("attr.dueDate")}
            variant={dueDate ? "filled" : "dimmed"}
            onPress={() => open("due-date")}
          />
        );
      case "start-date":
        return (
          <AttributeChip
            icon={
              <Ionicons
                name="calendar-clear-outline"
                size={14}
                color={startDate ? undefined : "#a1a1aa"}
              />
            }
            label={
              startDate ? formatDueDate(startDate, t) : t("attr.startDate")
            }
            variant={startDate ? "filled" : "dimmed"}
            onPress={() => open("start-date")}
          />
        );
      case "labels":
        return labels.length > 0 ? (
          <AttributeChip
            icon={<LabelDots labels={labels} />}
            label={summarizeLabels(labels, t("attr.labels"))}
            variant="filled"
            onPress={() => open("labels")}
          />
        ) : (
          <AttributeChip
            icon={
              <Ionicons name="pricetags-outline" size={14} color="#a1a1aa" />
            }
            label={t("attr.labels")}
            variant="dimmed"
            onPress={() => open("labels")}
          />
        );
      case "project":
        return (
          <AttributeChip
            icon={
              project ? (
                <ProjectIcon icon={project.icon} size="sm" />
              ) : (
                <Ionicons name="folder-outline" size={14} color="#a1a1aa" />
              )
            }
            label={project?.title ?? t("attr.project")}
            variant={project ? "filled" : "dimmed"}
            onPress={() => open("project")}
          />
        );
    }
  };

  return (
    <View>
      <View className="flex-row flex-wrap gap-2">
        {visibleFieldsFor.map((field) => (
          <View key={field}>{renderChip(field)}</View>
        ))}
        {mode ? (
          <View>
            <AttributeChip
              icon={
                <Ionicons name="ellipsis-horizontal" size={14} color={muted} />
              }
              label=""
              variant="dimmed"
              onPress={openMore}
              className="px-2.5"
              accessibilityLabel={t("newIssue.moreFieldsA11y")}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

// due_date is a calendar day — format timezone-safely (no offset day shift).
function formatDueDate(iso: string, t: (id: string) => string): string {
  return (
    formatDateOnly(iso, { month: "short", day: "numeric" }) ||
    t("attr.dueDate")
  );
}

/** Compact multi-select summary for the labels chip: single label shows its
 *  name, several collapse to "first +N" (same shape web's board chip row
 *  uses — no point columns-elbowing on a phone). */
function summarizeLabels(labels: Label[], fallback: string): string {
  if (labels.length === 1) return labels[0].name;
  return `${labels[0].name} +${labels.length - 1}`;
}

/** Up to three stacked color dots previewing the selected label colors. */
function LabelDots({ labels }: { labels: Label[] }) {
  return (
    <View className="flex-row items-center">
      {labels.slice(0, 3).map((label, i) => (
        <View
          key={label.id}
          className="size-2.5 rounded-full border border-background"
          style={{
            backgroundColor: label.color,
            marginLeft: i === 0 ? 0 : -3,
          }}
        />
      ))}
    </View>
  );
}
