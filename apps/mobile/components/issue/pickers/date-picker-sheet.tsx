/**
 * Shared body for a calendar-day field sheet (start_date / due_date).
 *
 * Every date route used to inline the same header — title on the left,
 * conditional Clear + Done on the right — which made the quick-pick row a
 * six-way copy/paste. They now all render this component and supply only the
 * value plus the two commits.
 *
 * Quick picks mirror the web issue menu's date submenus
 * (packages/views/issues/actions/issue-actions-menu-items.tsx:210-250): today,
 * tomorrow, next week, and Clear only when the field already has a value. Web
 * reaches them through a submenu above the calendar; mobile reaches them
 * through this row above the control, which is the only place they stay
 * reachable on Android — see due-date-picker-body.tsx for why.
 *
 * Each quick pick commits and dismisses in one tap, exactly like web's menu
 * item click: there is nothing left to confirm, so leaving the sheet open
 * would only ask the user to tap Done again.
 */
import { useRef } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import {
  DueDatePickerBody,
  type DueDatePickerBodyHandle,
} from "@/components/issue/pickers/due-date-picker-body";
import {
  addDaysDateOnly,
  todayDateOnly,
} from "@multica/core/issues/date";
import { formatIssueDate } from "@/lib/format-date";
import { useIntlLocale, useTranslation } from "@/lib/i18n/react";

interface Props {
  title: string;
  value: string | null;
  /** Commit a day and dismiss — used by Done and by every quick pick. */
  onCommit: (iso: string) => void;
  /** Clear the field and dismiss. Only offered when `value` is set. */
  onClear: () => void;
}

export function DatePickerSheet({ title, value, onCommit, onClear }: Props) {
  const { t } = useTranslation();
  const intlLocale = useIntlLocale();
  const ref = useRef<DueDatePickerBodyHandle>(null);

  const quickPicks = [
    { key: "today", label: t("datePicker.today"), iso: todayDateOnly() },
    { key: "tomorrow", label: t("datePicker.tomorrow"), iso: addDaysDateOnly(1) },
    { key: "nextWeek", label: t("datePicker.nextWeek"), iso: addDaysDateOnly(7) },
  ];

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-base font-semibold text-foreground">{title}</Text>
        <View className="flex-row items-center gap-1">
          {value ? (
            <Pressable
              onPress={onClear}
              hitSlop={6}
              accessibilityRole="button"
              className="px-2 py-1 rounded-md active:bg-secondary"
            >
              <Text className="text-sm text-destructive">{t("common.clear")}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              const iso = ref.current?.getIso();
              if (iso) onCommit(iso);
            }}
            hitSlop={6}
            accessibilityRole="button"
            className="px-2 py-1 rounded-md active:bg-secondary"
          >
            <Text className="text-sm font-medium text-primary">{t("common.done")}</Text>
          </Pressable>
        </View>
      </View>

      <View className="flex-row items-center gap-2 px-4 pb-2">
        {quickPicks.map((pick) => {
          const active = value === pick.iso;
          return (
            <Pressable
              key={pick.key}
              onPress={() => onCommit(pick.iso)}
              accessibilityRole="button"
              accessibilityLabel={t("a11y.dateQuickPick", {
                label: pick.label,
                date: formatIssueDate(
                  pick.iso,
                  { year: "numeric", month: "long", day: "numeric" },
                  intlLocale,
                ),
              })}
              className={`px-3 py-1.5 rounded-full border border-border active:bg-secondary ${
                active ? "bg-secondary" : ""
              }`}
            >
              <Text className={`text-sm text-foreground ${active ? "font-medium" : ""}`}>
                {pick.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <DueDatePickerBody ref={ref} value={value} />
    </View>
  );
}
