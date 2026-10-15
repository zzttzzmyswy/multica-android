/**
 * Inbox filter sheet — the mobile host for web's inbox filter popover
 * (`packages/views/inbox/components/inbox-filter-menu.tsx`).
 *
 * Web hangs four submenus off a dropdown trigger; a phone has no dropdown
 * submenus, so the equivalent host is `PickerSheet` — the same bottom sheet
 * every other multi-select on this screen uses. One sheet, four sections,
 * each row a checkbox, matching the agent filter sheet's shape so the app has
 * one filter idiom rather than two.
 *
 * **One sheet, two views.** Web renders this menu unconditionally and hands it
 * the view's items; the main inbox and the archived sub-view therefore share
 * one implementation on web, and they do here too — `inbox.tsx` instantiates
 * this for whichever list is on screen. What differs between the two is where
 * the COUNTS come from, and the caller decides that by what it passes as
 * `facets`; the sheet only renders them:
 *
 *   - **The archived view's counts come from the server.** Its list is paged,
 *     so a local count would describe the pages fetched so far and claim, say,
 *     "9 done" about an archive holding 816. `facets` is the facet endpoint's
 *     response over the same filters the list is, and every number is "how
 *     many rows selecting this would reveal".
 *   - **The main view's counts come from the client**, over the deduplicated
 *     list already in hand (`inboxLocalFacets`). `/api/inbox` returns the whole
 *     unarchived inbox, so those counts are complete, and web's main view
 *     counts locally for the same reason.
 *
 * The sheet is deliberately ignorant of which one it got: both arrive as the
 * same `{ statuses, priorities, actors, unreadCount }` shape, so a number can
 * never be drawn from one source while its list came from the other.
 *
 * One more thing is conditional: **the priority section can be absent.** It is
 * offered only when the caller's capability probe says the backend projects
 * `issue_priority` (`showsPriorityFilter`). Status and actor always appear,
 * because every row has an actor and status is the dimension these lists are
 * mostly browsed by.
 *
 * The section list itself stays stable: a dimension with no options renders a
 * placeholder rather than vanishing, so the sheet is a learnable list instead
 * of one whose entries come and go. Mirrors `agent-filter-sheet.tsx`.
 */
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssuePriority } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { StatusIcon } from "@/components/ui/status-icon";
import { PickerSheet } from "@/components/issue/pickers/picker-sheet";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { useActorLookup } from "@/data/use-actor-name";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useStatusOptions } from "@/lib/status-options";
import {
  inboxActorKeyParts,
  INBOX_PRIORITY_FILTER_ORDER,
  showsPriorityFilter,
  type InboxFilters,
  type InboxPriorityFilterSupport,
} from "@/lib/inbox-filters";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Sheet heading — each list names itself (`inbox.filters` / `inbox.archivedFilters`). */
  title: string;
  wsId: string | null;
  filters: InboxFilters;
  /** Counts for the current selection; undefined while a server fetch is pending. */
  facets:
    | {
        statuses: Record<string, number>;
        priorities: Record<string, number>;
        actors: Record<string, number>;
        unreadCount: number;
      }
    | undefined;
  facetsLoading: boolean;
  /**
   * Server-facet failure and its retry. Optional because only the archived
   * view has a facet REQUEST to fail: the main view's counts are computed from
   * the list it already holds, so there is nothing to load, fail, or retry.
   * Passing a no-op retry instead would put a "Retry" button on a fetch that
   * does not exist.
   */
  facetsError?: boolean;
  onRetryFacets?: () => void;
  prioritySupport: InboxPriorityFilterSupport;
  /** Count of active selections — gates Clear (web's `inboxFilterCount`). */
  activeCount: number;
  onToggleStatus: (status: string) => void;
  onTogglePriority: (priority: IssuePriority) => void;
  onToggleActor: (actor: string) => void;
  onToggleUnreadOnly: () => void;
  onClear: () => void;
}

export function InboxArchiveFilterSheet({
  visible,
  onClose,
  title,
  wsId,
  filters,
  facets,
  facetsLoading,
  facetsError,
  onRetryFacets,
  prioritySupport,
  activeCount,
  onToggleStatus,
  onTogglePriority,
  onToggleActor,
  onToggleUnreadOnly,
  onClear,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { options: statusOptions } = useStatusOptions(wsId);
  const statusCatalog = useIssueStatuses(wsId);
  const { getName } = useActorLookup();

  // The status rows are the catalog's options UNION whatever the facets
  // counted and whatever is already selected. Taking only the catalog would
  // hide a status the archive actually holds (a retired custom status, or a
  // catalog still loading), and the count beside it would then point at a row
  // the user cannot reach.
  const statusKeys = [
    ...new Set<string>([
      ...statusOptions.map((o) => o.key),
      ...Object.keys(facets?.statuses ?? {}),
      ...filters.statuses,
    ]),
  ];
  const statusOrder = new Map(statusOptions.map((o, i) => [o.key, i]));
  statusKeys.sort(
    (a, b) => (statusOrder.get(a) ?? 999) - (statusOrder.get(b) ?? 999),
  );

  // Actors come from the facet universe unioned with any current selection,
  // so picking one actor never removes the others from the list offering them.
  // Sorted by resolved name so the rows do not reshuffle as counts change.
  const actorKeys = [
    ...new Set<string>([...Object.keys(facets?.actors ?? {}), ...filters.actors]),
  ];
  const actorRows = actorKeys
    .map((key) => {
      const { type, id } = inboxActorKeyParts(key);
      return {
        key,
        type,
        id,
        name:
          type === "system" ? t("inbox.archivedFiltersFrom") : getName(type as "member" | "agent" | "squad", id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const section = (title: string) => (
    <View className="bg-muted/40 px-4 py-1.5">
      <Text className="text-caption font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </Text>
    </View>
  );

  const row = ({
    key,
    label,
    count,
    checked,
    onPress,
    leading,
  }: {
    key: string;
    label: string;
    count: number;
    checked: boolean;
    onPress: () => void;
    leading?: React.ReactNode;
  }) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${label}, ${count}`}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
    >
      <Ionicons
        name={checked ? "checkbox" : "square-outline"}
        size={20}
        color={checked ? theme.primary : theme.mutedForeground}
      />
      {leading}
      <Text className="flex-1 text-body text-foreground" numberOfLines={1}>
        {label}
      </Text>
      {/* Zero-count options stay visible but print nothing: "0" beside a row
          the user cannot reach reads as broken, while an absent number reads
          as "none right now". The checkbox stays so a selection made under a
          different filter combination can still be switched off. */}
      {count > 0 ? (
        <Text className="text-caption tabular-nums text-muted-foreground">
          {t("inbox.archivedNotificationCount", { count })}
        </Text>
      ) : null}
    </Pressable>
  );

  return (
    <PickerSheet
      title={title}
      visible={visible}
      onClose={onClose}
      fill
    >
      <View className="flex-1">
        <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
          {/* Facet fetch state. Shown in place of the counts rather than
              replacing the sheet: the toggles still work (they filter
              server-side regardless of whether the menu could count), so a
              failed count must not block the filter itself. Absent entirely
              for a caller whose counts cannot fail (see `facetsError`). */}
          {facetsError && onRetryFacets ? (
            <View className="px-4 py-2 flex-row items-center gap-3">
              <Text className="flex-1 text-caption text-destructive">
                {t("inbox.archivedFiltersFailed")}
              </Text>
              <Pressable
                onPress={onRetryFacets}
                accessibilityRole="button"
                hitSlop={8}
                className="py-1"
              >
                <Text className="text-caption font-medium text-foreground">
                  {t("common.retry")}
                </Text>
              </Pressable>
            </View>
          ) : facetsLoading && !facets ? (
            <View className="px-4 py-2">
              <Text className="text-caption text-muted-foreground">
                {t("inbox.archivedLoadingMore")}
              </Text>
            </View>
          ) : null}

          {section(t("inbox.archivedFiltersUnreadOnly"))}
          {row({
            key: "unread",
            label: t("inbox.archivedFiltersUnreadOnly"),
            count: facets?.unreadCount ?? 0,
            checked: filters.unreadOnly,
            onPress: onToggleUnreadOnly,
            leading: (
              <Ionicons
                name="mail-outline"
                size={16}
                color={theme.mutedForeground}
              />
            ),
          })}

          {section(t("inbox.archivedFiltersStatus"))}
          {statusKeys.length === 0 ? (
            <EmptyRow />
          ) : (
            statusKeys.map((key) => {
              const entry = statusCatalog.entryOf(key);
              return row({
                key: `status:${key}`,
                label: entry?.name ?? t(`enum.status.${key}`),
                count: facets?.statuses?.[key] ?? 0,
                checked: filters.statuses.includes(key),
                onPress: () => onToggleStatus(key),
                leading: (
                  <StatusIcon
                    status={key}
                    category={entry?.category}
                    color={entry?.is_system ? undefined : (entry?.color ?? undefined)}
                    size={16}
                  />
                ),
              });
            })
          )}

          {showsPriorityFilter(prioritySupport) ? (
            <>
              {section(t("inbox.archivedFiltersPriority"))}
              {INBOX_PRIORITY_FILTER_ORDER.map((priority) =>
                row({
                  key: `priority:${priority}`,
                  label: t(`enum.priority.${priority}`),
                  count: facets?.priorities?.[priority] ?? 0,
                  checked: filters.priorities.includes(priority),
                  onPress: () => onTogglePriority(priority),
                  leading: <PriorityIcon priority={priority} size={16} />,
                }),
              )}
            </>
          ) : null}

          {section(t("inbox.archivedFiltersFrom"))}
          {actorRows.length === 0 ? (
            <EmptyRow />
          ) : (
            actorRows.map((actor) =>
              row({
                key: `actor:${actor.key}`,
                label: actor.name,
                count: facets?.actors?.[actor.key] ?? 0,
                checked: filters.actors.includes(actor.key),
                onPress: () => onToggleActor(actor.key),
                leading: (
                  <ActorAvatar
                    type={actor.type as "member" | "agent" | "system" | "squad"}
                    id={actor.id}
                    size={22}
                  />
                ),
              }),
            )
          )}
        </ScrollView>

        {/* Clear — web puts this on the trigger (`inbox-filter-menu.tsx`);
            the sheet's own footer is the mobile equivalent, and it stays
            disabled until something is actually active so it never reads as
            a no-op. */}
        <View className="border-t border-border px-4 py-3">
          <Pressable
            onPress={onClear}
            disabled={activeCount === 0}
            accessibilityRole="button"
            accessibilityState={{ disabled: activeCount === 0 }}
            accessibilityLabel={t("inbox.archivedFiltersClear")}
            className={cn(
              "items-center rounded-lg py-2.5",
              activeCount === 0 ? "opacity-40" : "active:bg-secondary",
            )}
          >
            <Text className="text-body font-medium text-foreground">
              {t("inbox.archivedFiltersClear")}
            </Text>
          </Pressable>
        </View>
      </View>
    </PickerSheet>
  );
}

/** Placeholder for a dimension with no options in the current selection —
 *  keeps the section headers stable (see the module doc). */
function EmptyRow() {
  const { t } = useTranslation();
  return (
    <View className="px-4 py-3">
      <Text className="text-body text-muted-foreground">
        {t("inbox.archivedFiltersNoOptions")}
      </Text>
    </View>
  );
}
