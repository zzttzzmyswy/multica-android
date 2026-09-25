/**
 * Subscriber picker — the sheet the Activity header's avatar group opens.
 * Mirrors web's `SubscriberPopoverContent`
 * (packages/views/issues/components/issue-detail.tsx:153-241): a search box
 * over two groups (Members / Agents), one checkbox row each, tap toggles
 * that actor's subscription.
 *
 * Mobile differences, each deliberate:
 *   - web is a `Popover` + `Command` list anchored to the avatar group; on a
 *     phone the equivalent is a bottom sheet (`PickerSheet`, the same shell
 *     every other picker on this screen uses) with an inline search box,
 *     because the native nav-header search bar belongs to a route and this is
 *     a modal.
 *   - the rows carry an explicit `checkbox` / `square-outline` glyph where web
 *     renders a `Checkbox` primitive it does not have.
 *
 * Two rules carried over verbatim from web, both load-bearing:
 *   - **Agents come from the archived-free list.** `agentListOptions` already
 *     excludes archived rows (data/queries/agents.ts), so there is no second
 *     `!archived_at` filter here — a retired agent must not be selectable.
 *   - **An unresolved subscriber list must not be actionable** (MUL-5714). The
 *     checkboxes are drawn from `subscribers`, which reads as "nobody is
 *     subscribed" while the query is in flight; acting on that would rewrite
 *     the target's reason to `manual` and clear a deliberate opt-out. The
 *     caller owns that gate (`disabled`), because the caller is also the one
 *     that renders nothing until the query resolves.
 *
 * Search reuses the app's existing predicates rather than re-deriving them:
 * `matchesMember` (name / email / role-prefix / pinyin) and
 * `matchesAgentSearch` (name / description, pinyin on both). Web matches the
 * member NAME only; mobile widens it to email because the row shows a name and
 * nothing else, so an email is the other identifier a user actually has for a
 * colleague. Agent matching is web-identical.
 */
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { IssueSubscriber } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PickerSheet } from "./pickers/picker-sheet";
import { memberListOptions } from "@/data/queries/members";
import { agentListOptions } from "@/data/queries/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { isSubscribedActor } from "@/lib/subscription";
import { buildSubscriberPickerRows } from "@/lib/subscriber-picker";
import { cn } from "@/lib/utils";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Resolved subscriber list. The caller renders nothing until the query
   *  succeeds, so this is never the "unknown" empty state. */
  subscribers: IssueSubscriber[];
  /** Blocks every row: a toggle is in flight, or the subscriber list lost its
   *  resolved state. See the MUL-5714 note in the file header. */
  disabled: boolean;
  /** Toggle one actor's subscription. Serialized by the caller — the
   *  optimistic patch snapshots the whole list (MUL-5714). */
  onToggle: (
    userId: string,
    userType: "member" | "agent",
    subscribed: boolean,
  ) => void;
}

export function SubscriberPickerSheet({
  visible,
  onClose,
  subscribers,
  disabled,
  onToggle,
}: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [query, setQuery] = useState("");

  const { data: rawMembers, isSuccess: membersResolved } = useQuery(
    memberListOptions(wsId),
  );
  const { data: rawAgents, isSuccess: agentsResolved } = useQuery(
    agentListOptions(wsId),
  );

  // Reopening starts from the full list, not a filter from the last visit.
  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);

  const rows = useMemo(
    () =>
      buildSubscriberPickerRows({
        members: rawMembers,
        agents: rawAgents,
        query,
        membersLabel: t("subscription.picker.membersGroup"),
        agentsLabel: t("subscription.picker.agentsGroup"),
      }),
    [rawMembers, rawAgents, query, t],
  );

  const loading = !membersResolved || !agentsResolved;
  const checkColor = theme.primary;

  return (
    <PickerSheet
      title={t("subscription.picker.title")}
      visible={visible}
      onClose={onClose}
      fill
    >
      <View className="flex-1">
        <View className="flex-row items-center gap-2 border-b border-border px-4 py-2">
          <Ionicons name="search" size={18} color={theme.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("subscription.picker.searchPlaceholder")}
            placeholderTextColor={theme.mutedForeground}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            className="flex-1 text-base text-foreground"
          />
        </View>
        <FlatList
          data={rows}
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          keyExtractor={(row) => row.key}
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return (
                <View className="bg-muted/40 px-4 py-1.5">
                  <Text className="text-caption font-medium uppercase tracking-wider text-muted-foreground">
                    {item.label}
                  </Text>
                </View>
              );
            }
            if (item.kind === "member") {
              const subscribed = isSubscribedActor(
                subscribers,
                item.member.user_id,
                "member",
              );
              return (
                <SubscriberRow
                  name={item.member.name}
                  type="member"
                  id={item.member.user_id}
                  subscribed={subscribed}
                  disabled={disabled}
                  checkColor={checkColor}
                  mutedColor={theme.mutedForeground}
                  onPress={() =>
                    onToggle(item.member.user_id, "member", subscribed)
                  }
                />
              );
            }
            const subscribed = isSubscribedActor(
              subscribers,
              item.agent.id,
              "agent",
            );
            return (
              <SubscriberRow
                name={item.agent.name}
                type="agent"
                id={item.agent.id}
                subscribed={subscribed}
                disabled={disabled}
                checkColor={checkColor}
                mutedColor={theme.mutedForeground}
                onPress={() => onToggle(item.agent.id, "agent", subscribed)}
              />
            );
          }}
          ListEmptyComponent={
            <View className="px-4 py-8 items-center">
              <Text className="text-sm text-muted-foreground text-center">
                {loading ? "" : t("subscription.picker.empty")}
              </Text>
            </View>
          }
        />
      </View>
    </PickerSheet>
  );
}

function SubscriberRow({
  name,
  type,
  id,
  subscribed,
  disabled,
  checkColor,
  mutedColor,
  onPress,
}: {
  name: string;
  type: "member" | "agent";
  id: string;
  subscribed: boolean;
  disabled: boolean;
  checkColor: string;
  mutedColor: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: subscribed, disabled }}
      accessibilityLabel={t(
        subscribed
          ? "subscription.picker.rowAriaSubscribed"
          : "subscription.picker.rowAriaUnsubscribed",
        { name },
      )}
      className={cn(
        "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
        disabled && "opacity-60",
      )}
    >
      <Ionicons
        name={subscribed ? "checkbox" : "square-outline"}
        size={20}
        color={subscribed ? checkColor : mutedColor}
      />
      <ActorAvatar type={type} id={id} size={32} />
      <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
}
