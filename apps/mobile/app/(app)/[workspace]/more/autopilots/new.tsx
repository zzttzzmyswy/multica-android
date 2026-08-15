/**
 * New-autopilot creation form (push screen). Fields follow web
 * `packages/views/autopilots/components/autopilot-dialog.tsx` semantics:
 * name, optional description, executing agent, execution mode, and an
 * initial trigger (schedule cron+timezone, webhook, or none — manual).
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
 * no event filters (v1 mobile — accept-all). Non-runtime-bound agents are
 * shown but disabled in the picker (matches the chat sheet); the server is
 * the real gate.
 */
import { useCallback, useState } from "react";
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { Stack, router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { AutopilotExecutionMode } from "@multica/core/types";
import { buildAutopilotWebhookUrl } from "@multica/core/autopilots/webhook";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { TextField } from "@/components/ui/text-field";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AgentPickerSheet } from "@/components/chat/agent-picker-sheet";
import { TimezonePickerSheet } from "@/components/autopilot/timezone-picker-sheet";
import { api } from "@/data/api";
import { agentListOptions } from "@/data/queries/agents";
import { useCreateAutopilot, useCreateAutopilotTrigger } from "@/data/mutations/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import { getApiBaseUrl } from "@/data/server-config";
import { buildTriggerCreate, probeSchedule } from "@/lib/autopilot-trigger-form";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

type TriggerChoice = "none" | "schedule" | "webhook";

const MODE_OPTIONS: { value: AutopilotExecutionMode; labelKey: string }[] = [
  { value: "create_issue", labelKey: "autopilots.executionMode.createIssue" },
  { value: "run_only", labelKey: "autopilots.executionMode.runOnly" },
];

export default function NewAutopilotPage() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [executionMode, setExecutionMode] =
    useState<AutopilotExecutionMode>("create_issue");
  const [triggerKind, setTriggerKind] = useState<TriggerChoice>("none");
  const [cronExpression, setCronExpression] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [tzPickerOpen, setTzPickerOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const createAutopilot = useCreateAutopilot();
  const createTrigger = useCreateAutopilotTrigger();

  const nameMissing = title.trim().length === 0;
  const agentMissing = assigneeId === null;
  const isSubmitting = createAutopilot.isPending || createTrigger.isPending;

  const selectedAgent = agents.find((a) => a.id === assigneeId) ?? null;

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    if (nameMissing || agentMissing) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
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
      const autopilot = await createAutopilot.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        assignee_type: "agent",
        assignee_id: assigneeId as string,
        execution_mode: executionMode,
      });

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
                })
              : buildTriggerCreate({
                  kind: "webhook",
                  cronExpression: "",
                  timezone: "",
                  label: "",
                  enabled: true,
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
  }, [
    isSubmitting,
    nameMissing,
    agentMissing,
    triggerKind,
    cronExpression,
    timezone,
    title,
    description,
    assigneeId,
    executionMode,
    wsSlug,
    createAutopilot,
    createTrigger,
    t,
  ]);

  const headerRight = useCallback(
    () => (
      <Button
        size="sm"
        disabled={isSubmitting}
        onPress={() => void handleSubmit()}
      >
        <Text>
          {isSubmitting
            ? t("autopilots.new.creating")
            : t("autopilots.new.create")}
        </Text>
      </Button>
    ),
    [isSubmitting, handleSubmit, t],
  );

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={keyboardBehavior}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-4 pb-10 gap-5"
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <View className="gap-1.5">
            <FieldLabel icon="pricetag-outline" text={t("autopilots.new.name")} />
            <TextField
              value={title}
              onChangeText={setTitle}
              placeholder={t("autopilots.new.namePlaceholder")}
              invalid={showErrors && nameMissing}
              editable={!isSubmitting}
              autoFocus
            />
            {showErrors && nameMissing ? (
              <FieldError text={t("autopilots.new.nameRequired")} />
            ) : null}
          </View>

          {/* Description */}
          <View className="gap-1.5">
            <FieldLabel
              icon="document-text-outline"
              text={t("autopilots.new.description")}
            />
            <AutosizeTextArea
              value={description}
              onChangeText={setDescription}
              placeholder={t("autopilots.new.descriptionPlaceholder")}
              editable={!isSubmitting}
              className="border border-border rounded-md px-3 py-2 min-h-[72px]"
            />
          </View>

          {/* Agent */}
          <View className="gap-1.5">
            <FieldLabel icon="person-outline" text={t("autopilots.new.agent")} />
            {agents.length === 0 ? (
              <View className="rounded-md border border-border px-3 py-3">
                <Text className="text-sm text-muted-foreground">
                  {t("autopilots.new.agentsEmpty")}
                </Text>
              </View>
            ) : (
              <>
                <Pressable
                  onPress={() => setAgentPickerOpen(true)}
                  disabled={isSubmitting}
                  accessibilityLabel={t("autopilots.new.selectAgent")}
                  className={cn(
                    "flex-row items-center gap-2.5 rounded-md border px-3 py-2.5",
                    showErrors && agentMissing
                      ? "border-destructive/60 bg-destructive/10"
                      : "border-border bg-secondary/50",
                  )}
                >
                  {selectedAgent ? (
                    <>
                      <ActorAvatar type="agent" id={selectedAgent.id} size={28} />
                      <Text className="flex-1 text-sm text-foreground">
                        {selectedAgent.name}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={muted} />
                    </>
                  ) : (
                    <>
                      <Text
                        className={cn(
                          "flex-1 text-sm",
                          showErrors && agentMissing
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {t("autopilots.new.selectAgent")}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={muted} />
                    </>
                  )}
                </Pressable>
                {showErrors && agentMissing ? (
                  <FieldError text={t("autopilots.new.agentRequired")} />
                ) : null}
                <AgentPickerSheet
                  visible={agentPickerOpen}
                  agents={agents}
                  currentAgentId={assigneeId}
                  onPick={(agent) => setAssigneeId(agent.id)}
                  onClose={() => setAgentPickerOpen(false)}
                />
              </>
            )}
          </View>

          {/* Execution mode */}
          <View className="gap-1.5">
            <FieldLabel icon="git-branch-outline" text={t("autopilots.new.mode")} />
            <ModeSelector
              value={executionMode}
              onChange={setExecutionMode}
              disabled={isSubmitting}
              t={t}
            />
          </View>

          {/* Trigger */}
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
              <Text className="text-xs text-muted-foreground/80 mt-1">
                {t("autopilots.new.webhookHint")}
              </Text>
            ) : null}
          </View>
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

function FieldError({ text }: { text: string }) {
  return (
    <Text className="text-xs text-destructive">{text}</Text>
  );
}

function ModeSelector({
  value,
  onChange,
  disabled,
  t,
}: {
  value: AutopilotExecutionMode;
  onChange: (mode: AutopilotExecutionMode) => void;
  disabled: boolean;
  t: (id: string) => string;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as AutopilotExecutionMode)}
    >
      {MODE_OPTIONS.map((opt) => (
        <Pressable
          key={opt.value}
          onPress={() => onChange(opt.value)}
          disabled={disabled}
          className="flex-row items-center gap-2.5 px-1 py-0.5"
        >
          <RadioGroupItem
            value={opt.value}
            aria-label={t(opt.labelKey)}
            disabled={disabled}
          />
          <Text className="text-sm text-foreground">{t(opt.labelKey)}</Text>
        </Pressable>
      ))}
    </RadioGroup>
  );
}