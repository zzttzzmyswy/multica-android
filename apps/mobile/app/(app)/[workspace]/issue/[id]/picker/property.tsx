/**
 * Custom-property value editor route for an existing issue (MYS-334) —
 * presented as a formSheet by the parent Stack, mirrors web's
 * CustomPropertyValueEditor shapes:
 *
 *   select        → option list (tap commits + closes)
 *   multi_select  → toggling option list (stays open until dismissed)
 *   date          → inline UIDatePicker + Done / Clear header
 *   checkbox      → Yes / No rows
 *   text/number/url → input row + Done (number validates parse)
 *
 * Archived (or unknown-type) definitions render read-only: the current
 * value is displayed and only Clear is offered — the server rejects new
 * values on archived properties but always allows unset (mirrors web).
 *
 * Self-contained: reads the issue + property from the caches and fires
 * useSetIssueProperty / useUnsetIssueProperty on commit, then back()s.
 */
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import {
  issueDetailOptions,
} from "@/data/queries/issues";
import { propertyCatalogOptions } from "@/data/queries/properties";
import {
  useSetIssueProperty,
  useUnsetIssueProperty,
} from "@/data/mutations/properties";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  formatPropertyValue,
  propertyOptions,
  propertyTypeIcon,
} from "@/lib/issue-properties";
import { toDateOnly, dateOnlyToLocalDate } from "@multica/core/issues/date";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const COMMIT_TYPES = new Set([
  "select",
  "multi_select",
  "date",
  "checkbox",
  "text",
  "number",
  "url",
]);
const TEXTISH_TYPES = new Set(["text", "number", "url"]);

export default function IssuePropertyValueRoute() {
  const { id, propertyId } = useLocalSearchParams<{
    id: string;
    propertyId: string;
  }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const { data: catalog, isLoading } = useQuery(propertyCatalogOptions(wsId));
  const property = (catalog ?? []).find((p) => p.id === propertyId);

  const setProperty = useSetIssueProperty();
  const unsetProperty = useUnsetIssueProperty();
  const [draft, setDraft] = useState("");

  const value = issue ? (issue.properties ?? {})[property?.id ?? ""] : undefined;

  // Prefill the input from the current value once it lands; never clobber
  // text the user has already started typing.
  const textishValue = typeof value === "string" ? value : undefined;
  useEffect(() => {
    if (
      TEXTISH_TYPES.has(property?.type ?? "") &&
      draft === "" &&
      textishValue
    ) {
      setDraft(textishValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textishValue, property?.type]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!property) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6 gap-1">
        <Ionicons name="options-outline" size={32} color={theme.mutedForeground} />
        <Text className="text-sm text-muted-foreground text-center mt-2">
          {t("properties.notFound")}
        </Text>
      </View>
    );
  }

  const readOnly = property.archived || !COMMIT_TYPES.has(property.type);

  const display = formatPropertyValue(property, value);
  const valueLabel =
    display === null
      ? t("properties.value.empty")
      : display.kind === "option"
        ? display.option.name
        : display.kind === "options"
          ? display.options.map((o) => o.name).join(", ")
          : display.kind === "checkbox"
            ? display.value
              ? t("properties.value.true")
              : t("properties.value.false")
            : display.text;
  const hasValue = value !== undefined;

  const commit = (next: import("@multica/core/types").IssuePropertyValue) => {
    setProperty.mutate(
      { issueId: id, propertyId: property.id, value: next },
      { onSuccess: () => router.back() },
    );
  };

  const clear = () => {
    unsetProperty.mutate(
      { issueId: id, propertyId: property.id },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior="padding">
      {/* Header: property name + Clear / Done actions */}
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <View className="flex-1 flex-row items-center gap-2 min-w-0">
          <Ionicons
            name={propertyTypeIcon(property.type)}
            size={16}
            color={theme.mutedForeground}
          />
          <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
            {property.name}
          </Text>
          {property.archived ? (
            <View className="rounded-full bg-secondary px-1.5 py-0.5">
              <Text className="text-[10px] text-muted-foreground font-medium">
                {t("properties.archivedBadge")}
              </Text>
            </View>
          ) : null}
        </View>
        <View className="flex-row items-center gap-1">
          {hasValue ? (
            <Pressable onPress={clear} hitSlop={6} className="px-2 py-1 rounded-md active:bg-secondary">
              <Text className="text-sm text-destructive">{t("common.clear")}</Text>
            </Pressable>
          ) : null}
          {TEXTISH_TYPES.has(property.type) && (
            <Pressable
              onPress={() => {
                const trimmed = draft.trim();
                if (!trimmed) {
                  if (hasValue) clear();
                  else router.back();
                  return;
                }
                if (property.type === "number") {
                  const parsed = Number(trimmed);
                  if (Number.isNaN(parsed)) return;
                  commit(parsed);
                } else {
                  commit(trimmed);
                }
              }}
              hitSlop={6}
              className="px-2 py-1 rounded-md active:bg-secondary"
            >
              <Text className="text-sm font-medium text-primary">{t("common.done")}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {readOnly ? (
        <View className="flex-1">
          <View className="flex-row items-center gap-2 px-4 py-3">
            <Text className="text-sm text-foreground">{valueLabel}</Text>
          </View>
          <Text className="px-4 text-xs text-muted-foreground">
            {t("properties.value.archivedHint")}
          </Text>
        </View>
      ) : property.type === "select" || property.type === "multi_select" ? (
        <FlatList
          data={propertyOptions(property)}
          keyExtractor={(option) => option.id}
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          renderItem={({ item: option }) => {
            const multi = property.type === "multi_select";
            const list = Array.isArray(value) ? value : [];
            const selected = multi ? list.includes(option.id) : value === option.id;
            return (
              <Pressable
                onPress={() => {
                  if (multi) {
                    const next = selected
                      ? list.filter((v) => v !== option.id)
                      : [...list, option.id];
                    // Unsetting to empty = clear (web's toggle→clear).
                    if (next.length === 0) clear();
                    else commit(next);
                  } else {
                    commit(option.id);
                  }
                }}
                className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
              >
                <View
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: option.color }}
                />
                <Text
                  className={cn(
                    "flex-1 text-base",
                    selected ? "text-foreground font-medium" : "text-foreground",
                  )}
                  numberOfLines={1}
                >
                  {option.name}
                </Text>
                {selected ? (
                  <Ionicons name="checkmark" size={20} color={theme.primary} />
                ) : null}
              </Pressable>
            );
          }}
        />
      ) : property.type === "checkbox" ? (
        <View className="flex-1">
          <CheckRow
            label={t("properties.value.true")}
            selected={value === true}
            onPress={() => commit(true)}
          />
          <View className="h-px bg-border ml-4" />
          <CheckRow
            label={t("properties.value.false")}
            selected={value === false}
            onPress={() => commit(false)}
          />
        </View>
      ) : property.type === "date" ? (
        <DateBody
          value={typeof value === "string" ? value : null}
          onDone={(iso) => commit(iso)}
        />
      ) : (
        // text / number / url
        <View className="flex-1 px-4 pt-2">
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            keyboardType={
              property.type === "number"
                ? "decimal-pad"
                : property.type === "url"
                  ? "url"
                  : "default"
            }
            returnKeyType="done"
            onSubmitEditing={() => {
              const trimmed = draft.trim();
              if (!trimmed) return;
              if (property.type === "number") {
                const parsed = Number(trimmed);
                if (Number.isNaN(parsed)) return;
                commit(parsed);
              } else {
                commit(trimmed);
              }
            }}
            placeholder={
              property.type === "url"
                ? t("properties.value.urlPlaceholder")
                : property.type === "number"
                  ? t("properties.value.numberPlaceholder")
                  : t("properties.value.valuePlaceholder")
            }
            placeholderTextColor={theme.mutedForeground}
            className="border border-border rounded-md px-3 py-2.5 text-sm text-foreground"
            style={{ fontSize: 14, includeFontPadding: false, textAlignVertical: "center" }}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function CheckRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary">
      <Text className="flex-1 text-base text-foreground">{label}</Text>
      {selected ? <Ionicons name="checkmark" size={20} color={theme.primary} /> : null}
    </Pressable>
  );
}

function DateBody({
  value,
  onDone,
}: {
  value: string | null;
  onDone: (iso: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => dateOnlyToLocalDate(value) ?? new Date());
  return (
    <View className="flex-1 items-center pt-2">
      <DateTimePicker
        value={draft}
        mode="date"
        display="inline"
        onChange={(_event, selected) => {
          if (selected) setDraft(selected);
        }}
        maximumDate={new Date(9999, 11, 31)}
      />
      <Pressable
        onPress={() => onDone(toDateOnly(draft))}
        className="mt-2 rounded-md px-4 py-2 active:bg-secondary"
      >
        <Text className="text-sm font-medium text-primary">{t("common.done")}</Text>
      </Pressable>
    </View>
  );
}