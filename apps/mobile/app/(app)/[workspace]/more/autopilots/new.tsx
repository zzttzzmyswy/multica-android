/**
 * New-autopilot creation form (push screen). Body is the shared AutopilotForm
 * (title / description / assignee agent+squad / execution mode / project /
 * subscribers); the trigger section is injected below it as children and is
 * create-only.
 *
 * Submit order mirrors web: the schedule is probed against the server's
 * cron-preview BEFORE the autopilot is created (a rejected expression must
 * not persist an autopilot whose trigger can never fire), then POST
 * autopilot, then POST the trigger if one was chosen. A webhook trigger's
 * freshly minted URL is surfaced once, right after creation (it is the only
 * time the caller sees the full URL; the detail page masks it).
 *
 * Mobile divergence: native Alert.alert is the feedback channel (no
 * toast infra on mobile — see issue/[id].tsx), and webhook creation keeps
 * no event filters (v1 mobile — accept-all). Non-runtime-bound agents/squads
 * are shown but disabled in the picker; the server is the real gate.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { WebhookEventFilter } from "@multica/core/types";
import { buildAutopilotWebhookUrl } from "@multica/core/autopilots/webhook";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { EventFilterEditor } from "@/components/autopilot/event-filter-editor";
import {
  ScheduleEditor,
} from "@/components/autopilot/schedule-editor";
import {
  AutopilotForm,
  type AutopilotFormHandle,
} from "@/components/autopilot/autopilot-form";
import { api } from "@/data/api";
import { useCreateAutopilot, useCreateAutopilotTrigger } from "@/data/mutations/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import { getApiBaseUrl } from "@/data/server-config";
import { buildTriggerCreate, probeSchedule } from "@/lib/autopilot-trigger-form";
import { getDefaultScheduleConfig } from "@/lib/schedule-editor-model";
import type { ScheduleConfig } from "@/lib/schedule-editor-model";
import { parseCron, toCron } from "@/lib/schedule-editor-cron";
import {
  AUTOPILOT_TEMPLATES,
  isTemplateId,
  templateScheduleToCron,
} from "@/lib/autopilot-templates";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  buildCreateAutopilotRequest,
  type AutopilotFormValues,
} from "@/lib/autopilot-form-values";

type TriggerChoice = "none" | "schedule" | "webhook";

export default function NewAutopilotPage() {
  const { t } = useTranslation();
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  // Empty-state quick-start prefill: `?template=<id>` (list page template
  // cards) fills title / prompt / a schedule trigger; unknown ids fall back
  // to a blank create form (never a crash).
  const { template: templateParam } = useLocalSearchParams<{
    template?: string;
  }>();
  const template = useMemo(() => {
    const raw = Array.isArray(templateParam) ? templateParam[0] : templateParam;
    if (!isTemplateId(raw)) return null;
    return AUTOPILOT_TEMPLATES.find((tpl) => tpl.id === raw) ?? null;
  }, [templateParam]);

  const formRef = useRef<AutopilotFormHandle>(null);
  const [triggerKind, setTriggerKind] = useState<TriggerChoice>(
    template ? "schedule" : "none",
  );
  // Structured schedule state for the ScheduleEditor. A template prefill is a
  // cron expression — hydrate it back into the model (raw stays set when the
  // template's schedule is beyond the model, e.g. weekdays-only).
  const [schedule, setSchedule] = useState<ScheduleConfig>(() => {
    const cron = template ? (templateScheduleToCron(template.schedule) ?? "") : "";
    return cron ? parseCron(cron, "Asia/Shanghai") : getDefaultScheduleConfig("Asia/Shanghai");
  });
  const [scheduleValid, setScheduleValid] = useState(true);
  const [eventFilters, setEventFilters] = useState<WebhookEventFilter[]>([]);

  const createAutopilot = useCreateAutopilot();
  const createTrigger = useCreateAutopilotTrigger();
  const isSubmitting = createAutopilot.isPending || createTrigger.isPending;

  const handleSubmit = useCallback(
    async (values: AutopilotFormValues) => {
      if (isSubmitting) return;
      try {
        const scheduleChosen = triggerKind === "schedule";
        // The ScheduleEditor always has a value; this guards the (impossible)
        // empty-raw edge rather than the happy path.
        const cronExpression = schedule.raw === null ? toCron(schedule) : schedule.raw;
        if (scheduleChosen && cronExpression.trim().length === 0) {
          Alert.alert(
            t("autopilots.trigger.scheduleInvalidTitle"),
            t("autopilots.trigger.cronRequired"),
          );
          return;
        }
        if (scheduleChosen) {
          const rejection = await probeSchedule(
            (params) => api.cronPreview(params),
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
        const autopilot = await createAutopilot.mutateAsync(
          buildCreateAutopilotRequest(values),
        );

        let createdWebhookUrl: string | null = null;
        let triggerFailed: string | null = null;
        if (triggerKind !== "none") {
          try {
            const trigger = await createTrigger.mutateAsync({
              autopilotId: autopilot.id,
              ...(scheduleChosen
                ? buildTriggerCreate({
                    kind: "schedule",
                    cronExpression,
                    timezone: schedule.timezone,
                    label: "",
                    enabled: true,
                    eventFilters: [],
                  })
                : buildTriggerCreate({
                    kind: "webhook",
                    cronExpression: "",
                    timezone: "",
                    label: "",
                    enabled: true,
                    eventFilters,
                  })),
            });
            if (triggerKind === "webhook") {
              createdWebhookUrl = buildAutopilotWebhookUrl({
                trigger,
                apiBaseUrl: getApiBaseUrl(),
              });
            }
          } catch (err) {
            triggerFailed =
              err instanceof Error ? err.message : t("common.unknownError");
          }
        }

        if (wsSlug) {
          router.replace(`/${wsSlug}/more/autopilots/${autopilot.id}`);
        }
        if (createdWebhookUrl) {
          // Surfaced once — the detail page masks the token afterwards.
          Alert.alert(
            t("autopilots.trigger.rotatedTitle"),
            createdWebhookUrl,
            [
              {
                text: t("autopilots.trigger.copyUrl"),
                onPress: () => {
                  void Clipboard.setStringAsync(createdWebhookUrl as string);
                },
              },
              { text: t("common.done"), style: "default" },
            ],
          );
        } else if (triggerFailed) {
          Alert.alert(t("autopilots.new.triggerFailedTitle"), triggerFailed);
        }
      } catch (err) {
        Alert.alert(
          t("autopilots.new.failedTitle"),
          err instanceof Error ? err.message : t("common.unknownError"),
        );
      }
    },
    [
      isSubmitting,
      triggerKind,
      schedule,
      eventFilters,
      wsSlug,
      createAutopilot,
      createTrigger,
      t,
    ],
  );

  const headerRight = useCallback(
    () => (
      <Button
        size="sm"
        disabled={isSubmitting || (triggerKind === "schedule" && !scheduleValid)}
        onPress={() => formRef.current?.submit()}
      >
        <Text>
          {isSubmitting
            ? t("autopilots.new.creating")
            : t("autopilots.new.create")}
        </Text>
      </Button>
    ),
    [isSubmitting, triggerKind, scheduleValid, t],
  );

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <AutopilotForm
        ref={formRef}
        mode="create"
        initial={{
          title: template
            ? t(`autopilots.templates.${template.id}.title`)
            : "",
          description: template?.prompt ?? "",
          projectId: null,
          assigneeType: "agent",
          assigneeId: "",
          executionMode: "create_issue",
          subscriberUserIds: [],
        }}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit}
      >
        {/* Trigger (create-only). */}
        <View className="gap-1.5">
          <FieldLabel icon="flash-outline" text={t("autopilots.new.trigger")} />
          <View className="flex-row gap-2">
            {(
              [
                ["none", "autopilots.new.noTrigger"],
                ["schedule", "autopilots.triggerKind.schedule"],
                ["webhook", "autopilots.triggerKind.webhook"],
              ] as const
            ).map(([value, labelKey]) => (
              <Pressable
                key={value}
                onPress={() => setTriggerKind(value)}
                disabled={isSubmitting}
                className={cn(
                  "flex-1 rounded-lg border px-2 py-2.5 items-center",
                  triggerKind === value
                    ? "border-primary/60 bg-primary/10"
                    : "border-border bg-secondary/50",
                )}
              >
                <Text
                  className={cn(
                    "text-sm",
                    triggerKind === value
                      ? "text-foreground font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {t(labelKey)}
                </Text>
              </Pressable>
            ))}
          </View>

          {triggerKind === "schedule" ? (
            <View className="mt-2">
              <ScheduleEditor
                value={schedule}
                onChange={setSchedule}
                wsId={wsId ?? ""}
                disabled={isSubmitting}
                onValidityChange={setScheduleValid}
              />
            </View>
          ) : null}

          {triggerKind === "webhook" ? (
            <View className="mt-2">
              <EventFilterEditor
                filters={eventFilters}
                onChange={setEventFilters}
                editable={!isSubmitting}
              />
            </View>
          ) : null}
        </View>
      </AutopilotForm>
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