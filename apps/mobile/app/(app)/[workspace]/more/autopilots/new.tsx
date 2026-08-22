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
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Stack, router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { WebhookEventFilter } from "@multica/core/types";
import { buildAutopilotWebhookUrl } from "@multica/core/autopilots/webhook";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { EventFilterEditor } from "@/components/autopilot/event-filter-editor";
import { TimezonePickerSheet } from "@/components/autopilot/timezone-picker-sheet";
import {
  AutopilotForm,
  type AutopilotFormHandle,
} from "@/components/autopilot/autopilot-form";
import { api } from "@/data/api";
import { useCreateAutopilot, useCreateAutopilotTrigger } from "@/data/mutations/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import { getApiBaseUrl } from "@/data/server-config";
import { buildTriggerCreate, probeSchedule } from "@/lib/autopilot-trigger-form";
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
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const formRef = useRef<AutopilotFormHandle>(null);
  const [triggerKind, setTriggerKind] = useState<TriggerChoice>("none");
  const [cronExpression, setCronExpression] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [eventFilters, setEventFilters] = useState<WebhookEventFilter[]>([]);
  const [tzPickerOpen, setTzPickerOpen] = useState(false);

  const createAutopilot = useCreateAutopilot();
  const createTrigger = useCreateAutopilotTrigger();
  const isSubmitting = createAutopilot.isPending || createTrigger.isPending;

  const handleSubmit = useCallback(
    async (values: AutopilotFormValues) => {
      if (isSubmitting) return;
      try {
        const scheduleChosen = triggerKind === "schedule";
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
            timezone.trim(),
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
                    timezone,
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
      cronExpression,
      timezone,
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
        disabled={isSubmitting}
        onPress={() => formRef.current?.submit()}
      >
        <Text>
          {isSubmitting
            ? t("autopilots.new.creating")
            : t("autopilots.new.create")}
        </Text>
      </Button>
    ),
    [isSubmitting, t],
  );

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <AutopilotForm
        ref={formRef}
        mode="create"
        initial={{
          title: "",
          description: "",
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
            <View className="mt-2 gap-3">
              <View className="gap-1.5">
                <FieldLabel
                  icon="time-outline"
                  text={t("autopilots.trigger.cron")}
                />
                <TextField
                  value={cronExpression}
                  onChangeText={setCronExpression}
                  placeholder={t("autopilots.trigger.cronPlaceholder")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isSubmitting}
                />
                <Text className="text-xs text-muted-foreground/80">
                  {t("autopilots.trigger.cronHint")}
                </Text>
              </View>
              <Pressable
                onPress={() => setTzPickerOpen(true)}
                disabled={isSubmitting}
                accessibilityLabel={t("autopilots.trigger.timezone")}
                className="flex-row items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2.5"
              >
                <Ionicons name="globe-outline" size={16} color={muted} />
                <Text className="flex-1 text-sm text-foreground">
                  {timezone}
                </Text>
                <Ionicons name="chevron-down" size={16} color={muted} />
              </Pressable>
              <TimezonePickerSheet
                visible={tzPickerOpen}
                value={timezone}
                onPick={setTimezone}
                onClose={() => setTzPickerOpen(false)}
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