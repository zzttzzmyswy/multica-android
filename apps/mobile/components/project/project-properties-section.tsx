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
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ProjectStatusIcon } from "@/components/ui/project-status-icon";
import { ProjectPriorityIcon } from "@/components/ui/project-priority-icon";
import {
  projectPriorityLabel,
  projectStatusLabel,
} from "@/lib/project-status";
import { useActorLookup } from "@/data/use-actor-name";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useIntlLocale, useTranslation } from "@/lib/i18n/react";
import { THEME } from "@/lib/theme";

interface Props {
  project: Project;
  onPressStatus: () => void;
  onPressPriority: () => void;
  onPressLead: () => void;
  onPressStartDate: () => void;
  onPressDueDate: () => void;
}

export function ProjectPropertiesSection({
  project,
  onPressStatus,
  onPressPriority,
  onPressLead,
  onPressStartDate,
  onPressDueDate,
}: Props) {
  const { t } = useTranslation();
  const intlLocale = useIntlLocale();
  const { getName } = useActorLookup();
  const leadName =
    project.lead_type && project.lead_id
      ? getName(project.lead_type, project.lead_id)
      : null;

  return (
    <View className="border-y border-border bg-background">
      <Row
        label={t("picker.status")}
        onPress={onPressStatus}
        left={<ProjectStatusIcon status={project.status} size={16} />}
        right={
          <Text className="text-sm text-foreground">
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
          <Text className="text-sm text-foreground">
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
          <Text
            className={
              leadName
                ? "text-sm text-foreground"
                : "text-sm text-muted-foreground"
            }
          >
            {leadName ?? t("picker.unassigned")}
          </Text>
        }
      />
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
  const { colorScheme } = useColorScheme();
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
          color={THEME[colorScheme].mutedForeground}
        />
      }
      right={
        <Text
          className={
            !value
              ? "text-sm text-muted-foreground"
              : overdue
                ? "text-sm text-destructive"
                : "text-sm text-foreground"
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
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
    >
      <Text className="text-sm text-muted-foreground w-20">{label}</Text>
      <View className="flex-row items-center gap-2 flex-1">
        {left}
        {right}
      </View>
      <Chevron />
    </Pressable>
  );
}

function Separator() {
  return <View className="h-px bg-border ml-4" />;
}

function Chevron() {
  const { colorScheme } = useColorScheme();
  return (
    <Ionicons
      name="chevron-forward"
      size={14}
      color={THEME[colorScheme].mutedForeground}
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
