/**
 * Trigger create/edit form (push screen, reached from the autopilot detail
 * page). One route serves both modes:
 *  - create (`?kind=schedule|webhook`) — kind is choosable, no label/enabled
 *    (new triggers start enabled, accept-all events for webhook).
 *  - edit (`?triggerId=...`) — kind is locked (web converts kinds by
 *    "delete old, create new", PLAN.md), label + enabled become editable,
 *    and a schedule trigger also edits its schedule via the shared
 *    ScheduleEditor (mobile counterpart of web's AddScheduleTriggerDialog).
 *
 * Submit mirrors web's dialog: a schedule is probed against the server's
 * cron-preview BEFORE writing (a rejected expression must not persist a
 * trigger that can never fire). A created webhook trigger's URL is shown
 * once right after creation, with a copy action.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Switch,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { WebhookEventFilter } from "@multica/core/types";
import { buildAutopilotWebhookUrl } from "@multica/core/autopilots/webhook";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { EventFilterEditor } from "@/components/autopilot/event-filter-editor";
import { ScheduleEditor } from "@/components/autopilot/schedule-editor";
import { api } from "@/data/api";
import { autopilotDetailOptions } from "@/data/queries/autopilots";
import {
  useCreateAutopilotTrigger,
  useUpdateAutopilotTrigger,
} from "@/data/mutations/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import { getApiBaseUrl } from "@/data/server-config";
import {
  buildTriggerCreate,
  buildTriggerUpdate,
  probeSchedule,
  scheduleFromTrigger,
  type TriggerFormState,
} from "@/lib/autopilot-trigger-form";
import { toCron } from "@/lib/schedule-editor-cron";
import { getDefaultScheduleConfig } from "@/lib/schedule-editor-model";
import type { ScheduleConfig } from "@/lib/schedule-editor-model";
import { serializeEventFilters } from "@/lib/autopilot-event-filter";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export default function TriggerFormPage() {
  const params = useLocalSearchParams<{
    id: string;
    triggerId?: string;
    kind?: string;
    workspace: string;
  }>();
  const autopilotId = params.id;
  const triggerId = params.triggerId;
  const isEdit = Boolean(triggerId);
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const detail = useQuery(autopilotDetailOptions(wsId, autopilotId));
  const existing = useMemo(
    () =>
      detail.data?.triggers.find((trig) => trig.id === triggerId) ?? null,
    [detail.data, triggerId],
  );

  const [kind, setKind] = useState<"schedule" | "webhook">(
    () =>
      (isEdit && existing?.kind === "webhook") ||
      (!isEdit && params.kind === "webhook")
        ? "webhook"
        : "schedule",
  );
  // Structured schedule state for the ScheduleEditor. Create starts at the
  // default; edit hydrates via scheduleFromTrigger when the detail query lands
  // (a beyond-model expression keeps its `raw` verbatim for advanced mode).
  const [schedule, setSchedule] = useState<ScheduleConfig>(() =>
    isEdit && existing
      ? scheduleFromTrigger(existing.cron_expression, existing.timezone)
      : getDefaultScheduleConfig("Asia/Shanghai"),
  );
  // Mirrors the editor's inline rejection so the Save button stays in step.
  const [scheduleValid, setScheduleValid] = useState(true);
  const [label, setLabel] = useState(isEdit ? existing?.label ?? "" : "");
  const [enabled, setEnabled] = useState(isEdit ? existing?.enabled !== false : true);
  const [eventFilters, setEventFilters] = useState<WebhookEventFilter[]>(
    isEdit ? (existing?.event_filters ?? []) : [],
  );

  // Edit mode hydrates from the detail query, which resolves AFTER first
  // render — sync once when the existing trigger lands (or on triggerId
  // change), not on every re-render.
  const prevExistingId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (isEdit && existing && prevExistingId.current !== existing.id) {
      prevExistingId.current = existing.id;
      setKind(existing.kind === "webhook" ? "webhook" : "schedule");
      setSchedule(scheduleFromTrigger(existing.cron_expression, existing.timezone));
      setLabel(existing.label ?? "");
      setEnabled(existing.enabled !== false);
      setEventFilters(existing.event_filters ?? []);
      initialEventFiltersRef.current = serializeEventFilters(
        existing.event_filters ?? [],
      );
    }
  }, [isEdit, existing]);

  // Dirty gate for webhook event filters — PATCH them only when the snapshot
  // taken on open differs from the live state (web `eventFiltersDirty`).
  // serializeEventFilters normalizes omitted-vs-empty actions so touching a
  // field and reverting is not a phantom change.
  const initialEventFiltersRef = useRef<string | null>(
    isEdit ? serializeEventFilters(existing?.event_filters ?? []) : null,
  );
  const eventFiltersDirty =
    isEdit &&
    kind === "webhook" &&
    serializeEventFilters(eventFilters) !== initialEventFiltersRef.current;

  const createTrigger = useCreateAutopilotTrigger();
  const updateTrigger = useUpdateAutopilotTrigger();
  const isSubmitting = createTrigger.isPending || updateTrigger.isPending;

  // Editing before the detail query lands would overwrite the server's cron
  // with the default schedule — keep submit disabled until hydrated.
  const editHydrated = !isEdit || existing !== null;

  // The editor always has a value; this guards the (impossible) empty-raw edge
  // rather than the happy path (same shape as new.tsx).
  const cronExpression = schedule.raw === null ? toCron(schedule) : schedule.raw;
  const cronMissing = kind === "schedule" && cronExpression.trim().length === 0;

  const state: TriggerFormState = useMemo(
    () => ({
      kind,
      cronExpression,
      timezone: schedule.timezone,
      label,
      enabled,
      eventFilters,
    }),
    [kind, cronExpression, schedule.timezone, label, enabled, eventFilters],
  );

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    if (!editHydrated) return;
    if (cronMissing) {
      Alert.alert(
        t("autopilots.trigger.scheduleInvalidTitle"),
        t("autopilots.trigger.cronRequired"),
      );
      return;
    }
    try {
      if (kind === "schedule") {
        const rejection = await probeSchedule(
          (p) => api.cronPreview(p),
          cronExpression.trim(),
          schedule.timezone.trim(),
        );
        if (rejection) {
          Alert.alert(
            t("autopilots.trigger.scheduleInvalidTitle"),
            rejection.detail,
          );
          return;
        }
      }

      if (isEdit && triggerId) {
        await updateTrigger.mutateAsync({
          autopilotId,
          triggerId,
          ...buildTriggerUpdate(
            state,
            eventFiltersDirty ? { eventFilters } : undefined,
          ),
        });
        router.back();
        return;
      }

      const trigger = await createTrigger.mutateAsync({
        autopilotId,
        ...buildTriggerCreate(state),
      });
      router.back();
      if (kind === "webhook") {
        const url = buildAutopilotWebhookUrl({
          trigger,
          apiBaseUrl: getApiBaseUrl(),
        });
        if (url) {
          Alert.alert(t("autopilots.trigger.added"), url, [
            {
              text: t("autopilots.trigger.copyUrl"),
              onPress: () => void Clipboard.setStringAsync(url),
            },
            { text: t("common.done"), style: "default" },
          ]);
        }
      }
    } catch (err) {
      Alert.alert(
        t("autopilots.trigger.saveFailed"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  }, [
    isSubmitting,
    editHydrated,
    cronMissing,
    kind,
    cronExpression,
    schedule.timezone,
    isEdit,
    triggerId,
    autopilotId,
    state,
    eventFiltersDirty,
    eventFilters,
    createTrigger,
    updateTrigger,
    t,
  ]);

  const headerRight = useCallback(
    () => (
      <Button
        size="sm"
        disabled={
          isSubmitting ||
          !editHydrated ||
          (kind === "schedule" && !scheduleValid)
        }
        onPress={() => void handleSubmit()}
      >
        <Text>
          {isSubmitting ? t("autopilots.trigger.saving") : t("autopilots.trigger.save")}
        </Text>
      </Button>
    ),
    [isSubmitting, editHydrated, kind, scheduleValid, handleSubmit, t],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: isEdit
            ? t("autopilots.trigger.editing")
            : t("autopilots.trigger.adding"),
          headerRight,
        }}
      />
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={keyboardBehavior}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-4 pb-10 gap-5"
          keyboardShouldPersistTaps="handled"
        >
          {/* Kind — locking on edit (no in-place kind swap, matches web). */}
          {!isEdit ? (
            <View className="gap-1.5">
              <FieldLabel
                icon="flash-outline"
                text={t("autopilots.trigger.kind")}
              />
              <View className="flex-row gap-2">
                {(
                  [
                    ["schedule", "autopilots.triggerKind.schedule"],
                    ["webhook", "autopilots.triggerKind.webhook"],
                  ] as const
                ).map(([value, labelKey]) => (
                  <Pressable
                    key={value}
                    onPress={() => setKind(value)}
                    disabled={isSubmitting}
                    className={cn(
                      "flex-1 rounded-lg border px-2 py-2.5 items-center",
                      kind === value
                        ? "border-primary/60 bg-primary/10"
                        : "border-border bg-secondary/50",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-sm",
                        kind === value
                          ? "text-foreground font-medium"
                          : "text-muted-foreground",
                      )}
                    >
                      {t(labelKey)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {/* Schedule fields — full ScheduleEditor (structured at/every/weekly/
              monthly + advanced raw cron + next-runs preview; timezone is
              inside the editor, matching web's AddScheduleTriggerDialog). */}
          {kind === "schedule" ? (
            <View className="gap-3">
              <ScheduleEditor
                value={schedule}
                onChange={setSchedule}
                wsId={wsId ?? ""}
                disabled={isSubmitting}
                onValidityChange={setScheduleValid}
              />
            </View>
          ) : null}

          {/* Event filters — webhook only, both create and edit. */}
          {kind === "webhook" ? (
            <EventFilterEditor
              filters={eventFilters}
              onChange={setEventFilters}
              editable={!isSubmitting}
            />
          ) : null}

          {/* Label / enabled — edit only (new triggers start defaulted). */}
          {isEdit ? (
            <>
              <View className="gap-1.5">
                <FieldLabel
                  icon="pricetag-outline"
                  text={t("autopilots.trigger.label")}
                />
                <TextField
                  value={label}
                  onChangeText={setLabel}
                  placeholder={t("autopilots.trigger.labelPlaceholder")}
                  editable={!isSubmitting}
                />
              </View>
              <View className="flex-row items-center justify-between rounded-md border border-border bg-secondary/50 px-3 py-2.5">
                <Text className="text-sm text-foreground">
                  {t("autopilots.trigger.enabled")}
                </Text>
                <Switch
                  value={enabled}
                  onValueChange={setEnabled}
                  disabled={isSubmitting}
                />
              </View>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function FieldLabel({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="flex-row items-center gap-1.5">
      <Ionicons
        name={icon}
        size={13}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {text}
      </Text>
    </View>
  );
}