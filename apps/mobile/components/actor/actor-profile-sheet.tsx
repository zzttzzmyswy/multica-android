/**
 * Actor profile sheet (iteration 179, G14) — the mobile equivalent of web's
 * actor hover cards.
 *
 * Web parity targets, all read first-hand:
 *   - member `packages/views/members/member-profile-card.tsx:28-171`
 *   - agent  `packages/views/agents/components/agent-profile-card.tsx:38-132`
 *   - squad  `packages/views/squads/components/squad-profile-card.tsx:28-192`
 *
 * Two deliberate platform differences, both forced by the phone:
 *
 *   1. **Hover → tap.** There is no hover on a touch screen, so the card is a
 *      sheet behind a tap on the avatar rather than a dwell-triggered popover.
 *      Sheet chrome follows `components/chat/agent-picker-sheet.tsx` (RN
 *      `Modal` + dimmed backdrop + centred card) — the codebase ships no
 *      bottom-sheet library and every other sheet here is built the same way.
 *   2. **No "Detail →" hover affordance.** Web fades that link in on hover.
 *      Here the card header is the tap target and pushes the detail route,
 *      which is what the link did anyway; a hover-only affordance has no
 *      touch equivalent worth faking.
 *
 * Everything inside the cards reuses existing workspace-level queries
 * (`memberListOptions` / `agentListAllOptions` / `squadListOptions` /
 * `runtimeListOptions` / `agentRunCounts30dOptions`) — the same caches the
 * lists behind the sheet already populated. The sheet issues no new request of
 * its own beyond the 30-day run counts, which web also fetches for the member
 * card and which stays `enabled` only while a member card is open.
 */
import { useMemo } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  deriveRuntimeHealth,
  runtimeDisplayLabel,
  type RuntimeHealth,
} from "@multica/core/runtimes";
import type { AgentAvailability } from "@multica/core/agents";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  agentListAllOptions,
  agentRunCounts30dOptions,
} from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { squadListOptions } from "@/data/queries/squads";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  useActorProfileStore,
  type ActorProfileType,
} from "@/data/stores/actor-profile-store";
import { accessScopeOfAgent } from "@/lib/agent-list-access";
import {
  MEMBER_CARD_AGENT_LIMIT,
  countLabelKey,
  ownedAgentsOf,
  squadMemberRows,
} from "@/lib/actor-profile";
import { useAgentPresence } from "@/lib/use-agent-presence";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Avatar diameter for the card header — web's `size="xl"` (40px). */
const HEADER_AVATAR = 40;
/** Avatar diameter for a row inside a card — web's `size="sm"` (20px). */
const ROW_AVATAR = 20;

/** Agent availability → text tone, mirroring `PresenceDot`'s colour map. */
const AVAILABILITY_TONE: Record<AgentAvailability, string> = {
  online: "text-success",
  unstable: "text-warning",
  offline: "text-muted-foreground",
  archived: "text-muted-foreground",
};

const AVAILABILITY_DOT: Record<AgentAvailability, string> = {
  online: "bg-success",
  unstable: "bg-warning",
  offline: "bg-muted-foreground/40",
  archived: "bg-muted-foreground/40",
};

/** Runtime health → wifi glyph + tone, mirroring web's `HealthIcon`. */
const HEALTH_GLYPH: Record<
  RuntimeHealth,
  { name: "wifi" | "wifi-outline" | "cloud-offline-outline"; tone: string }
> = {
  online: { name: "wifi", tone: "text-success" },
  recently_lost: { name: "wifi-outline", tone: "text-warning" },
  offline: { name: "cloud-offline-outline", tone: "text-muted-foreground" },
  about_to_gc: { name: "cloud-offline-outline", tone: "text-destructive" },
};

/** Access scope → the badge label the agents list already uses. */
const SCOPE_LABEL_KEY: Record<string, string> = {
  workspace: "agents.scope.workspace",
  "specific-people": "agents.scope.specificPeople",
  "owner-only": "agents.scope.ownerOnly",
};

/** Muted chip shared by role / scope / archived / skill / overflow badges. */
function Badge({
  label,
  className,
  textClassName,
}: {
  label: string;
  className?: string;
  textClassName?: string;
}) {
  return (
    <View className={cn("shrink-0 rounded-md bg-muted px-1.5 py-0.5", className)}>
      <Text
        numberOfLines={1}
        className={cn(
          "text-[11px] font-medium text-muted-foreground",
          textClassName,
        )}
      >
        {label}
      </Text>
    </View>
  );
}

export function ActorProfileSheet() {
  const target = useActorProfileStore((s) => s.target);
  const close = useActorProfileStore((s) => s.close);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  return (
    <Modal
      visible={!!target}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <Pressable className="flex-1 bg-black/40" onPress={close}>
        <View className="flex-1 items-center justify-center px-6">
          {/* Inner press sink: without it a tap anywhere on the card falls
              through to the backdrop and dismisses the sheet. */}
          <Pressable onPress={() => {}} className="w-full max-w-sm">
            <View className="bg-popover rounded-2xl overflow-hidden">
              <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
                <Text className="text-base font-semibold text-foreground">
                  {t("profileCard.title")}
                </Text>
                <Pressable
                  onPress={close}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.close")}
                  hitSlop={8}
                  className="active:opacity-60"
                >
                  <Ionicons name="close" size={18} color={muted} />
                </Pressable>
              </View>
              <ScrollView className="max-h-96">
                <View className="px-4 py-3">
                  {target ? (
                    <ProfileCardBody type={target.type} id={target.id} />
                  ) : null}
                </View>
              </ScrollView>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function ProfileCardBody({ type, id }: { type: ActorProfileType; id: string }) {
  if (type === "member") return <MemberCard userId={id} />;
  if (type === "agent") return <AgentCard agentId={id} />;
  return <SquadCard squadId={id} />;
}

/** Loading placeholder — web's Skeleton header, at the same rhythm. */
function CardSkeleton() {
  return (
    <View className="flex-row items-center gap-3">
      <Skeleton className="h-10 w-10 rounded-full" />
      <View className="flex-1 gap-1.5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-20" />
      </View>
    </View>
  );
}

function Unavailable({ type }: { type: ActorProfileType }) {
  const { t } = useTranslation();
  return (
    <Text className="text-xs text-muted-foreground">
      {t(`profileCard.unavailable.${type}`)}
    </Text>
  );
}

/** Row inside a card that pushes an actor's detail route. */
function NavigableRow({
  onPress,
  accessibilityLabel,
  children,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="flex-row items-center gap-2 rounded-md px-1 py-1.5 active:bg-secondary"
    >
      {children}
      <Ionicons
        name="chevron-forward"
        size={12}
        color={THEME[colorScheme].mutedForeground}
      />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Member card
// ---------------------------------------------------------------------------

function MemberCard({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const close = useActorProfileStore((s) => s.close);

  const { data: members = [], isPending: membersLoading } = useQuery(
    memberListOptions(wsId),
  );
  const { data: agents = [] } = useQuery(agentListAllOptions(wsId));
  // `sortable` flips `enabled` on — without it the query is inert
  // (`data/queries/agents.ts:47-58`) and every owned agent would rank zero.
  const { data: runCounts = [] } = useQuery(
    agentRunCounts30dOptions(wsId, true),
  );

  const member = members.find((m) => m.user_id === userId);
  const owned = useMemo(
    () => ownedAgentsOf(agents, userId, runCounts),
    [agents, userId, runCounts],
  );

  if (membersLoading && !member) return <CardSkeleton />;
  if (!member) return <Unavailable type="member" />;

  const visible = owned.slice(0, MEMBER_CARD_AGENT_LIMIT);
  const overflow = owned.length - visible.length;

  const openAgent = (agentId: string) => {
    close();
    if (wsSlug) router.push(`/${wsSlug}/more/agents/${agentId}`);
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-start gap-3">
        <ActorAvatar type="member" id={member.user_id} size={HEADER_AVATAR} />
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-1.5">
            <Text
              numberOfLines={1}
              className="shrink text-sm font-semibold text-foreground"
            >
              {member.name}
            </Text>
            <Badge label={t(`members.role.${member.role}`)} />
          </View>
          <Text
            numberOfLines={1}
            className="mt-0.5 text-xs text-muted-foreground"
          >
            {member.email}
          </Text>
        </View>
      </View>

      {owned.length > 0 ? (
        <View className="gap-1.5">
          <Text className="text-xs text-muted-foreground">
            {t("profileCard.ownedAgents", { count: owned.length })}
          </Text>
          <View className="gap-0.5">
            {visible.map((agent) => (
              <NavigableRow
                key={agent.id}
                onPress={() => openAgent(agent.id)}
                accessibilityLabel={t("profileCard.openAria", {
                  name: agent.name,
                })}
              >
                <ActorAvatar
                  type="agent"
                  id={agent.id}
                  size={ROW_AVATAR}
                  showPresence
                />
                <View className="flex-1 min-w-0">
                  <Text
                    numberOfLines={1}
                    className="text-xs font-medium text-foreground"
                  >
                    {agent.name}
                  </Text>
                  {agent.description ? (
                    <Text
                      numberOfLines={1}
                      className="text-[11px] text-muted-foreground"
                    >
                      {agent.description}
                    </Text>
                  ) : null}
                </View>
              </NavigableRow>
            ))}
            {overflow > 0 ? (
              <Text className="px-1 text-xs text-muted-foreground">
                {t(countLabelKey("profileCard.moreAgents", overflow), {
                  count: overflow,
                })}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Agent card
// ---------------------------------------------------------------------------

function AgentCard({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const close = useActorProfileStore((s) => s.close);

  const { data: agents = [], isPending: agentsLoading } = useQuery(
    agentListAllOptions(wsId),
  );
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));

  const agent = agents.find((a) => a.id === agentId);
  if (agentsLoading && !agent) return <CardSkeleton />;
  if (!agent) return <Unavailable type="agent" />;

  const isArchived = !!agent.archived_at;
  const owner = agent.owner_id
    ? (members.find((m) => m.user_id === agent.owner_id) ?? null)
    : null;
  const runtime = runtimes.find((r) => r.id === agent.runtime_id) ?? null;
  const model = agent.model.trim();

  const openDetail = () => {
    close();
    if (wsSlug) router.push(`/${wsSlug}/more/agents/${agent.id}`);
  };

  return (
    <View className="gap-3">
      <Pressable
        onPress={openDetail}
        accessibilityRole="button"
        accessibilityLabel={t("profileCard.openAria", { name: agent.name })}
        className="flex-row items-start gap-3 active:opacity-70"
      >
        <ActorAvatar type="agent" id={agent.id} size={HEADER_AVATAR} />
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-1.5">
            <Text
              numberOfLines={1}
              className="shrink text-sm font-semibold text-foreground"
            >
              {agent.name}
            </Text>
            {isArchived ? (
              <Badge label={t("profileCard.archived")} />
            ) : (
              <Badge label={t(SCOPE_LABEL_KEY[accessScopeOfAgent(agent)])} />
            )}
          </View>
          {/* Archived agents get no availability line — a retired agent's dot
              would read as a transient outage (web `:110-112`). */}
          {!isArchived ? <AgentAvailabilityLine agentId={agent.id} /> : null}
        </View>
      </Pressable>

      {agent.description ? (
        <Text numberOfLines={2} className="text-xs text-muted-foreground">
          {agent.description}
        </Text>
      ) : null}

      <View className="gap-1.5">
        <MetaRow
          label={t("profileCard.runtimeLabel")}
          icon={
            <RuntimeHealthGlyph
              health={
                agent.runtime_mode === "cloud"
                  ? "online"
                  : runtime
                    ? deriveRuntimeHealth(runtime, Date.now())
                    : "offline"
              }
            />
          }
          value={
            runtime
              ? runtimeDisplayLabel(runtime)
              : agent.runtime_mode === "cloud"
                ? t("profileCard.fallbackRuntimeCloud")
                : t("profileCard.unknownRuntime")
          }
        />
        <MetaRow
          label={t("profileCard.modelLabel")}
          value={model.length > 0 ? model : t("profileCard.modelUnset")}
          mono={model.length > 0}
          badge={agent.thinking_level?.trim() || undefined}
        />
        {agent.skills.length > 0 ? (
          <SkillsRow names={agent.skills.map((s) => s.name)} />
        ) : null}
        {owner ? (
          <MetaRow label={t("profileCard.ownerLabel")} value={owner.name} />
        ) : null}
      </View>
    </View>
  );
}

/** Three-state availability dot + label, under the agent's name. */
function AgentAvailabilityLine({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const detail = useAgentPresence(wsId, agentId);

  if (detail === "loading") {
    return <Skeleton className="mt-1 h-3 w-16" />;
  }
  return (
    <View className="mt-1 flex-row items-center gap-1.5">
      <View
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          AVAILABILITY_DOT[detail.availability],
        )}
      />
      <Text className={cn("text-xs", AVAILABILITY_TONE[detail.availability])}>
        {t(`agents.availability.${detail.availability}`)}
      </Text>
    </View>
  );
}

/** Wifi-style runtime health glyph, mirroring web's `HealthIcon`. */
function RuntimeHealthGlyph({ health }: { health: RuntimeHealth }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const tone =
    health === "online"
      ? theme.success
      : health === "recently_lost"
        ? theme.warning
        : health === "about_to_gc"
          ? theme.destructive
          : theme.mutedForeground;
  return <Ionicons name={HEALTH_GLYPH[health].name} size={12} color={tone} />;
}

/** `label + value` line with the fixed 3rem label column web uses. */
function MetaRow({
  label,
  value,
  icon,
  mono = false,
  badge,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  mono?: boolean;
  badge?: string;
}) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Text className="w-12 shrink-0 text-xs text-muted-foreground">
        {label}
      </Text>
      {icon}
      <Text
        numberOfLines={1}
        className={cn(
          "flex-1 text-xs text-foreground",
          mono && "font-mono text-[11px]",
        )}
      >
        {value}
      </Text>
      {badge ? <Badge label={badge} /> : null}
    </View>
  );
}

/** First three skill names + a `+N` overflow chip (web `:246-266`). */
function SkillsRow({ names }: { names: string[] }) {
  const { t } = useTranslation();
  const visible = names.slice(0, 3);
  const overflow = names.length - visible.length;
  return (
    <View className="flex-row items-start gap-1.5">
      <Text className="w-12 shrink-0 pt-0.5 text-xs text-muted-foreground">
        {t("profileCard.skillsLabel")}
      </Text>
      <View className="flex-1 flex-row flex-wrap gap-1">
        {visible.map((name) => (
          <Badge key={name} label={name} className="max-w-full" />
        ))}
        {overflow > 0 ? <Badge label={`+${overflow}`} /> : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Squad card
// ---------------------------------------------------------------------------

function SquadCard({ squadId }: { squadId: string }) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const close = useActorProfileStore((s) => s.close);

  const { data: squads = [], isPending: squadsLoading } = useQuery(
    squadListOptions(wsId),
  );
  const { data: agents = [] } = useQuery(agentListAllOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  const squad = squads.find((s) => s.id === squadId);
  const rows = useMemo(
    () => (squad ? squadMemberRows(squad, agents, members) : null),
    [squad, agents, members],
  );

  if (squadsLoading && !squad) return <CardSkeleton />;
  if (!squad || !rows) return <Unavailable type="squad" />;

  const isArchived = !!squad.archived_at;
  const memberCount = squad.member_count ?? (squad.member_preview ?? []).length;

  const openDetail = () => {
    close();
    if (wsSlug) router.push(`/${wsSlug}/more/squads/${squad.id}`);
  };
  const openMember = (row: (typeof rows.visible)[number]) => {
    if (!row.detailId || !wsSlug) return;
    close();
    router.push(
      row.memberType === "agent"
        ? `/${wsSlug}/more/agents/${row.detailId}`
        : `/${wsSlug}/more/members/${row.detailId}`,
    );
  };

  return (
    <View className="gap-3">
      <Pressable
        onPress={openDetail}
        accessibilityRole="button"
        accessibilityLabel={t("profileCard.openAria", { name: squad.name })}
        className="flex-row items-start gap-3 active:opacity-70"
      >
        <ActorAvatar type="squad" id={squad.id} size={HEADER_AVATAR} />
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-1.5">
            <Text
              numberOfLines={1}
              className="shrink text-sm font-semibold text-foreground"
            >
              {squad.name}
            </Text>
            {isArchived ? <Badge label={t("profileCard.archived")} /> : null}
          </View>
        </View>
      </Pressable>

      {squad.description ? (
        <Text numberOfLines={2} className="text-xs text-muted-foreground">
          {squad.description}
        </Text>
      ) : null}

      {memberCount > 0 ? (
        <View className="gap-1.5">
          <Text className="text-xs text-muted-foreground">
            {t("profileCard.membersSection")}
            <Text className="tabular-nums"> · {memberCount}</Text>
          </Text>
          <View className="gap-0.5">
            {rows.visible.map((row) => (
              <NavigableRow
                key={row.key}
                onPress={() => openMember(row)}
                accessibilityLabel={t("profileCard.openAria", {
                  name: row.name,
                })}
              >
                <ActorAvatar
                  type={row.memberType}
                  id={row.memberId}
                  size={ROW_AVATAR}
                  showPresence={row.memberType === "agent"}
                />
                <Text
                  numberOfLines={1}
                  className="flex-1 text-xs font-medium text-foreground"
                >
                  {row.name}
                </Text>
                {row.isLeader ? (
                  <Badge
                    label={t("profileCard.leaderChip")}
                    className="bg-amber-100 dark:bg-amber-900/30"
                    textClassName="text-amber-700 dark:text-amber-400"
                  />
                ) : null}
                {row.memberType === "member" && row.role ? (
                  <Text
                    numberOfLines={1}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {row.role}
                  </Text>
                ) : null}
              </NavigableRow>
            ))}
            {rows.overflow > 0 ? (
              <Text className="px-1 text-xs text-muted-foreground">
                {t(countLabelKey("profileCard.moreMembers", rows.overflow), {
                  count: rows.overflow,
                })}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
