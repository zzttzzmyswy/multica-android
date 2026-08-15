/**
 * Autopilot detail screen. Mirrors web
 * `packages/views/autopilots/components/autopilot-detail-page.tsx` semantics:
 *
 *  - Status switch (active ↔ paused) via PATCH status — optimistically
 *    patched in `useUpdateAutopilot`, authoritative server payload wins on
 *    settle. Archived autopilots disable the switch (can't resurrect).
 *  - "Run now" POSTs the trigger endpoint and branches the feedback on the
 *    run's DOMAIN status, not the HTTP 2xx — success is a whitelist
 *    (issue_created/running), anything else warns/errors with the localized
 *    reason_code message (autopilot-run-toast.ts, MUL-4525 parity).
 *  - Triggers: schedule rows show cron + tz + next run; webhook rows show a
 *    masked URL (maskAutopilotWebhookUrl — the token is the credential).
 *  - Run history: status/source/time/duration per row; rows with an
 *    issue_id link into the issue. Unknown statuses degrade to a neutral
 *    muted row, never a crash.
 *
 *  Divergence from web (mobile form factor): single-column card layout
 *  instead of the two-column grid; no create/edit/delete this round (see
 *  MYS-300 scope), so controls are status + run-now only. can_write absence
 *  is treated as allowed — the backend is the real gate (matches web).
 */
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AutopilotRun, AutopilotTrigger } from "@multica/core/types";
import { buildAutopilotWebhookUrl, maskAutopilotWebhookUrl } from "@multica/core/autopilots/webhook";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  autopilotDetailOptions,
  autopilotRunsOptions,
} from "@/data/queries/autopilots";
import { useUpdateAutopilot, useTriggerAutopilot } from "@/data/mutations/autopilots";
import { useActorLookup } from "@/data/use-actor-name";
import { useWorkspaceStore } from "@/data/workspace-store";
import { getApiBaseUrl } from "@/data/server-config";
import { formatDateTime } from "@/lib/autopilot-format";
import { formatElapsedMs } from "@/lib/format-elapsed";
import { runNowToastKind, runNowBlockedKey } from "@/lib/autopilot-run-toast";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

// Run status visual — mirrors web RUN_VISUAL. `running` rows spin their
// icon. Unknown statuses (server enum drift) fall through to a neutral
// muted row with the raw status text, never a crash. Colors are Tailwind
// palette hex (status-icon.tsx convention) so dark mode stays legible.
const RUN_VISUAL: Record<
  string,
  { className: string; color: string; icon: React.ComponentProps<typeof Ionicons>["name"] }
> = {
  issue_created: { className: "text-blue-500", color: "#3b82f6", icon: "time" },
  running: { className: "text-blue-500", color: "#3b82f6", icon: "sync" },
  skipped: { className: "text-muted-foreground", color: "#a1a1aa", icon: "ban" },
  completed: { className: "text-emerald-500", color: "#22c55e", icon: "checkmark-circle" },
  failed: { className: "text-destructive", color: "#ef4444", icon: "close-circle" },
};

function runVisual(status: string | undefined) {
  return (status && RUN_VISUAL[status]) || {
    className: "text-muted-foreground",
    color: THEME.light.mutedForeground as string,
    icon: "ellipse" as const,
  };
}

const TRIGGER_ICONS: Record<
  string,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  schedule: "calendar-outline",
  webhook: "link-outline",
  api: "code-slash-outline",
};

// execution_mode is server-driven; the i18n keys are camelCased by hand so
// an unknown future value must NOT be concatenated into a key — it falls
// through to the raw string (API Response Compatibility).
const EXECUTION_MODE_KEY: Record<string, string> = {
  create_issue: "createIssue",
  run_only: "runOnly",
};

export default function AutopilotDetailPage() {
  const { id } = useLocalSearchParams<{ id: string; workspace: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const detail = useQuery(autopilotDetailOptions(wsId, id));
  const runs = useQuery(autopilotRunsOptions(wsId, id, { limit: 20 }));
  const updateAutopilot = useUpdateAutopilot();
  const triggerAutopilot = useTriggerAutopilot();
  const { getName } = useActorLookup();

  const autopilot = detail.data?.autopilot;
  const triggers = detail.data?.triggers ?? [];
  const runList = runs.data ?? [];

  // Absent can_write (older server) is treated as allowed — matches web.
  const canWrite = autopilot?.can_write !== false;

  const handleToggleStatus = (checked: boolean) => {
    if (!id) return;
    updateAutopilot.mutate({ id, status: checked ? "active" : "paused" });
  };

  const handleRunNow = async () => {
    if (!id) return;
    try {
      const run = await triggerAutopilot.mutateAsync(id);
      if (runNowToastKind(run.status) === "success") {
        Alert.alert(t("autopilots.detail.toastTriggered"));
        return;
      }
      // Non-success outcome: localized reason by stable reason_code.
      Alert.alert(t(`autopilots.detail.${runNowBlockedKey(run.reason_code)}`));
    } catch (e) {
      Alert.alert(
        e instanceof Error ? e.message : t("autopilots.detail.toastTriggerFailed"),
      );
    }
  };

  if (detail.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!autopilot) {
    return (
      <View className="flex-1 items-center justify-center px-6 bg-background">
        <Text className="text-sm text-muted-foreground text-center">
          {t("autopilots.empty")}
        </Text>
      </View>
    );
  }

  const archived = autopilot.status === "archived";
  const runningNow = triggerAutopilot.isPending;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-8">
      {/* Status switch + run-now actions */}
      <View className="px-4 pt-3 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Switch
            checked={autopilot.status === "active"}
            onCheckedChange={handleToggleStatus}
            disabled={archived || !canWrite}
            accessibilityLabel={
              autopilot.status === "active"
                ? t("autopilots.detail.pauseAria")
                : t("autopilots.detail.activateAria")
            }
          />
          <Text className="text-sm text-muted-foreground">
            {autopilot.status === "active" ||
            autopilot.status === "paused" ||
            autopilot.status === "archived"
              ? t(`autopilots.status.${autopilot.status}`)
              : autopilot.status}
          </Text>
        </View>
        {canWrite ? (
          <Button
            size="sm"
            onPress={handleRunNow}
            disabled={autopilot.status !== "active" || runningNow}
            accessibilityLabel={
              runningNow
                ? t("autopilots.detail.runningLabel")
                : t("autopilots.detail.runNow")
            }
          >
            <Ionicons name="play" size={14} color={theme.primaryForeground} />
            <Text>
              {runningNow
                ? t("autopilots.detail.runningLabel")
                : t("autopilots.detail.runNow")}
            </Text>
          </Button>
        ) : null}
      </View>

      {/* Properties */}
      <SectionTitle>{t("autopilots.detail.properties")}</SectionTitle>
      <View className="px-4 gap-3">
        <PropertyRow label={t("autopilots.detail.fieldAssignee")} icon="person-outline">
          <Text className="text-sm text-foreground">
            {getName(autopilot.assignee_type, autopilot.assignee_id)}
          </Text>
        </PropertyRow>
        <PropertyRow label={t("autopilots.detail.fieldMode")} icon="git-branch-outline">
          <Text className="text-sm text-foreground">
            {EXECUTION_MODE_KEY[autopilot.execution_mode]
              ? t(`autopilots.executionMode.${EXECUTION_MODE_KEY[autopilot.execution_mode]}`)
              : autopilot.execution_mode}
          </Text>
        </PropertyRow>
        <PropertyRow label={t("autopilots.detail.fieldStatus")} icon="pulse-outline">
          <Text className="text-sm text-foreground">
            {autopilot.status === "active" ||
            autopilot.status === "paused" ||
            autopilot.status === "archived"
              ? t(`autopilots.status.${autopilot.status}`)
              : autopilot.status}
          </Text>
        </PropertyRow>
      </View>

      {/* Triggers */}
      <SectionTitle>{t("autopilots.detail.triggers")}</SectionTitle>
      <View className="px-4 gap-2">
        {triggers.length === 0 ? (
          <Text className="text-sm text-muted-foreground">
            {t("autopilots.detail.noTriggers")}
          </Text>
        ) : (
          triggers.map((trigger) => (
            <TriggerCard
              key={trigger.id}
              trigger={trigger}
              muted={theme.mutedForeground}
              t={t}
            />
          ))
        )}
      </View>

      {/* Run history */}
      <SectionTitle>{t("autopilots.detail.runHistory")}</SectionTitle>
      <View className="px-4 gap-2">
        {runList.length === 0 ? (
          <Text className="text-sm text-muted-foreground">
            {t("autopilots.detail.noRuns")}
          </Text>
        ) : (
          runList.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              wsSlug={wsSlug}
              theme={theme}
              t={t}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text className="px-4 pt-5 pb-2 text-xs uppercase tracking-wider text-muted-foreground font-medium">
      {children}
    </Text>
  );
}

function PropertyRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  children: React.ReactNode;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons
        name={icon}
        size={15}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="w-20 text-xs text-muted-foreground">{label}</Text>
      <View className="flex-1">{children}</View>
    </View>
  );
}

function TriggerCard({
  trigger,
  muted,
  t,
}: {
  trigger: AutopilotTrigger;
  muted: string;
  t: (id: string, params?: Record<string, string | number>) => string;
}) {
  const isWebhook = trigger.kind === "webhook";
  const webhookUrl = isWebhook
    ? buildAutopilotWebhookUrl({
        trigger,
        apiBaseUrl: getApiBaseUrl(),
      })
    : null;
  const icon = TRIGGER_ICONS[trigger.kind] ?? "flash-outline";
  const kindLabel =
    trigger.kind === "schedule" || trigger.kind === "webhook" || trigger.kind === "api"
      ? t(`autopilots.triggerKind.${trigger.kind}`)
      : trigger.kind;

  return (
    <View className="rounded-lg border border-border px-3 py-2.5">
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={15} color={muted} />
        <Text className="flex-1 text-sm font-medium text-foreground">
          {kindLabel}
        </Text>
        {!trigger.enabled ? (
          <Text className="text-[11px] text-muted-foreground">
            {t("autopilots.detail.triggerDisabled")}
          </Text>
        ) : null}
      </View>
      {trigger.kind === "schedule" && trigger.cron_expression ? (
        <View className="mt-1.5 ml-6 gap-0.5">
          <Text className="text-xs text-muted-foreground font-mono">
            {trigger.cron_expression}
            {trigger.timezone ? ` (${trigger.timezone})` : ""}
          </Text>
          {trigger.next_run_at ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name="time-outline" size={12} color={muted} />
              <Text className="text-xs text-muted-foreground tabular-nums">
                {t("autopilots.detail.scheduleNext", {
                  date: formatDateTime(trigger.next_run_at),
                })}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {webhookUrl ? (
        <Text
          className="mt-1.5 ml-6 text-xs text-muted-foreground"
          numberOfLines={1}
        >
          {maskAutopilotWebhookUrl(webhookUrl)}
        </Text>
      ) : null}
    </View>
  );
}

function RunRow({
  run,
  wsSlug,
  theme,
  t,
}: {
  run: AutopilotRun;
  wsSlug: string | null;
  theme: (typeof THEME)["light"];
  t: (id: string) => string;
}) {
  const visual = runVisual(run.status);
  const statusLabel =
    run.status === "issue_created" ||
    run.status === "running" ||
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "skipped"
      ? t(`autopilots.runStatus.${run.status}`)
      : run.status;
  const sourceLabel =
    run.source === "schedule" ||
    run.source === "manual" ||
    run.source === "webhook" ||
    run.source === "api"
      ? t(`autopilots.runSource.${run.source}`)
      : run.source;
  const startedAt = run.triggered_at || run.created_at;
  const hasIssue = Boolean(run.issue_id);

  const durationMs =
    run.completed_at && startedAt
      ? new Date(run.completed_at).getTime() - new Date(startedAt).getTime()
      : null;

  const content = (
    <View className="flex-row items-center gap-2 py-2">
      <Ionicons name={visual.icon} size={14} color={visual.color} />
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-2">
          <Text className={cn("text-xs font-medium", visual.className)}>
            {statusLabel}
          </Text>
          <Text className="text-xs text-muted-foreground">{sourceLabel}</Text>
          {hasIssue ? (
            <Ionicons
              name="open-outline"
              size={11}
              color={theme.mutedForeground}
            />
          ) : null}
        </View>
        {run.failure_reason ? (
          <Text className="text-xs text-destructive" numberOfLines={1}>
            {run.failure_reason}
          </Text>
        ) : null}
      </View>
      <View className="items-end shrink-0">
        <Text className="text-xs text-muted-foreground tabular-nums">
          {formatDateTime(startedAt)}
        </Text>
        {durationMs !== null ? (
          <View className="flex-row items-center gap-0.5">
            <Ionicons
              name="timer-outline"
              size={11}
              color={theme.mutedForeground}
            />
            <Text className="text-[11px] text-muted-foreground/70 tabular-nums">
              {formatElapsedMs(Math.max(0, durationMs))}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  if (hasIssue && wsSlug && run.issue_id) {
    return (
      <Pressable
        onPress={() => router.push(`/${wsSlug}/issue/${run.issue_id}`)}
        className="active:bg-secondary rounded-lg border border-border px-3"
      >
        {content}
      </Pressable>
    );
  }
  return <View className="rounded-lg border border-border px-3">{content}</View>;
}