/**
 * "Wakeups" in the issue header block (MYS-2023) — the rules this issue is
 * waiting on. Mirrors web's
 * `packages/views/issues/components/wakeups-section.tsx`.
 *
 * Why this exists on the phone: the wakeup subsystem was at zero on mobile. A
 * phone user could not see that an issue was waiting on anything, even though
 * the live workspace already had 125 rules and 1947 wakeup events written.
 *
 * READ-ONLY this round, and the divergences from web follow from that:
 *   - No create / enable / disable / trigger / delete controls. Web's row is a
 *     popover with four mutations behind it; this row is a disclosure, because
 *     a phone row that opens a form it cannot submit is worse than no form.
 *     See the issue for why the write surface is its own round.
 *   - A flat block in the scrolling header rather than a sidebar section:
 *     mobile has no sidebar, so it sits beside `PullRequestList` and
 *     `QuickActionsSection`.
 *   - The rule's prompt and trigger history expand INLINE under the row
 *     instead of in a popover. A phone has no hover, and a nested popover over
 *     a scrolling FlashList is a fight with the scroll responder.
 *
 * Renders null only when the issue is closed AND has no rules — an open issue
 * always shows the section when it is waiting on something. A closed issue
 * with history keeps it, because "why did this stop" is a question people ask
 * after the fact (web's `closed_hint` covers the copy).
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { AgentTask, IssueWakeup, SystemWakeup } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useTranslation } from "@/lib/i18n/react";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useStatusLabel } from "@/lib/status-options";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { issueTasksOptions } from "@/data/queries/issues";
import {
  issueWakeupsOptions,
  issueSystemWakeupsOptions,
  issueWakeupRunsOptions,
} from "@/data/queries/issue-wakeups";
import {
  isCurrentWakeup,
  wakeupRun,
  wakeupPausedText,
  wakeupRunStateText,
  formatWakeupTime,
  wakeupStateText,
  wakeupTrigger,
  type WakeupTextDeps,
} from "@/lib/wakeup-presentation";

interface Props {
  issueId: string;
  /** Whether the issue is completed/cancelled. A closed issue stops its rules
   *  server-side, so the section says so rather than implying otherwise. */
  closed?: boolean;
  /** Woken when the reader taps the header chip and we want the section in
   *  view. Optional: the section renders the same without it. */
  expanded?: boolean;
}

/** The `t` + catalog bundle every text helper in `wakeup-presentation` needs.
 *  Built once per render here and threaded down, so a row does not rebuild it. */
function useWakeupText(): WakeupTextDeps {
  const { t } = useTranslation();
  const statusLabel = useStatusLabel();
  const { getName } = useActorLookup();
  return {
    t,
    statusLabel,
    actorName: (type: string, id: string) => getName(type as "agent", id),
  };
}

export function WakeupsSection({ issueId, closed = false }: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const text = useWakeupText();
  const [open, setOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const {
    data: rules = [],
    isError,
    refetch,
  } = useQuery(issueWakeupsOptions(wsId, issueId));
  const { data: systemRules = [] } = useQuery(
    issueSystemWakeupsOptions(wsId, issueId),
  );
  // Issue tasks carry `wakeup_id`, the only link from a rule to its runs. The
  // issue detail already fetched this list, so on a warm cache this is free.
  const { data: tasks = [] } = useQuery(issueTasksOptions(wsId, issueId));

  const current = rules.filter((w) => isCurrentWakeup(w, wakeupRun(w, tasks)));
  const history = rules.filter((w) => !isCurrentWakeup(w, wakeupRun(w, tasks)));

  // A closed issue with nothing to show gains no row; an open one always shows
  // the section so its count is visible.
  if (closed && !rules.length && !systemRules.length && !isError) return null;

  const row = (wakeup: IssueWakeup) => (
    <WakeupRow
      key={wakeup.id}
      wakeup={wakeup}
      task={wakeupRun(wakeup, tasks)}
      text={text}
      closed={closed}
      expanded={expandedId === wakeup.id}
      onToggle={() =>
        setExpandedId((id) => (id === wakeup.id ? null : wakeup.id))
      }
    />
  );

  return (
    <View className="border-t border-border px-4 pt-2 pb-2">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${t("wakeups.title")}, ${current.length + systemRules.length}`}
        className="flex-row items-center gap-1.5 py-1 active:opacity-70"
      >
        <Ionicons
          name={open ? "chevron-down" : "chevron-forward"}
          size={12}
          color={theme.mutedForeground}
        />
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {t("wakeups.title")}
        </Text>
        <Text className="text-xs tabular-nums text-muted-foreground">
          {current.length + systemRules.length}
        </Text>
      </Pressable>

      {open ? (
        <View className="pt-0.5">
          {isError ? (
            <Pressable
              onPress={() => void refetch()}
              accessibilityRole="button"
              className="py-1 active:opacity-70"
            >
              <Text className="text-xs text-muted-foreground">
                {t("wakeups.retry")}
              </Text>
            </Pressable>
          ) : null}

          {closed ? (
            <Text className="py-1 text-xs text-muted-foreground">
              {t("wakeups.closedHint")}
            </Text>
          ) : null}

          {!closed
            ? systemRules.map((rule) => (
                <SystemWakeupRow key={rule.rule} rule={rule} text={text} />
              ))
            : null}

          {current.map(row)}

          {history.length > 0 ? (
            <>
              <Pressable
                onPress={() => setHistoryOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: historyOpen }}
                className="flex-row items-center gap-1.5 py-1 active:opacity-70"
              >
                <Ionicons
                  name={historyOpen ? "chevron-down" : "chevron-forward"}
                  size={12}
                  color={theme.mutedForeground}
                />
                <Text className="text-xs text-muted-foreground">
                  {t("wakeups.ended", { count: history.length })}
                </Text>
              </Pressable>
              {historyOpen ? history.map(row) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** One rule people created. Tap toggles the detail panel. */
function WakeupRow({
  wakeup,
  task,
  text,
  closed,
  expanded,
  onToggle,
}: {
  wakeup: IssueWakeup;
  task: AgentTask | undefined;
  text: WakeupTextDeps;
  closed: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const paused = wakeupPausedText(text, wakeup);
  const status = task?.status ?? wakeup.last_task_status;
  // A rule the platform paused, or one that failed, is the row a reader has to
  // act on — it reads in warning/destructive rather than the quiet default.
  const tone = paused
    ? "text-amber-600 dark:text-amber-500"
    : wakeup.last_error
      ? "text-destructive"
      : null;

  return (
    <View className="py-0.5">
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={wakeupTrigger(text, wakeup)}
        className="flex-row items-start gap-2 py-1 active:opacity-70"
      >
        <View className="mt-0.5">
          <ActorAvatar
            type="agent"
            id={wakeup.agent_id}
            size={16}
          />
        </View>
        <View className="flex-1 min-w-0">
          <Text className="text-xs text-foreground" numberOfLines={2}>
            {wakeupTrigger(text, wakeup)}
          </Text>
          {/* Second line: who is woken, and where the rule stands. The state
              is the fact the reader came for — "turned off" and "already
              fired" must not both read as "not running". */}
          <Text className="text-[10px] text-muted-foreground" numberOfLines={2}>
            {[
              t("wakeups.wakeAgent", { agent: wakeup.agent_name }),
              wakeupStateText(text, wakeup, closed),
              status ? wakeupRunStateText(text, status) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {paused ? (
            <Text className={`text-[10px] ${tone ?? ""}`}>{paused}</Text>
          ) : null}
          {/* A rule that errored needs attention; naming that beats a silent
              row that looks merely inactive. */}
          {wakeup.last_error ? (
            <Text className="text-[10px] text-destructive">
              {t("wakeups.needsAttention")}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name={expanded ? "chevron-down" : "chevron-forward"}
          size={12}
          color={theme.mutedForeground}
          style={{ marginTop: 4 }}
        />
      </Pressable>

      {expanded ? (
        <View className="pl-6 pb-1.5">
          <Text className="text-[10px] text-muted-foreground">
            {t("wakeups.instructionTitle")}
          </Text>
          <Text className="text-xs text-foreground">
            {wakeup.instruction || t("wakeups.noInstruction")}
          </Text>
          {wakeup.expires_at ? (
            <Text className="mt-1 text-[10px] text-muted-foreground">
              {t("wakeups.expiryTitle")}:{" "}
              {t("wakeups.expiryAt", {
                time: formatWakeupTime(wakeup.expires_at),
              })}
            </Text>
          ) : null}
          <WakeupHistory wakeup={wakeup} text={text} />
        </View>
      ) : null}
    </View>
  );
}

/** A rule's latest runs: what fired, and what came of it. Fetched lazily —
 *  only a row the reader actually opened asks for its history. */
function WakeupHistory({
  wakeup,
  text,
}: {
  wakeup: IssueWakeup;
  text: WakeupTextDeps;
}) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: runs, isError } = useQuery(
    issueWakeupRunsOptions(wsId, wakeup.issue_id, wakeup.id),
  );
  return (
    <View className="mt-1.5">
      <Text className="text-[10px] text-muted-foreground">
        {t("wakeups.historyTitle")}
      </Text>
      {isError ? (
        <Text className="text-[10px] text-muted-foreground">
          {t("wakeups.historyError")}
        </Text>
      ) : runs && runs.length === 0 ? (
        <Text className="text-[10px] text-muted-foreground">
          {t("wakeups.historyEmpty")}
        </Text>
      ) : (
        (runs ?? []).map((run) => (
          <Text key={run.id} className="text-[10px] text-muted-foreground">
            {run.checkin_note
              ? t("wakeups.runCheckin", { note: run.checkin_note })
              : wakeupRunStateText(text, run.status)}
          </Text>
        ))
      )}
    </View>
  );
}

/** The platform's child-done rule, shown beside the rules people created.
 *  Read-only here: web hangs a switch and an instruction editor off this row,
 *  and both are writes. */
function SystemWakeupRow({
  rule,
  text,
}: {
  rule: SystemWakeup;
  text: WakeupTextDeps;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const title =
    rule.staged && rule.stage !== null
      ? t("wakeups.system.titleStage", { stage: rule.stage })
      : t("wakeups.system.titleAll");
  // A rule that cannot run right now says WHY — "no assignee" and "in backlog"
  // are different facts, and the second one resolves itself.
  const blocked = rule.blocked
    ? t(`wakeups.system.blocked${
        rule.blocked === "backlog"
          ? "Backlog"
          : rule.blocked === "member_assignee"
            ? "Member"
            : "None"
      }`)
    : null;
  const summary = !rule.enabled
    ? t("wakeups.system.turnedOff")
    : (blocked ??
      [
        rule.target
          ? t("wakeups.system.wakeAssignee", { name: rule.target.name })
          : null,
        t("wakeups.system.remaining", { count: rule.remaining }),
      ]
        .filter(Boolean)
        .join(" · "));

  return (
    <View className="flex-row items-start gap-2 py-1">
      <Ionicons
        name="git-branch-outline"
        size={14}
        color={theme.mutedForeground}
        style={{ marginTop: 1 }}
      />
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-1.5">
          <Text className="text-xs text-foreground" numberOfLines={2}>
            {title}
          </Text>
          <View className="rounded bg-secondary px-1">
            <Text className="text-[10px] text-muted-foreground">
              {t("wakeups.system.badge")}
            </Text>
          </View>
        </View>
        <Text className="text-[10px] text-muted-foreground" numberOfLines={2}>
          {summary}
        </Text>
      </View>
    </View>
  );
}
