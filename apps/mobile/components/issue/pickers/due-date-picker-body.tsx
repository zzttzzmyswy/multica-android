/**
 * Pure picker body for a calendar-day field (start_date / due_date).
 *
 * The two platforms need genuinely different controls, so this component
 * branches rather than pretending one shape fits both:
 *
 * - iOS supports `display="inline"`, so it renders the calendar in place and
 *   the surrounding sheet header stays visible the whole time.
 * - Android's `@react-native-community/datetimepicker` never renders inline —
 *   the component returns `null` and imperatively opens a modal
 *   DatePickerDialog on mount (src/datetimepicker.android.js). Left as-is that
 *   dialog covers the sheet, including its Done / Clear / quick-pick actions,
 *   and forces a confusing double confirmation (OK in the dialog, then Done in
 *   the sheet). So on Android we render a row that shows the current day and
 *   opens the dialog only when tapped (`DateTimePickerAndroid.open`).
 *
 * Either way the sheet header — not this body — owns commit / clear. The body
 * only holds the local draft day.
 *
 * due_date is a calendar day (date-only "YYYY-MM-DD", no time/timezone — see
 * @multica/core/issues/date and GH #3618). Mirrors web's
 * packages/views/issues/components/pickers/due-date-picker.tsx: read the stored
 * day into a local-midnight Date for the control, write back the picked local
 * day as a date-only string.
 */
import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { Platform, Pressable, View } from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import { Text } from "@/components/ui/text";
import {
  toDateOnly,
  dateOnlyToLocalDate,
} from "@multica/core/issues/date";
import { formatIssueDate } from "@/lib/format-date";
import { THEME } from "@/lib/theme";
import { useIntlLocale, useTranslation } from "@/lib/i18n/react";

interface Props {
  value: string | null;
}

export interface DueDatePickerBodyHandle {
  /** Returns the currently-displayed day as a date-only "YYYY-MM-DD" string. */
  getIso: () => string;
}

function toLocalDay(value: string | null): Date {
  return dateOnlyToLocalDate(value) ?? new Date();
}

export const DueDatePickerBody = forwardRef<DueDatePickerBodyHandle, Props>(
  function DueDatePickerBody({ value }, ref) {
    const [draft, setDraft] = useState<Date>(() => toLocalDay(value));

    useEffect(() => {
      setDraft(toLocalDay(value));
    }, [value]);

    useImperativeHandle(ref, () => ({
      getIso: () => toDateOnly(draft),
    }));

    if (Platform.OS === "android") {
      return <AndroidDateRow draft={draft} onChange={setDraft} />;
    }

    return (
      <View className="flex-1 items-center pt-2">
        <DateTimePicker
          value={draft}
          mode="date"
          display="inline"
          onChange={(_event, selected) => {
            if (selected) setDraft(selected);
          }}
        />
      </View>
    );
  },
);

/**
 * Android stand-in for the inline calendar: a full-width row naming the
 * current draft day that opens the native dialog on tap.
 *
 * The dialog is opened imperatively rather than declaratively so it cannot
 * re-open on every render — the package's Android component re-runs its
 * `open` effect whenever `onChange` changes identity, which an inline arrow
 * does on every render.
 */
function AndroidDateRow({
  draft,
  onChange,
}: {
  draft: Date;
  onChange: (d: Date) => void;
}) {
  const { t } = useTranslation();
  const intlLocale = useIntlLocale();
  const theme = THEME[useColorScheme().colorScheme ?? "light"];
  const iso = toDateOnly(draft);

  return (
    <View className="px-4 pt-3">
      <Pressable
        onPress={() =>
          DateTimePickerAndroid.open({
            value: draft,
            mode: "date",
            onChange: (event, selected) => {
              if (event.type === "set" && selected) onChange(selected);
            },
          })
        }
        accessibilityRole="button"
        accessibilityLabel={t("datePicker.chooseDate")}
        className="flex-row items-center justify-between rounded-lg border border-border px-4 py-3 active:bg-secondary"
      >
        <Text className="text-base text-foreground">
          {formatIssueDate(
            iso,
            { year: "numeric", month: "long", day: "numeric" },
            intlLocale,
          )}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={theme.mutedForeground} />
      </Pressable>
    </View>
  );
}
