/**
 * Thread navigator sheet — the mobile host for the issue detail page's
 * "jump to a comment thread" surface.
 *
 * Web pairs two navigators on this page: a searchable panel in the header
 * (`packages/views/issues/components/thread-nav-panel.tsx`) and a right-edge
 * tick rail (`thread-minimap.tsx`). Web renders the panel only on desktop and
 * says why in its own source (`issue-detail.tsx:2519-2523`):
 *
 * > the panel would work there, but it needs a sheet rather than a popover to
 * > be usable one-handed, which is its own change.
 *
 * This is that sheet. The rail is deliberately not ported — it is driven by
 * pointer hover and a phone has none.
 *
 * Rows mirror web's `ThreadRow` (`thread-nav-panel.tsx:200`): avatar, the
 * root comment's first line (falling back to the author for a body-less
 * comment), a stamp, then author · reply count · resolved badge · excerpt.
 * The stamp picks its own format from the row's day bucket, so "today"
 * headers aren't followed by a redundant date (web `formatStamp`).
 *
 * All list logic lives in `lib/thread-nav.ts` (pure, Node-tested); this file
 * is layout + touch.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { TimelineEntry } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";

import { PickerSheet } from "./pickers/picker-sheet";
import { CatalogStatus } from "@/components/catalog/catalog-status";
import { useActorLookup } from "@/data/use-actor-name";
import { useAuthStore } from "@/data/auth-store";
import {
  buildThreadNavThreads,
  filterThreads,
  groupPreparedThreads,
  prepareThreads,
  threadFilterCounts,
  type PreparedThread,
  type ThreadDayGroup,
  type ThreadNavFilter,
} from "@/lib/thread-nav";
import type { CatalogState } from "@/lib/catalog-state";
import { getIntlLocale } from "@/lib/i18n";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** The actor union `ActorAvatar` accepts — core's timeline types are `string`. */
type ActorType =
  | "member"
  | "agent"
  | "squad"
  | "system"
  | null
  | undefined;

/** The four chips, in web's order (`thread-nav-panel.tsx:500-560`). */
const FILTERS: ThreadNavFilter[] = ["all", "unresolved", "resolved", "mine"];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Raw timeline entries — filtered to comments inside. */
  entries: readonly TimelineEntry[] | undefined;
  /** Load state of the timeline read the entries came from. `[]` cannot tell
   *  "still loading" from "this issue has no comments", and this sheet says
   *  "no threads" out loud — so it needs the distinction, like every other
   *  catalog-reading surface (see lib/catalog-read.ts). */
  timelineState: CatalogState;
  /** Re-runs the timeline read behind the failure branch's retry. */
  onRetry: () => void;
  /** Root comment id to jump to. */
  onJump: (threadId: string) => void;
}

export function ThreadNavSheet({
  visible,
  onClose,
  entries,
  timelineState,
  onRetry,
  onJump,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { getName } = useActorLookup();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ThreadNavFilter>("all");
  // A plain ScrollView (not a FlatList) — the list is bounded by thread count,
  // which is far smaller than a comment timeline, and the day headers interleave
  // with rows. Reset to the top when the query or chip changes, same as every
  // search-enabled picker body.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [query, filter]);

  // Each opening starts clean: no carried-over query or chip. Web resets the
  // panel on open for the same reason (`thread-nav-panel.tsx:384`).
  useEffect(() => {
    if (!visible) {
      setQuery("");
      setFilter("all");
    }
  }, [visible]);

  const threads = useMemo(
    () => buildThreadNavThreads(entries ?? [], currentUserId),
    [entries, currentUserId],
  );

  const prepared = useMemo(
    () =>
      prepareThreads(
        threads,
        (entry) =>
          getName(
            entry.actor_type as
              | "member"
              | "agent"
              | "squad"
              | null
              | undefined,
            entry.actor_id,
          ),
        Date.now(),
      ),
    [threads, getName],
  );

  const rows = useMemo(
    () => filterThreads(prepared, filter, query),
    [prepared, filter, query],
  );
  const counts = useMemo(() => threadFilterCounts(threads), [threads]);
  const sections = useMemo(() => groupPreparedThreads(rows), [rows]);

  return (
    <PickerSheet
      title={t("threadNav.title")}
      visible={visible}
      onClose={onClose}
      fill
    >
      <View className="flex-1">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t("threadNav.searchPlaceholder")}
        />
        <FilterChips
          active={filter}
          counts={counts}
          onChange={setFilter}
          labels={{
            all: t("threadNav.filterAll"),
            unresolved: t("threadNav.filterUnresolved"),
            resolved: t("threadNav.filterResolved"),
            mine: t("threadNav.filterMine"),
          }}
        />
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          keyboardShouldPersistTaps="handled"
        >
          {sections.length === 0 ? (
            // The "no threads" sentence is only allowed once the read has
            // settled — otherwise a slow or failed timeline would be reported
            // as an issue with no comments.
            <CatalogStatus
              state={threads.length === 0 ? timelineState : "empty"}
              onRetry={onRetry}
              layout="centered"
              emptyMessage={
                threads.length === 0
                  ? t("threadNav.empty")
                  : t("threadNav.noMatches")
              }
            />
          ) : (
            sections.map((section) => (
              <View key={section.group}>
                <GroupHeader group={section.group} />
                {section.rows.map((row) => (
                  <ThreadRow
                    key={row.thread.id}
                    row={row}
                    muted={theme.mutedForeground}
                    onPress={() => {
                      onJump(row.thread.id);
                      onClose();
                    }}
                  />
                ))}
              </View>
            ))
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    </PickerSheet>
  );
}

function GroupHeader({ group }: { group: ThreadDayGroup }) {
  const { t } = useTranslation();
  const label = {
    today: t("threadNav.groupToday"),
    yesterday: t("threadNav.groupYesterday"),
    earlier: t("threadNav.groupEarlier"),
  }[group];
  return (
    <View className="px-4 pt-4 pb-1">
      <Text className="text-xs font-medium text-muted-foreground">
        {label}
      </Text>
    </View>
  );
}

function ThreadRow({
  row,
  muted,
  onPress,
}: {
  row: PreparedThread;
  muted: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { thread, title, excerpt, authorName, group } = row;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-start gap-3 px-4 py-2.5 active:bg-secondary/50"
    >
      <ActorAvatar
        // Core's `TimelineEntry.actor_type` is a bare `string`; the avatar
        // takes the closed union. Same narrowing as comment-card.tsx.
        type={thread.entry.actor_type as ActorType}
        id={thread.entry.actor_id}
        size={28}
      />
      <View className="flex-1 min-w-0">
        <View className="flex-row items-baseline gap-2">
          <Text
            className={cn(
              "flex-1 text-sm",
              thread.resolved
                ? "text-muted-foreground"
                : "font-medium text-foreground",
            )}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {formatStamp(thread.entry.created_at, group)}
          </Text>
        </View>
        <View className="mt-0.5 flex-row items-center gap-2">
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {authorName}
          </Text>
          {thread.replyCount > 0 ? (
            <View className="flex-row items-center gap-0.5">
              <Ionicons name="chatbubble-outline" size={11} color={muted} />
              <Text className="text-xs text-muted-foreground">
                {thread.replyCount}
              </Text>
            </View>
          ) : null}
          {thread.resolved ? (
            <View className="flex-row items-center gap-0.5">
              <Ionicons name="checkmark-circle" size={11} color={muted} />
              <Text className="text-xs text-muted-foreground">
                {t("threadNav.resolvedBadge")}
              </Text>
            </View>
          ) : null}
        </View>
        {excerpt ? (
          <Text
            className="mt-0.5 text-xs text-muted-foreground"
            numberOfLines={1}
          >
            {excerpt}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function FilterChips({
  active,
  counts,
  onChange,
  labels,
}: {
  active: ThreadNavFilter;
  counts: Record<ThreadNavFilter, number>;
  onChange: (filter: ThreadNavFilter) => void;
  labels: Record<ThreadNavFilter, string>;
}) {
  return (
    <View className="flex-row flex-wrap gap-2 px-4 pt-1 pb-2">
      {FILTERS.map((filter) => {
        const selected = filter === active;
        return (
          <Pressable
            key={filter}
            onPress={() => onChange(filter)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            className={cn(
              "rounded-full border px-3 py-1",
              selected
                ? "border-transparent bg-secondary"
                : "border-border bg-transparent",
            )}
          >
            <Text
              className={cn(
                "text-xs",
                selected ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {`${labels[filter]} ${counts[filter]}`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Same chrome as the filter sheets' search row, with an explicit clear
 *  button: RN's `clearButtonMode` is iOS-only. */
function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
}) {
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  return (
    <View className="px-4 pt-2 pb-1">
      <View className="flex-row items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2">
        <Ionicons name="search" size={16} color={muted} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={placeholder}
          className="flex-1 py-0 text-sm text-foreground"
        />
        {value ? (
          <Pressable
            onPress={() => onChange("")}
            hitSlop={8}
            accessibilityLabel={placeholder}
          >
            <Ionicons name="close-circle" size={16} color={muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Wall clock under a today/yesterday header, calendar date under "earlier" —
 * the header already names the day in the first two cases, so repeating it
 * per row would be redundant where it is known and missing where it is not.
 * Web `formatStamp` (`thread-nav-panel.tsx:287`), on the same boundary.
 */
function formatStamp(createdAt: string, group: ThreadDayGroup): string {
  const ts = Date.parse(createdAt);
  if (Number.isNaN(ts)) return "";
  const d = new Date(ts);
  return group === "earlier"
    ? d.toLocaleDateString(getIntlLocale(), { month: "short", day: "numeric" })
    : d.toLocaleTimeString(getIntlLocale(), {
        hour: "2-digit",
        minute: "2-digit",
      });
}
