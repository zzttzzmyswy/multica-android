/**
 * Comment trigger-preview chips — mobile RN adaptation of web
 * `packages/views/issues/components/comment-trigger-chips.tsx`.
 *
 * Shows under the composer what posting the current draft would trigger:
 *   - ONE agent  → avatar + presence dot + "Will start when sent" chip;
 *                  tap skips it (dimmed).
 *   - SEVERAL    → overlapping avatar stack + count sentence; tap opens an
 *                  inline panel with one tappable row per agent.
 *   - Blocked @mentions → ⚠ + name + short reason (non-interactive).
 *
 * Because RN has no hover/tooltip, the web tooltip body (who · why · presence
 * · click hint) is folded into the multi-panel rows and accessibility labels
 * instead. Suppression is communicated by brightness alone, like web: lit =
 * will trigger, dimmed = skipped.
 *
 * Behavioral parity is the web-side source of truth; the labels copy their
 * i18n keys exactly (comment.trigger_*).
 */
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommentTriggerOutcome, CommentTriggerPreviewAgent } from "@multica/core/types";
import type { AgentPresenceDetail } from "@multica/core/agents";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useTranslation } from "@/lib/i18n/react";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useWorkspacePresenceMap } from "@/lib/use-agent-presence";
import { cn } from "@/lib/utils";
import {
  blockedShortReasonLabel,
  countWillTrigger,
  emptyTriggerPreview,
  mentionLabelsByTarget,
  sourceLabel,
  sourceReason,
  type TriggerLabelT,
} from "@/lib/comment-trigger-preview";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";
import type { RecipientAction } from "@/lib/recipient-routing";
import type { RecipientEntry } from "@/lib/use-recipient-routing";

const AVATAR_SIZE = 16;
const MAX_STACK_HEADS = 4;

interface CommentTriggerChipsProps {
  agents: CommentTriggerPreviewAgent[];
  /** Explicit @agent / @squad mentions that will NOT trigger if posted as-is
   *  (MUL-4525 §2). Each renders as a named warning chip. */
  blocked?: CommentTriggerOutcome[];
  /** The draft markdown, used only to label each blocked target with the name
   *  the user typed in its mention markup. The server omits blocked target
   *  names (enumeration-safety); this is the user's own text. */
  draftContent?: string;
  /**
   * Per-recipient routing (iteration 298). When supplied, each chip says what
   * Send will actually do to that recipient and opens a menu of the actions
   * its live run allows — steer the running turn, start after it, stop it and
   * start over, or skip.
   *
   * Omitting the prop keeps the old binary behaviour (tap = skip), which is
   * what a caller that has no task list to consult should get: offering
   * "add to current run" without knowing whether a run exists would be a menu
   * of lies.
   */
  recipients?: RecipientEntry[];
  onActionChange?: (agentId: string, action: RecipientAction) => void;
  /** Agents the user skipped. Ignored when `recipients` is supplied — the
   *  action list already says "skip" for them. */
  suppressedAgentIds?: Set<string>;
  onToggle?: (agentId: string) => void;
}

export function CommentTriggerChips({
  agents,
  blocked = [],
  draftContent = "",
  recipients,
  onActionChange,
  suppressedAgentIds,
  onToggle,
}: CommentTriggerChipsProps) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { byAgent } = useWorkspacePresenceMap(wsId);
  const blockedLabels = useMemo(() => mentionLabelsByTarget(draftContent), [draftContent]);

  // Loading and errors render nothing: the preview is an enhancement, and any
  // interim chrome here reads as composer noise.
  if (emptyTriggerPreview(agents, blocked)) return null;

  // Routing mode: every recipient carries an action, so the chip can state what
  // Send will do and offer the alternatives its live run allows. Without it a
  // tap can only mean "skip", which is the defect this closes.
  if (recipients && onActionChange) {
    const allowed = (
      <RoutedTriggerChips
        recipients={recipients}
        byPresence={byAgent}
        onActionChange={onActionChange}
        t={t}
      />
    );
    if (blocked.length === 0) return allowed;
    return (
      <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
        {allowed}
        {blocked.map((outcome) => (
          <BlockedTriggerChip
            key={`${outcome.target_type}:${outcome.target_id}`}
            outcome={outcome}
            label={blockedLabels.get(`${outcome.target_type}:${outcome.target_id}`)}
            t={t}
          />
        ))}
      </View>
    );
  }

  // Legacy binary mode (no task list to consult): tap = skip.
  const suppressed = suppressedAgentIds ?? EMPTY_SUPPRESSED;
  const toggle = onToggle ?? (() => {});
  const allowed =
    agents.length === 1 ? (
      <SingleTriggerChip
        agent={agents[0]!}
        presence={byAgent.get(agents[0]!.id)}
        suppressed={suppressed.has(agents[0]!.id)}
        onToggle={toggle}
        t={t}
      />
    ) : agents.length > 1 ? (
      <MultiTriggerChip
        agents={agents}
        byPresence={byAgent}
        suppressedAgentIds={suppressed}
        onToggle={toggle}
        t={t}
      />
    ) : null;

  if (blocked.length === 0) return allowed;

  return (
    <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
      {allowed}
      {blocked.map((outcome) => (
        <BlockedTriggerChip
          key={`${outcome.target_type}:${outcome.target_id}`}
          outcome={outcome}
          label={blockedLabels.get(`${outcome.target_type}:${outcome.target_id}`)}
          t={t}
        />
      ))}
    </View>
  );
}

const EMPTY_SUPPRESSED: Set<string> = new Set();
/** `openId` value meaning "the per-agent chooser is showing" — not an agent id. */
const LIST_OPEN = "\u0000list";

/** The recipient's live-run state, in the words web uses for it. */
function recipientStateLabel(state: RecipientEntry["state"], t: TriggerLabelT): string | null {
  switch (state.kind) {
    case "running":
      return t("comment.recipient_state_running");
    case "starting":
      return t("comment.recipient_state_starting");
    case "queued":
      return t("comment.recipient_state_queued");
    default:
      return null;
  }
}

/**
 * What Send will do for this recipient. The label carries the whole meaning —
 * "Add to current run" vs "Stop and start over" is the difference between the
 * agent keeping its work and losing it, so the chip says which one it is
 * rather than showing a generic "will start".
 */
function actionLabel(
  entry: RecipientEntry,
  t: TriggerLabelT,
): string {
  switch (entry.action) {
    case "steer":
      return t("comment.recipient_steer");
    case "after_run":
      return t("comment.recipient_after_run");
    case "restart":
      return t("comment.recipient_restart");
    case "skip":
      return t("comment.trigger_wont_trigger");
    default:
      return entry.state.kind === "queued"
        ? t("comment.recipient_join")
        : t("comment.trigger_will_start");
  }
}

/** Only choices whose consequence is not obvious from the label carry a line. */
function actionDescription(
  action: RecipientAction,
  entry: RecipientEntry,
  t: TriggerLabelT,
): string | null {
  const name = entry.agent.name;
  switch (action) {
    case "steer":
      return t("comment.recipient_steer_desc", { name });
    case "after_run":
      return t("comment.recipient_after_run_desc");
    case "restart":
      return t("comment.recipient_restart_desc");
    case "start":
      return entry.state.kind === "queued"
        ? t("comment.recipient_join_desc", { name })
        : null;
    default:
      return null;
  }
}

/**
 * The routing-mode chip row.
 *
 * One recipient renders as a single chip that opens its action menu. Several
 * collapse to an avatar stack with a count sentence; opening it shows one
 * affordance per agent, because a menu of 4 agents × 4 actions in one sheet
 * would be unreadable on a phone. This is where mobile deliberately diverges
 * from web's popover-of-rows: RN has no hover, so the state line and the
 * action menu have to live somewhere a tap can reach.
 */
function RoutedTriggerChips({
  recipients,
  byPresence,
  onActionChange,
  t,
}: {
  recipients: RecipientEntry[];
  byPresence: Map<string, AgentPresenceDetail>;
  onActionChange: (agentId: string, action: RecipientAction) => void;
  t: TriggerLabelT;
}) {
  const theme = useThemePalette();
  // Which recipient's action panel is open (agent id), LIST_OPEN for the
  // per-agent chooser, or null when everything is collapsed.
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (agentId: string) =>
    setOpenId((prev) => (prev === agentId ? null : agentId));

  if (recipients.length === 1) {
    const entry = recipients[0]!;
    const stateLabel = recipientStateLabel(entry.state, t);
    const sentence = actionLabel(entry, t);
    const choosable = entry.actions.length > 1;
    return (
      <View>
        <Pressable
          onPress={() => choosable && toggle(entry.agent.id)}
          accessibilityRole="button"
          accessibilityState={{ expanded: openId === entry.agent.id }}
          accessibilityLabel={t("comment.recipient_menu_aria", {
            name: entry.agent.name,
            action: sentence,
          })}
          className={cn(
            "flex-row items-center gap-1.5 rounded-md px-1.5 py-0.5",
            entry.action === "skip" && "opacity-40",
          )}
        >
          <TriggerAgentAvatar
            agent={entry.agent}
            presence={byPresence.get(entry.agent.id)}
            showDot={entry.action !== "skip"}
          />
          {stateLabel ? (
            <Text className="shrink-0 text-micro text-muted-foreground">
              {stateLabel}
            </Text>
          ) : null}
          <Text className="text-caption font-medium text-muted-foreground" numberOfLines={1}>
            {sentence}
          </Text>
          {choosable ? (
            <Ionicons name="chevron-down" size={11} color={theme.mutedForeground} />
          ) : null}
        </Pressable>
        {openId === entry.agent.id ? (
          <RecipientActionPanel
            entry={entry}
            heading={t("comment.recipient_menu_title", {
              name: entry.agent.name,
            })}
            onPick={(action) => {
              onActionChange(entry.agent.id, action);
              setOpenId(null);
            }}
            t={t}
          />
        ) : null}
      </View>
    );
  }

  const heads = recipients.slice(0, MAX_STACK_HEADS);
  const overflow = recipients.length - heads.length;
  const overlap = Math.round(AVATAR_SIZE * 0.3);
  const liveCount = recipients.filter(
    (r) => r.action !== "skip" && r.state.kind !== "idle",
  ).length;
  // Several recipients, so a stack tap opens the CHOOSER first: the user has to
  // name the agent before choosing what happens to it. Landing directly in the
  // first agent's actions silently picks a recipient for them.
  const openEntry =
    openId && openId !== LIST_OPEN
      ? recipients.find((r) => r.agent.id === openId) ?? null
      : null;

  return (
    <View>
      <Pressable
        onPress={() =>
          // Several recipients: the stack opens the per-agent LIST first, so
          // the user picks WHO before picking HOW. One combined menu of
          // N agents × M actions is unreadable on a phone.
          setOpenId((prev) => (prev === null ? LIST_OPEN : null))
        }
        accessibilityRole="button"
        accessibilityState={{ expanded: openId !== null }}
        accessibilityLabel={t("comment.recipient_count_other", {
          count: recipients.length,
        })}
        className={cn(
          "flex-row items-center gap-1.5 rounded-md px-1.5 py-0.5",
          openId !== null && "bg-muted",
        )}
      >
        <View className="flex-row items-center">
          {heads.map((entry, i) => (
            <View
              key={entry.agent.id}
              style={{ marginLeft: i === 0 ? 0 : -overlap }}
              className="rounded-full border-2 border-background"
            >
              <TriggerAgentAvatar
                agent={entry.agent}
                presence={byPresence.get(entry.agent.id)}
                showDot={false}
                suppressed={entry.action === "skip"}
              />
            </View>
          ))}
          {overflow > 0 && (
            <View
              style={{
                marginLeft: -overlap,
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                borderRadius: AVATAR_SIZE / 2,
              }}
              className="items-center justify-center border-2 border-background bg-muted"
            >
              <Text className="font-medium tabular-nums text-muted-foreground" style={{ fontSize: 10 }}>
                +{overflow}
              </Text>
            </View>
          )}
        </View>
        <Text className="shrink text-caption font-medium text-muted-foreground" numberOfLines={1}>
          {liveCount === 0
            ? t("comment.trigger_none_will_trigger")
            : t("comment.recipient_count_other", { count: recipients.length })}
        </Text>
        <Ionicons name="chevron-down" size={11} color={theme.mutedForeground} />
      </Pressable>

      {openId !== null ? (
        <View className="mt-1 rounded-lg border border-border bg-card p-1">
          {openEntry ? (
            <RecipientActionPanel
              entry={openEntry}
              heading={t("comment.recipient_menu_title", {
                name: openEntry.agent.name,
              })}
              showBack
              onBack={() => setOpenId(LIST_OPEN)}
              onPick={(action) => {
                onActionChange(openEntry.agent.id, action);
                setOpenId(null);
              }}
              t={t}
            />
          ) : (
            <>
              <Text className="px-2 pb-1 pt-0.5 text-caption font-medium text-muted-foreground">
                {t("comment.trigger_preview_title")}
              </Text>
              {recipients.map((entry) => {
                const stateLabel = recipientStateLabel(entry.state, t);
                const sentence = actionLabel(entry, t);
                const presenceLine = presenceSentence(
                  byPresence.get(entry.agent.id),
                  t,
                );
                const detail = [stateLabel, presenceLine].filter(Boolean).join(" · ");
                return (
                  <Pressable
                    key={entry.agent.id}
                    onPress={() => setOpenId(entry.agent.id)}
                    accessibilityRole="button"
                    accessibilityLabel={t("comment.recipient_menu_aria", {
                      name: entry.agent.name,
                      action: sentence,
                    })}
                    className="flex-row items-center gap-2 rounded-md px-2 py-1 active:bg-secondary"
                  >
                    <TriggerAgentAvatar
                      agent={entry.agent}
                      presence={byPresence.get(entry.agent.id)}
                      showDot={entry.action !== "skip"}
                      suppressed={entry.action === "skip"}
                    />
                    <View className="min-w-0 flex-1">
                      <View className="flex-row items-center gap-1.5">
                        <Text
                          className={cn(
                            "shrink text-caption font-medium text-foreground",
                            entry.action === "skip" && "text-muted-foreground",
                          )}
                          numberOfLines={1}
                        >
                          {entry.agent.name}
                        </Text>
                        <Text
                          className="shrink-0 text-micro text-muted-foreground"
                          numberOfLines={1}
                        >
                          {sentence}
                        </Text>
                      </View>
                      {detail ? (
                        <Text
                          className="shrink text-micro text-muted-foreground"
                          numberOfLines={1}
                        >
                          {detail}
                        </Text>
                      ) : null}
                    </View>
                    {entry.actions.length > 1 ? (
                      <Ionicons
                        name="chevron-forward"
                        size={12}
                        color={theme.mutedForeground}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The action menu for ONE recipient: every action its live run allows, the
 * current one checked, and a one-line consequence under the three that are not
 * self-explanatory.
 *
 * An inline panel rather than a bottom sheet because the consequences ARE the
 * decision — "Add to current run" vs "Stop and start over" differ only in what
 * happens to work already done, which a one-word sheet row cannot say.
 */
function RecipientActionPanel({
  entry,
  heading,
  showBack = false,
  onBack,
  onPick,
  t,
}: {
  entry: RecipientEntry;
  heading?: string;
  showBack?: boolean;
  onBack?: () => void;
  onPick: (action: RecipientAction) => void;
  t: TriggerLabelT;
}) {
  const theme = useThemePalette();
  return (
    <View className="mt-1 rounded-lg border border-border bg-card p-1">
      <View className="flex-row items-center gap-1 px-2 pb-1 pt-0.5">
        {showBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            className="mr-0.5"
          >
            <Ionicons name="chevron-back" size={13} color={theme.mutedForeground} />
          </Pressable>
        ) : null}
        <Text
          className="flex-1 text-caption font-medium text-muted-foreground"
          numberOfLines={1}
        >
          {heading ?? t("comment.recipient_menu_title", {
            name: entry.agent.name,
          })}
        </Text>
      </View>
      {entry.actions.map((action) => {
        const selected = entry.action === action;
        const description = actionDescription(action, entry, t);
        return (
          <Pressable
            key={action}
            onPress={() => onPick(action)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={actionLabelFor(action, entry, t)}
            className={cn(
              "rounded-md px-2 py-1 active:bg-secondary",
              selected && "bg-muted",
            )}
          >
            <View className="flex-row items-center gap-1.5">
              <Ionicons
                name={selected ? "checkmark-circle" : "ellipse-outline"}
                size={14}
                color={selected ? theme.success : theme.mutedForeground}
              />
              <Text
                className={cn(
                  "shrink text-caption font-medium",
                  action === "restart" && !selected
                    ? "text-destructive"
                    : "text-foreground",
                )}
                numberOfLines={1}
              >
                {actionLabelFor(action, entry, t)}
              </Text>
            </View>
            {description ? (
              <Text className="ml-[22px] text-micro text-muted-foreground">
                {description}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** `actionLabel` keyed by an explicit action (for menu rows, where the action
 *  is the candidate rather than the current one). */
function actionLabelFor(
  action: RecipientAction,
  entry: RecipientEntry,
  t: TriggerLabelT,
): string {
  return actionLabel({ ...entry, action }, t);
}

/** One blocked mention: named like an allowed chip ("Go"), but with an error
 *  indicator and a short reason instead of a trigger sentence. */
function BlockedTriggerChip({
  outcome,
  label,
  t,
}: {
  outcome: CommentTriggerOutcome;
  label?: string;
  t: TriggerLabelT;
}) {
  const theme = useThemePalette();
  const shortReason = blockedShortReasonLabel(outcome.reason_code, t);
  return (
    <View
      className="flex-row items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5"
      accessible
      accessibilityLabel={
        label
          ? t("comment.trigger_blocked_chip_aria", { name: label, reason: shortReason })
          : shortReason
      }
    >
      <Ionicons name="alert-circle" size={13} color={theme.destructive} />
      <Text className="shrink text-caption font-medium text-destructive" numberOfLines={1}>
        {label ? `${label} · ${shortReason}` : shortReason}
      </Text>
    </View>
  );
}

function SingleTriggerChip({
  agent,
  presence,
  suppressed,
  onToggle,
  t,
}: {
  agent: CommentTriggerPreviewAgent;
  presence: AgentPresenceDetail | undefined;
  suppressed: boolean;
  onToggle: (agentId: string) => void;
  t: TriggerLabelT;
}) {
  const state = suppressed
    ? t("comment.trigger_skipped_label")
    : sourceLabel(agent.source, t);
  const sentence = suppressed
    ? t("comment.trigger_wont_trigger")
    : t("comment.trigger_will_start");

  return (
    <Pressable
      onPress={() => onToggle(agent.id)}
      accessibilityRole="button"
      accessibilityState={{ checked: suppressed }}
      accessibilityLabel={t("comment.trigger_chip_aria", { name: agent.name, state })}
      className={cn(
        "flex-row items-center gap-1.5 rounded-md px-1.5 py-0.5",
        suppressed && "opacity-40",
      )}
    >
      <TriggerAgentAvatar agent={agent} presence={presence} showDot={!suppressed} />
      <Text className="text-caption font-medium text-muted-foreground" numberOfLines={1}>
        {sentence}
      </Text>
    </Pressable>
  );
}

function MultiTriggerChip({
  agents,
  byPresence,
  suppressedAgentIds,
  onToggle,
  t,
}: {
  agents: CommentTriggerPreviewAgent[];
  byPresence: Map<string, AgentPresenceDetail>;
  suppressedAgentIds: Set<string>;
  onToggle: (agentId: string) => void;
  t: TriggerLabelT;
}) {
  const theme = useThemePalette();
  const [open, setOpen] = useState(false);
  const activeCount = countWillTrigger(agents, suppressedAgentIds);
  const heads = agents.slice(0, MAX_STACK_HEADS);
  const overflow = agents.length - heads.length;
  // Mirror AgentAvatarStack: ~30% overlap reads as "stacked" without
  // obscuring the next avatar.
  const overlap = Math.round(AVATAR_SIZE * 0.3);
  const sentence =
    activeCount === 0
      ? t("comment.trigger_none_will_trigger")
      : activeCount === 1
        ? t("comment.trigger_will_start_count_one", { count: activeCount })
        : t("comment.trigger_will_start_count_other", { count: activeCount });

  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t("comment.trigger_chip_aria", {
          name: agents.map((a) => a.name).join("、"),
          state: sentence,
        })}
        className={cn(
          "flex-row items-center gap-1.5 rounded-md px-1.5 py-0.5",
          open && "bg-muted",
        )}
      >
        <View className="flex-row items-center">
          {heads.map((agent, i) => (
            <View
              key={agent.id}
              style={{ marginLeft: i === 0 ? 0 : -overlap }}
              className="rounded-full border-2 border-background"
            >
              <TriggerAgentAvatar
                agent={agent}
                presence={byPresence.get(agent.id)}
                showDot={false}
                suppressed={suppressedAgentIds.has(agent.id)}
              />
            </View>
          ))}
          {overflow > 0 && (
            <View
              style={{
                marginLeft: -overlap,
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                borderRadius: AVATAR_SIZE / 2,
              }}
              className="items-center justify-center border-2 border-background bg-muted"
            >
              <Text className="font-medium tabular-nums text-muted-foreground" style={{ fontSize: 10 }}>
                +{overflow}
              </Text>
            </View>
          )}
        </View>
        <Text className="shrink text-caption font-medium text-muted-foreground" numberOfLines={1}>
          {sentence}
        </Text>
      </Pressable>

      {open && (
        <View className="mt-1 rounded-lg border border-border bg-card p-1">
          <Text className="px-2 pb-1 pt-0.5 text-caption font-medium text-muted-foreground">
            {t("comment.trigger_preview_title")}
          </Text>
          {agents.map((agent) => {
            const suppressed = suppressedAgentIds.has(agent.id);
            const state = suppressed
              ? t("comment.trigger_skipped_label")
              : sourceLabel(agent.source, t);
            const presenceLine = presenceSentence(byPresence.get(agent.id), t);
            const reason = sourceReason(agent, t);
            const hint = suppressed
              ? t("comment.trigger_click_to_restore")
              : t("comment.trigger_click_to_skip");
            return (
              <Pressable
                key={agent.id}
                onPress={() => onToggle(agent.id)}
                accessibilityRole="button"
                accessibilityState={{ checked: suppressed }}
                accessibilityLabel={t("comment.trigger_chip_aria", { name: agent.name, state })}
                className="flex-row items-center gap-2 rounded-md px-2 py-1 active:bg-secondary"
              >
                <TriggerAgentAvatar
                  agent={agent}
                  presence={byPresence.get(agent.id)}
                  showDot={!suppressed}
                />
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-center gap-1.5">
                    <Text
                      className={cn(
                        "shrink text-caption font-medium text-foreground",
                        suppressed && "text-muted-foreground",
                      )}
                      numberOfLines={1}
                    >
                      {agent.name}
                    </Text>
                    <Text className="shrink-0 text-micro text-muted-foreground">{state}</Text>
                  </View>
                  {(
                    [reason, presenceLine, hint].filter(Boolean) as string[]
                  ).join(" · ") ? (
                    <Text
                      className="shrink text-micro text-muted-foreground"
                      numberOfLines={1}
                    >
                      {[reason, presenceLine, hint].filter(Boolean).join(" · ")}
                    </Text>
                  ) : null}
                </View>
                <Ionicons
                  name={suppressed ? "ellipse-outline" : "checkmark-circle"}
                  size={16}
                  color={suppressed ? theme.mutedForeground : theme.success}
                />
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function presenceSentence(
  presence: AgentPresenceDetail | undefined,
  t: TriggerLabelT,
): string | null {
  if (!presence) return null;
  return presence.availability === "online" || presence.availability === "unstable"
    ? t("comment.trigger_starts_now")
    : t("comment.trigger_starts_when_online");
}

function TriggerAgentAvatar({
  agent,
  presence,
  suppressed = false,
  showDot = true,
}: {
  agent: CommentTriggerPreviewAgent;
  presence: AgentPresenceDetail | undefined;
  suppressed?: boolean;
  showDot?: boolean;
}) {
  return (
    <View style={{ opacity: suppressed ? 0.4 : 1 }}>
      <ActorAvatar
        type="agent"
        id={agent.id}
        size={AVATAR_SIZE}
        showPresence={showDot && !suppressed && presence !== undefined}
      />
    </View>
  );
}