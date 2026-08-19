/**
 * Custom date-range picker for the ISSUE FILTER panel (`issues-filter.tsx`).
 * Opened from the panel's date section; the selected range commits through
 * `setDateFilter({ field, from, to })` — the same action the panel presets
 * use, so the server window (`buildIssueWindow`) picks it up identically.
 *
 * Layout:
 *   - date field radio (Created / Updated) — mirrors web DateSubContent
 *   - start / end day rows; on Android each row opens the native calendar
 *     dialog on demand (DateTimePicker renders the dialog at mount), on iOS
 *     both pickers render inline
 *   - Done commits the current local draft to the view store and closes;
 *     Clear (shown when a date filter is active) removes it and closes.
 *
 * Scope param (`?scope=my|all|project`) selects which view-store to write,
 * matching the panel + picker routes.
 */
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useLayoutEffect, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { dateOnlyToLocalDate, toDateOnly } from "@multica/core/issues/date";
import { Text } from "@/components/ui/text";
import {
  issueFilterStoreForScope,
  parseFilterScope,
  type IssueFilterScope,
} from "@/data/stores/issue-filter-store-registry";
import type { IssueDateFilterValue } from "@/data/stores/issue-filter-slice";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";

type Scope = IssueFilterScope;
type DateField = IssueDateFilterValue["field"];

export default function IssuesFilterDateRoute() {
  const { scope: scopeParam } = useLocalSearchParams<{ scope?: string }>();
  const resolvedScope: Scope = parseFilterScope(scopeParam);
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { colorScheme } = useColorScheme();
  const tint = THEME[colorScheme].primary;
  const muted = THEME[colorScheme].mutedForeground;

  const live = issueFilterStoreForScope(resolvedScope).getState();
  const initialFilter = live.dateFilter;

  const [field, setField] = useState<DateField>(
    initialFilter?.field ?? "created_at",
  );
  const [from, setFrom] = useState<Date>(
    () => dateOnlyToLocalDate(initialFilter?.from ?? "") ?? new Date(),
  );
  const [to, setTo] = useState<Date>(
    () => dateOnlyToLocalDate(initialFilter?.to ?? "") ?? new Date(),
  );
  // Android only: which row's date dialog is currently open (DateTimePicker
  // shows the native dialog the moment it mounts).
  const [activeRow, setActiveRow] = useState<"from" | "to" | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: t("filter.dateCustomRange") });
  }, [navigation, t]);

  const setFieldAndKeep = (next: DateField) => {
    setField(next);
    // Web keeps an existing window and just swaps its field; mirror that so
    // switching Created→Updated doesn't silently drop a committed range.
    const current = live.dateFilter;
    if (current) live.setDateFilter({ ...current, field: next });
  };

  const apply = () => {
    live.setDateFilter({
      field,
      from: toDateOnly(from),
      to: toDateOnly(to),
    });
    navigation.goBack();
  };

  const clear = () => {
    live.setDateFilter(null);
    navigation.goBack();
  };

  const fieldLabel = (option: DateField) =>
    option === "created_at" ? t("filter.dateCreated") : t("filter.dateUpdated");

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-base font-semibold text-foreground">
          {t("filter.dateCustomRange")}
        </Text>
        <View className="flex-row items-center gap-1">
          {initialFilter ? (
            <Pressable
              onPress={clear}
              hitSlop={6}
              className="px-2 py-1 rounded-md active:bg-secondary"
            >
              <Text className="text-sm text-destructive">{t("common.clear")}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={apply}
            hitSlop={6}
            className="px-2 py-1 rounded-md active:bg-secondary"
          >
            <Text className="text-sm font-medium text-primary">{t("common.done")}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Date field — mirrors web DateSubContent's radio group */}
        <SectionLabel>{t("filter.dateField")}</SectionLabel>
        {(["created_at", "updated_at"] as const).map((option) => {
          const selected = field === option;
          return (
            <Pressable
              key={option}
              onPress={() => setFieldAndKeep(option)}
              className={cn(
                "flex-row items-center gap-3 px-4 py-2.5 active:bg-secondary",
                selected && "bg-secondary/60",
              )}
            >
              <Ionicons
                name={selected ? "radio-button-on" : "radio-button-off"}
                size={18}
                color={selected ? tint : muted}
              />
              <Text className="flex-1 text-sm text-foreground">
                {fieldLabel(option)}
              </Text>
            </Pressable>
          );
        })}

        {/* Day rows — Android: tap-to-open dialog; iOS: inline pickers */}
        <SectionLabel>{t("filter.dateRange")}</SectionLabel>
        {Platform.OS === "ios" ? (
          <View className="px-4 pb-2">
            <Text className="pb-1 text-sm text-muted-foreground">
              {t("filter.dateStart")}
            </Text>
            <DateTimePicker
              value={from}
              mode="date"
              display="inline"
              onChange={(_e, selected) => {
                if (selected) setFrom(selected);
              }}
            />
            <Text className="pb-1 pt-3 text-sm text-muted-foreground">
              {t("filter.dateEnd")}
            </Text>
            <DateTimePicker
              value={to}
              mode="date"
              display="inline"
              onChange={(_e, selected) => {
                if (selected) setTo(selected);
              }}
            />
          </View>
        ) : (
          <View>
            {(["from", "to"] as const).map((kind) => {
              const value = kind === "from" ? from : to;
              return (
                <Pressable
                  key={kind}
                  onPress={() => setActiveRow(kind)}
                  className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
                >
                  <Ionicons
                    name="calendar-outline"
                    size={18}
                    color={muted}
                  />
                  <Text className="flex-1 text-sm text-foreground">
                    {t(kind === "from" ? "filter.dateStart" : "filter.dateEnd")}
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    {toDateOnly(value)}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={muted} />
                </Pressable>
              );
            })}
            {activeRow ? (
              <DateTimePicker
                value={activeRow === "from" ? from : to}
                mode="date"
                display="default"
                onChange={(_event, selected) => {
                  const row = activeRow;
                  setActiveRow(null);
                  if (!selected) return;
                  if (row === "from") setFrom(selected);
                  else setTo(selected);
                }}
              />
            ) : null}
          </View>
        )}

        <View className="px-4 pt-2 pb-4">
          <Text className="text-xs text-muted-foreground">
            {t("filter.dateRangeHint")}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <View className="px-4 pt-3 pb-1.5">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {children}
      </Text>
    </View>
  );
}