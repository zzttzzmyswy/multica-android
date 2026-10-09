/**
 * "Wakeups" in the issue header block (MYS-2023 reads, MYS-2031 writes) — the
 * rules this issue is waiting on, and the controls that act on them. Mirrors
 * web's `packages/views/issues/components/wakeups-section.tsx`.
 *
 * Why this exists on the phone: the wakeup subsystem was at zero on mobile. A
 * phone user could not see that an issue was waiting on anything, even though
 * the live workspace already had 125 rules and 1947 wakeup events written.
 *
 * MYS-2023 shipped the read half and said the write half was its own round.
 * This is that round: each row now carries the enable/disable control web
 * puts on it, plus a menu for "wake now" / "edit prompt" / "delete". A phone
 * user who sees "waiting for trigger" can finally stop it.
 *
 * The divergences from web, each deliberate:
 *   - The rule's prompt and trigger history expand INLINE under the row (with
 *     the control strip), rather than in a popover. A phone has no hover, and a
 *     nested popover over a scrolling FlashList is a fight with the scroll
 *     responder. The WRITE actions do open a sheet — an action list is
 *     `PickerSheet`'s existing job here — but the detail stays inline.
 *   - A flat block in the scrolling header rather than a sidebar section:
 *     mobile has no sidebar, so it sits beside `PullRequestList` and
 *     `QuickActionsSection`.
 *   - Every decision about WHICH control a row gets lives in
 *     `lib/wakeup-controls.ts`, not in this JSX, so it can be tested in the
 *     Node-only vitest lane and cannot drift from web's branch order.
 *
 * Renders null only when the issue is closed AND has nothing to show — an open
 * issue always shows the section. A closed issue with history keeps it, because
 * "why did this stop" is a question people ask after the fact (web's
 * `closed_hint` covers the copy).
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { AgentTask, IssueWakeup, SystemWakeup } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { Switch } from "@/components/ui/switch";
import { PickerSheet } from "@/components/issue/pickers/picker-sheet";
import {
  WakeupControl,
  WakeupRowSheet,
  wakeupBlockedTextKey,
} from "@/components/issue/wakeup-row-actions";
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
  useDisableIssueWakeup,
  useEnableIssueWakeup,
  useUpdateIssueSystemWakeup,
} from "@/data/mutations/issue-wakeups";
import {
  wakeupControlState,
  wakeupRunFacts,
  wakeupSystemInstructionErrorKey,
} from "@/lib/wakeup-controls";
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

/**
 * One rule people created: its control, its detail, and its own writes.
 *
 * The enable/disable hooks are bound HERE rather than at the section, so
 * `pending` belongs to this row: stopping one rule must not grey out every
 * other row's switch while the request is in flight.
 */
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const enable = useEnableIssueWakeup(wakeup.issue_id);
  const disable = useDisableIssueWakeup(wakeup.issue_id);
  const pending = enable.isPending || disable.isPending;

  const facts = wakeupRunFacts(wakeup, task);
  const control = wakeupControlState({
    wakeup,
    status: facts.status,
    startedAt: facts.startedAt,
    closed,
    pending,
  });
  const blockedKey = wakeupBlockedTextKey(control.blocked);

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
      <View className="flex-row items-center gap-1.5 py-1">
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={wakeupTrigger(text, wakeup)}
          className="flex-1 min-w-0 flex-row items-start gap-2 active:opacity-70"
        >
          <View className="mt-0.5">
            <ActorAvatar type="agent" id={wakeup.agent_id} size={16} />
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
            {/* Why the control above is inert. Without it a blocked control is
                a button that does nothing, which is indistinguishable from a
                broken one. */}
            {blockedKey ? (
              <Text className="text-[10px] text-muted-foreground">
                {t(blockedKey)}
              </Text>
            ) : null}
          </View>
        </Pressable>

        <WakeupControl
          wakeup={wakeup}
          control={control}
          pending={pending}
          onDisable={() => disable.mutate(wakeup.id)}
          onEnable={(input) => {
            // The fence comes from the decision layer, not from `wakeup`:
            // `enableRevision` is non-null exactly when this control is
            // pressable, so there is no `?? 0` here to send web's 400.
            const revision = control.enableRevision;
            // Unreachable — `WakeupControl` only calls this on an enabled
            // control, which never has a null fence. It is written as a return
            // rather than a `?? 0` so that if that ever stops holding, the row
            // does nothing instead of sending a revision the server rejects.
            if (revision === null) return;
            enable.mutate({ id: wakeup.id, revision, ...input });
          }}
        />

        <Pressable
          onPress={() => setSheetOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("wakeups.menuTitle")}
          className="px-1 py-1 active:opacity-70"
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={14}
            color={theme.mutedForeground}
          />
        </Pressable>
      </View>

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

      {/* Mounted only while open: the editor inside keeps a draft, and a draft
          left behind a closed sheet would be keyed to a rule the user may have
          just deleted. */}
      {sheetOpen ? (
        <WakeupRowSheet
          visible
          onClose={() => setSheetOpen(false)}
          wakeup={wakeup}
          // Web hides "wake now" on a rule the platform already switched off:
          // a withdrawn rule has no run left to fire.
          canTrigger={!closed && !wakeup.disabled_at}
        />
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

/**
 * The platform's child-done rule, shown beside the rules people created.
 *
 * MYS-2031 turned this row from a pure readout into web's row: a switch, and a
 * sheet with the instruction editor. Two things web does that this does not:
 *   - web sends the toggle as `{ enabled, instruction: rule.instruction }` and
 *     the editor as `{ enabled: rule.enabled, instruction }`. Both force the
 *     OTHER field back to the value the client last read, so a toggle tapped
 *     against a stale row silently reverts an instruction someone else typed.
 *     The server keeps an omitted field (`SystemWakeupInput`'s pointers), so
 *     each control here sends only what it changes.
 *   - web shows the workspace-default hint and the "skip when" explanation in a
 *     popover. A phone has no hover, so they sit in the sheet below the editor.
 */
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const update = useUpdateIssueSystemWakeup(rule.rule);
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
    <View className="flex-row items-center gap-2 py-1">
      <Pressable
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={title}
        className="flex-1 min-w-0 flex-row items-start gap-2 active:opacity-70"
      >
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
      </Pressable>

      <Switch
        checked={rule.enabled}
        disabled={update.isPending}
        accessibilityLabel={t("wakeups.system.toggle")}
        // Only `enabled` travels: an omitted field keeps its server value, so
        // the instruction cannot be reverted by a toggle from a stale row.
        onCheckedChange={(enabled) => update.mutate({ rule: rule.rule, enabled })}
      />

      {sheetOpen ? (
        <PickerSheet
          title={title}
          visible
          onClose={() => {
            if (!update.isPending) setSheetOpen(false);
          }}
        >
          <SystemWakeupDetail
            rule={rule}
            text={text}
            onSaved={() => setSheetOpen(false)}
          />
        </PickerSheet>
      ) : null}
    </View>
  );
}

/** The sheet body for a system rule: what it waits for, and its prompt editor. */
function SystemWakeupDetail({
  rule,
  text,
  onSaved,
}: {
  rule: SystemWakeup;
  text: WakeupTextDeps;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const paused = rule.paused_reason
    ? t("wakeups.system.paused", {
        reason:
          wakeupPausedText(text, {
            paused_reason: rule.paused_reason,
            max_fires: null,
            fire_count: 0,
          }) ?? "",
      })
    : null;

  if (editing) {
    return (
      <SystemInstructionEditor
        rule={rule}
        onSaved={onSaved}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <View className="px-4 pb-4">
      <DetailRow
        label={t("wakeups.system.targetTitle")}
        value={
          rule.target
            ? t("wakeups.system.targetCurrent", { name: rule.target.name })
            : t("wakeups.system.targetNone")
        }
      />
      <DetailRow
        label={t("wakeups.system.progressTitle")}
        value={`${t("wakeups.system.progress", {
          done: rule.total - rule.remaining,
          total: rule.total,
        })}${
          rule.waiting.length > 0
            ? ` · ${t("wakeups.system.waitingOn", { ids: rule.waiting.join(", ") })}`
            : ""
        }`}
      />
      <DetailRow
        label={t("wakeups.system.skipTitle")}
        value={t("wakeups.system.skip")}
      />
      <DetailRow
        label={t("wakeups.sourceTitle")}
        value={t("wakeups.system.source")}
      />
      {paused ? (
        <Text className="mt-1 text-xs text-amber-600 dark:text-amber-500">
          {paused}
        </Text>
      ) : null}

      <View className="mt-3 flex-row items-center justify-between gap-2">
        <Text className="text-xs font-medium text-foreground">
          {t("wakeups.system.instruction")}
        </Text>
        <Pressable
          onPress={() => setEditing(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("wakeups.system.instructionEdit")}
          className="active:opacity-70"
        >
          <Ionicons name="pencil" size={14} color={THEME.light.mutedForeground} />
        </Pressable>
      </View>
      {rule.instruction ? (
        <Text className="text-xs text-foreground">{rule.instruction}</Text>
      ) : (
        <View>
          <Text className="text-xs text-muted-foreground">
            {t("wakeups.system.instructionDefault")}
          </Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={4}>
            {rule.default_instruction}
          </Text>
        </View>
      )}

      <Text className="mt-3 text-[10px] text-muted-foreground">
        {rule.workspace_default
          ? t("wakeups.system.defaultOn")
          : t("wakeups.system.defaultOff")}
      </Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="mt-1.5">
      <Text className="text-[10px] text-muted-foreground">{label}</Text>
      <Text className="text-xs text-foreground">{value}</Text>
    </View>
  );
}

/**
 * The platform rule's prompt editor.
 *
 * An EMPTY value is valid here and means "follow the default" — the opposite of
 * a rule people created, where an empty prompt is a guaranteed 400. That is why
 * the check is `wakeupSystemInstructionErrorKey` rather than the shared one.
 *
 * Only `instruction` is sent, for the reason in `SystemWakeupRow`.
 */
function SystemInstructionEditor({
  rule,
  onSaved,
  onCancel,
}: {
  rule: SystemWakeup;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateIssueSystemWakeup(rule.rule);
  const [value, setValue] = useState(rule.instruction);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const unchanged = value.trim() === rule.instruction;

  const submit = () => {
    const invalid = wakeupSystemInstructionErrorKey(value);
    if (invalid) {
      setErrorKey(invalid);
      return;
    }
    setErrorKey(null);
    update.mutate(
      { rule: rule.rule, instruction: value.trim() },
      { onSuccess: onSaved },
    );
  };

  return (
    <View className="px-4 pb-4">
      <AutosizeTextArea
        value={value}
        minHeight={80}
        maxHeight={180}
        editable={!update.isPending}
        // The default is the placeholder, so an empty field shows what the run
        // would actually be told — web does the same (`instruction_placeholder`
        // falls back to `default_instruction`).
        placeholder={
          rule.default_instruction || t("wakeups.system.instructionPlaceholder")
        }
        accessibilityLabel={t("wakeups.system.instruction")}
        onChangeText={(next) => {
          setValue(next);
          setErrorKey(null);
        }}
        className="rounded-md border border-border bg-background p-2 text-sm text-foreground"
      />
      {errorKey ? (
        <Text className="mt-1 text-xs text-destructive">{t(errorKey)}</Text>
      ) : null}
      <View className="mt-3 flex-row justify-end gap-2">
        <Pressable
          onPress={onCancel}
          disabled={update.isPending}
          accessibilityRole="button"
          className="rounded-md border border-border px-3 py-2 active:bg-secondary"
        >
          <Text className="text-sm text-foreground">
            {t("wakeups.instructionCancel")}
          </Text>
        </Pressable>
        <Pressable
          onPress={submit}
          // An unchanged prompt is not a write — see the rule editor's twin.
          disabled={update.isPending || unchanged}
          accessibilityRole="button"
          className={`rounded-md bg-primary px-3 py-2 ${
            update.isPending || unchanged ? "opacity-50" : ""
          }`}
        >
          <Text className="text-sm font-medium text-primary-foreground">
            {update.isPending
              ? t("wakeups.instructionSaving")
              : t("wakeups.instructionSave")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
