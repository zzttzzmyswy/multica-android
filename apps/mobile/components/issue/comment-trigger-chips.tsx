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
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
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
  suppressedAgentIds: Set<string>;
  onToggle: (agentId: string) => void;
}

export function CommentTriggerChips({
  agents,
  blocked = [],
  draftContent = "",
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

  const allowed =
    agents.length === 1 ? (
      <SingleTriggerChip
        agent={agents[0]!}
        presence={byAgent.get(agents[0]!.id)}
        suppressed={suppressedAgentIds.has(agents[0]!.id)}
        onToggle={onToggle}
        t={t}
      />
    ) : agents.length > 1 ? (
      <MultiTriggerChip
        agents={agents}
        byPresence={byAgent}
        suppressedAgentIds={suppressedAgentIds}
        onToggle={onToggle}
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
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
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
      <Text className="shrink text-xs font-medium text-destructive" numberOfLines={1}>
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
      <Text className="text-xs font-medium text-muted-foreground" numberOfLines={1}>
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
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
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
        <Text className="shrink text-xs font-medium text-muted-foreground" numberOfLines={1}>
          {sentence}
        </Text>
      </Pressable>

      {open && (
        <View className="mt-1 rounded-lg border border-border bg-card p-1">
          <Text className="px-2 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">
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
                        "shrink text-xs font-medium text-foreground",
                        suppressed && "text-muted-foreground",
                      )}
                      numberOfLines={1}
                    >
                      {agent.name}
                    </Text>
                    <Text className="shrink-0 text-[11px] text-muted-foreground">{state}</Text>
                  </View>
                  {(
                    [reason, presenceLine, hint].filter(Boolean) as string[]
                  ).join(" · ") ? (
                    <Text
                      className="shrink text-[11px] text-muted-foreground"
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