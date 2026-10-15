import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  View,
} from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { InboxItem } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Header } from "@/components/ui/header";
import { IconButton } from "@/components/ui/icon-button";
import { HeaderActions } from "@/components/ui/app-header-actions";
import { SwipeableInboxRow } from "@/components/inbox/swipeable-inbox-row";
import { InboxArchiveFilterSheet } from "@/components/inbox/inbox-archive-filter-sheet";
import { InboxArchiveListFooter } from "@/components/inbox/inbox-archive-list-footer";
import {
  archivedInboxFacetsOptions,
  archivedInboxListOptions,
  archivedInboxPagesOptions,
  inboxListOptions,
} from "@/data/queries/inbox";
import {
  useArchiveAllInbox,
  useArchiveAllReadInbox,
  useArchiveCompletedInbox,
  useArchiveInbox,
  useMarkAllInboxRead,
  useMarkInboxRead,
  useMarkInboxUnread,
  useUnarchiveInbox,
} from "@/data/mutations/inbox";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { ActionSheet } from "@/lib/action-sheet";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import {
  deduplicateArchivedInboxItems,
  deduplicateInboxItems,
  getInboxDisplayTitle,
} from "@/lib/inbox-display";
import {
  archivedCountUnavailable,
  archivedEmptyReason,
  archivedEntryCount,
  archivedInboxTotal,
  archivedPriorityFilterSupport,
  archivedRowsFromPages,
  hasPagedBeyondFirst,
} from "@/lib/inbox-archive-view";
import {
  inboxLocalFacets,
  mainInboxEmptyReason,
} from "@/lib/inbox-main-view";
import {
  EMPTY_INBOX_FILTERS as EMPTY_FILTERS,
  filterInboxItems,
  inboxFilterCount,
  inboxFiltersForPrioritySupport,
  inboxPriorityFilterSupport,
  useInboxFilterStore,
  useInboxFilters,
} from "@/lib/inbox-filters";

// Both inbox lists (main + archived) share one row-separator shape: a hairline
// under each row aligned to the avatar gutter (avatar starts at px-4 → 36pt →
// 16pt indent). Module-level so FlatList never allocates a new component type
// per render (an inline `ItemSeparatorComponent={() => …}` also defeats
// FlatList's row separators reuse).
function InboxSeparator() {
  return <View className="h-px bg-border ml-16" />;
}

export default function Inbox() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const { data: rawItems, isLoading, error, refetch, isRefetching } = useQuery(
    inboxListOptions(wsId),
  );
  // Dedup + drop archived to match web/desktop. See CLAUDE.md
  // "Behavioral parity" → inbox dedup incident.
  const data = useMemo(
    () => deduplicateInboxItems(rawItems ?? []),
    [rawItems],
  );
  // Archived sub-view. The list is the CURSOR-PAGED endpoint, not the capped
  // one: `/api/inbox/archived` carries a server-side LIMIT, so past its bound
  // the rest of the archive is simply unreachable from here — and since the
  // archive only grows, that blind spot only widens. Pages are deduplicated
  // across their boundaries by `archivedRowsFromPages`.
  const filters = useInboxFilters(wsId);
  const clearFilters = useInboxFilterStore((s) => s.clearFilters);
  const toggleStatusFilter = useInboxFilterStore((s) => s.toggleStatusFilter);
  const togglePriorityFilter = useInboxFilterStore((s) => s.togglePriorityFilter);
  const toggleActorFilter = useInboxFilterStore((s) => s.toggleActorFilter);
  const toggleUnreadOnly = useInboxFilterStore((s) => s.toggleUnreadOnly);

  // -- Main list's filter layer -------------------------------------------
  //
  // The four dimensions apply to BOTH lists. Web renders one
  // `InboxFilterMenu` for the two of them (`inbox-page.tsx:513-518`) and
  // filters the main list through `filterInboxItems` just like the archive
  // (`:153`); mobile had the filter store, the predicate, the counts and the
  // sheet, and wired them only into the archived branch — so the main inbox,
  // 339 groups on this deployment, could only be scrolled.
  //
  // The capability probe reads the RAW response, not the deduplicated list.
  // Whether the backend projects `issue_priority` is a property of the wire
  // format, and dedup discards rows: probing the dedup result would let a
  // list that happens to dedup to nothing answer "unknown" about a response
  // that plainly carries the field. Web probes `rawItems` for the same reason
  // (`inbox-page.tsx:151`), and the archived view hardcodes `"supported"`
  // because its paged endpoint guarantees the projection — two different
  // answers to the same question, each derived from its own source of truth.
  const rawMainItems = useMemo(() => rawItems ?? [], [rawItems]);
  const mainPrioritySupport = inboxPriorityFilterSupport(rawMainItems);
  // The copy the REQUEST and the badge use. `unknown` and `unsupported` strip
  // a priority selection rather than keeping one the backend cannot honour —
  // see `inboxFiltersForPrioritySupport`. The store keeps the user's choice, so
  // a backend that starts reporting the field brings it back.
  const mainFilters = useMemo(
    () => inboxFiltersForPrioritySupport(filters, mainPrioritySupport),
    [filters, mainPrioritySupport],
  );
  const mainActiveFilterCount = inboxFilterCount(mainFilters);
  // The list the main view DRAWS. Filtering the deduplicated rows rather than
  // the raw response keeps the two in step: dedup drops an issue's older
  // notifications in favour of its newest, and filtering first would let a
  // row that dedup was about to discard decide whether the surviving row
  // matches.
  const visibleData = useMemo(
    () => filterInboxItems(data, mainFilters),
    [data, mainFilters],
  );
  // Counts over the same list, each respecting the other dimensions and
  // ignoring its own — web's main-view rule (`inbox-filter-menu.tsx:139-176`).
  const mainFacets = useMemo(
    () => inboxLocalFacets(data, mainFilters),
    [data, mainFilters],
  );
  const mainEmptyReason = mainInboxEmptyReason({
    visibleCount: visibleData.length,
    activeFilterCount: mainActiveFilterCount,
  });

  // Which view is showing. Local state, not URL-synced — mobile follows the
  // chat archive precedent (web keeps it in ?view=, a shared-link concern
  // this app doesn't have). `filtersOpen` is declared alongside it because the
  // facets query below is gated on it.
  const [view, setView] = useState<"inbox" | "archived">("inbox");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Gated on the view, matching web (`enabled: isArchivedView`): these are the
  // archive's rows, and fetching a page of them while the user reads the main
  // inbox would spend a request and 50 rows of memory on a list nobody asked
  // for. The entry row's COUNT does not need them — it comes from the facets
  // query below, which is a few hundred bytes of counts.
  const {
    data: archivedPages,
    isLoading: archivedLoading,
    isError: archivedError,
    error: archivedErrorObj,
    refetch: refetchArchived,
    isRefetching: isRefetchingArchived,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteQuery({
    ...archivedInboxPagesOptions(wsId, filters),
    enabled: !!wsId && view === "archived",
  });

  // Unfiltered facets, for the entry row's count. The archive's size must not
  // change when the user narrows the list, or the number under the main inbox
  // would describe their last filter instead of the archive. Keyed by the
  // empty filter set, so it is its own cache entry — and the one archive
  // request that runs in both views, because the entry row is rendered in both.
  const {
    data: archivedFacets,
    isError: facetsUnavailable,
    isPending: facetsPending,
  } = useQuery({
    ...archivedInboxFacetsOptions(wsId, EMPTY_FILTERS),
    enabled: !!wsId,
  });

  // Fallback for a server with no facets endpoint: the capped legacy list,
  // fetched ONLY when the facets failed and only while the main view is
  // showing. It is a lower bound (that endpoint's own LIMIT), which is why it
  // is a fallback and not the source. `retry: false` because a 404 on an
  // endpoint the server does not have is not worth three attempts.
  const legacyArchivedQuery = useQuery({
    ...archivedInboxListOptions(wsId),
    enabled: !!wsId && view === "inbox" && facetsUnavailable,
    retry: false,
  });
  const legacyRowCount = useMemo(
    () =>
      legacyArchivedQuery.data
        ? deduplicateArchivedInboxItems(legacyArchivedQuery.data).length
        : undefined,
    [legacyArchivedQuery.data],
  );

  // Facets for the filter menu: SAME filters as the list, because every count
  // is "how many rows selecting this would reveal" and that answer depends on
  // the other active dimensions. Enabled only while the sheet is open — the
  // counts are menu content, and fetching them for the background list would
  // be a request per filter change with nothing on screen to show for it.
  //
  // Gated on the archived view as well as the open sheet. Both lists now open
  // the same sheet, and the main list's counts are computed locally
  // (`inboxLocalFacets`) — so without this gate, opening the filter on the main
  // inbox would spend a request on the archive's facets and then discard the
  // answer. The archive's own counts are the only ones this query has ever
  // been for.
  const {
    data: facets,
    isLoading: facetsLoading,
    isError: facetsError,
    refetch: refetchFacets,
  } = useQuery({
    ...archivedInboxFacetsOptions(wsId, filters),
    enabled: !!wsId && filtersOpen && view === "archived",
  });

  // Every fetched page, flattened and deduplicated by issue ACROSS page
  // boundaries (see `archivedRowsFromPages`): the cursor pages by time, so one
  // issue's notifications can straddle two pages, and deduplicating per page
  // would render that issue twice.
  const rawArchivedItems = useMemo(
    () => archivedRowsFromPages(archivedPages?.pages),
    [archivedPages],
  );

  // Priority filtering is always available here, and this is NOT the
  // capability probe the main inbox uses. The paged endpoint guarantees the
  // projection: it selects `iss.priority AS issue_priority` in SQL, so every
  // row of every page carries the key — including rows with no linked issue,
  // which serialize `null`. Measured against the live server across the
  // unfiltered archive and four filter combinations: 938 rows, 0 missing.
  //
  // Probing it from the returned rows (as `inboxPriorityFilterSupport` does for
  // the main inbox, whose endpoint predates the column) would be worse than
  // redundant, it would be circular: the filtered response holds only rows the
  // priority filter matched, so a probe over it answers "did the server honour
  // what I sent" instead of "does this backend have priorities" — and an EMPTY
  // result answers "unknown", which `inboxFiltersForPrioritySupport` reads as
  // "cannot filter" and strips the selection. The header and the client-side
  // pass would then disagree with the request actually on the wire, which is
  // exactly what the device run showed: a list filtered to `priorities=urgent`
  // still labelled 910 with no filter badge. Web hardcodes `"supported"` for
  // the archived view for the same reason (`inbox-page.tsx:151`).
  const prioritySupport = archivedPriorityFilterSupport();

  // The server filters, so this should be a no-op on a settled page — it earns
  // its place on the edges: an optimistic unarchive lands here before the
  // invalidate refetches, and a filter toggled while a page is in flight must
  // not leave the now-excluded rows on screen.
  const archivedData = useMemo(
    () => filterInboxItems(rawArchivedItems, filters),
    [rawArchivedItems, filters],
  );
  const activeFilterCount = inboxFilterCount(filters);
  // The archive's real size — the facet total when the facets answered, and a
  // lower bound from the capped list when they could not (see
  // `archivedEntryCount`). Either way it is the archive, not the rows fetched
  // so far.
  const archivedTotal = archivedEntryCount({
    facetTotal: archivedInboxTotal(archivedFacets),
    facetsUnavailable,
    legacyRowCount,
  });
  const countUnavailable = archivedCountUnavailable({
    facetsUnavailable,
    fallbackPending: facetsPending || legacyArchivedQuery.isPending,
    fallbackUnavailable: legacyArchivedQuery.isError,
  });
  const emptyReason = archivedEmptyReason({
    visibleCount: archivedData.length,
    activeFilterCount,
  });

  // One entry point for "fetch the next page", shared by the footer's press
  // target and the list's `onEndReached`. `fetchNextPage` is a no-op with no
  // next page, and the in-flight guard stops a scroll from firing a second
  // request for the page a press already asked for.
  const loadNextArchivedPage = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const markRead = useMarkInboxRead();
  const markUnread = useMarkInboxUnread();
  const archive = useArchiveInbox();
  const unarchive = useUnarchiveInbox();
  const markAllRead = useMarkAllInboxRead();
  const archiveAll = useArchiveAllInbox();
  const archiveAllRead = useArchiveAllReadInbox();
  const archiveCompleted = useArchiveCompletedInbox();

  // Never strand the user on an empty archive: when the last archived issue is
  // restored (or a new notification revives it into the main inbox), fall back
  // to the main list. Gated on the load so a cold-open doesn't bounce before
  // the data lands, and on error so a failed fetch swaps the error message
  // for the main list and leaves the user with no idea it failed (web
  // inbox-page.tsx:188-208).
  //
  // Gated on `emptyReason` too, and that gate is the difference between a
  // helpful fallback and a bug: a filter that matches nothing also leaves the
  // list at zero, and bouncing the user to the main inbox there would eject
  // them from the archive for using its filter. Only a genuinely empty archive
  // falls back; a filtered-to-nothing one stays put and says so.
  useEffect(() => {
    if (view !== "archived") return;
    if (archivedLoading) return;
    if (archivedError) return;
    if (emptyReason !== "archive") return;
    setView("inbox");
  }, [view, archivedLoading, archivedError, emptyReason]);

  const onPressItem = (item: InboxItem) => {
    if (!item.read && view === "inbox") {
      // Optimistic read flip lives in useMarkInboxRead.onMutate — fires
      // setQueryData synchronously before the cancelQueries await, so the
      // row is already styled "read" by the time iOS captures the source
      // snapshot for the native stack push transition.
      markRead.mutate(item.id);
    }
    // Archived rows don't trigger markRead — the archived list carries no
    // unread dots and the server's unread count excludes archived items, so
    // a flip there would report success and change nothing on screen.
    if (!wsSlug) return;
    if (item.issue_id) {
      // Issue-backed notification → the issue detail screen. Carries the
      // inbox origin so that screen's header can offer the Archive /
      // Unarchive toggle (reversed by the view being read in) and the
      // marking of read — see issue/[id].tsx.
      router.push({
        pathname: "/[workspace]/issue/[id]",
        params: {
          workspace: wsSlug,
          id: item.issue_id,
          highlight: item.details?.comment_id,
          h: String(Date.now()),
          inbox: "1",
          inboxView: view,
          inboxItemId: item.id,
        },
      });
    } else {
      // Plain notification (failed / unconfirmed quick-create, email …) with
      // no issue behind it — its own detail screen with the archive toggle
      // and the quick-create recovery affordance.
      router.push({
        pathname: "/[workspace]/inbox-item/[id]",
        params: {
          workspace: wsSlug,
          id: item.id,
          view,
        },
      });
    }
  };

  // Long-press row menu — mirrors web's row context menu
  // (packages/views/inbox/components/inbox-item-actions.tsx):
  //   - main view: read-toggle (mark unread when read, mark read when not) +
  //     archive;
  //   - archived view: unarchive only. No read toggle there — archived rows
  //     are out of the unread count, and a toggle would report success and
  //     change nothing on screen.
  const onLongPressItem = (item: InboxItem) => {
    if (view === "archived") {
      ActionSheet.showActionSheetWithOptions(
        {
          options: [t("common.cancel"), t("inbox.menu.unarchive")],
          cancelButtonIndex: 0,
          title: getInboxDisplayTitle(item),
        },
        (i) => {
          if (i === 1) unarchive.mutate(item.id);
        },
      );
      return;
    }
    ActionSheet.showActionSheetWithOptions(
      {
        options: [
          t("common.cancel"),
          item.read ? t("inbox.menu.markUnread") : t("inbox.menu.markRead"),
          t("common.archive"),
        ],
        cancelButtonIndex: 0,
        title: getInboxDisplayTitle(item),
      },
      (i) => {
        if (i === 1) {
          if (item.read) markUnread.mutate(item.id);
          else markRead.mutate(item.id);
        } else if (i === 2) {
          archive.mutate(item.id);
        }
      },
    );
  };

  // Trailing batch menu — mirrors web's dropdown
  // (packages/views/inbox/components/inbox-page.tsx). "Mark all read" is
  // first (most common batch op); "Archive all" is destructive so it gets
  // the iOS red treatment + Alert confirm. Batch actions are MAIN-view only:
  // every entry archives from the main inbox, so offering them while the
  // archived list is on screen would read as "archive all of these" and do
  // the opposite (web hides the dropdown in the archived view too).
  const onPressMenu = () => {
    const options = [
      t("common.cancel"),
      t("inbox.menu.markAllRead"),
      t("inbox.menu.archiveAllRead"),
      t("inbox.menu.archiveCompleted"),
      t("inbox.menu.archiveAll"),
    ];
    ActionSheet.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex: 0,
        destructiveButtonIndex: 4,
        title: t("inbox.title"),
      },
      (i) => {
        if (i === 1) markAllRead.mutate();
        else if (i === 2) archiveAllRead.mutate();
        else if (i === 3) archiveCompleted.mutate();
        else if (i === 4) {
          Alert.alert(t("inbox.archiveAllTitle"), t("inbox.archiveAllMessage"), [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("inbox.menu.archiveAll"),
              style: "destructive",
              onPress: () => archiveAll.mutate(),
            },
          ]);
        }
      },
    );
  };

  // Entry into the archive, shown under the main list (and under the empty
  // state too — that is exactly when a user goes looking for what they filed
  // away). Hidden at zero and in the archived view. Placement mirrors web
  // inbox-list.tsx and chat's archive entry.
  //
  // The count is the archive's real size, from the facet totals — NOT the
  // length of the rows fetched so far. Those rows are one cursor page; printing
  // them here was the visible half of the silent truncation this iteration
  // fixes, because a user reads a number under "Archived" as the total. The
  // filters deliberately do not narrow it: this row reports the archive, not
  // the reader's last search inside it.
  const archivedEntry =
    view === "inbox" && (archivedTotal > 0 || countUnavailable) ? (
      <Pressable
        onPress={() => setView("archived")}
        accessibilityLabel={t("inbox.archivedTitle")}
        className="flex-row items-center gap-3 px-4 py-3 mt-1 active:bg-secondary"
      >
        <View className="h-9 w-9 items-center justify-center rounded-full bg-muted">
          <Ionicons
            name="archive-outline"
            size={16}
            className="text-muted-foreground"
          />
        </View>
        <Text className="flex-1 text-body font-medium text-muted-foreground">
          {t("inbox.archivedTitle")}
        </Text>
        <Text className="text-body text-muted-foreground tabular-nums">
          {countUnavailable ? "—" : archivedTotal}
        </Text>
        <Ionicons
          name="chevron-forward"
          size={14}
          className="text-muted-foreground"
        />
      </Pressable>
    ) : null;

  // Archived sub-view: back row (arrow + title + count), a filter control,
  // then the paged rows. Swipe action is Restore; the header's batch menu is
  // hidden. Same shape as chat's archived view.
  if (view === "archived") {
    return (
      <View className="flex-1 bg-background">
        <Header title={t("inbox.title")} right={<HeaderActions />} />
        <View className="flex-row items-center gap-2 px-4 pt-4 pb-3">
          <Pressable
            onPress={() => setView("inbox")}
            hitSlop={12}
            className="p-0.5"
            accessibilityLabel={t("common.back")}
          >
            <Ionicons
              name="chevron-back"
              size={22}
              className="text-foreground"
            />
          </Pressable>
          <Text className="flex-1 text-title-sm font-semibold text-foreground">
            {t("inbox.archivedTitle")}
          </Text>
          {/* The archive's real size, not the rows fetched so far — the same
              reasoning as the entry row in the main view. While a filter is
              active it reports the filtered count instead, because the list
              under it shows those rows: a total that disagreed with the list
              would read as the filter being broken. With no count available
              (a server without the facets endpoint, read from this view) an
              em dash stands in — inventing a number from the fetched pages
              would be the very conflation this iteration removes. */}
          <Text className="text-body text-muted-foreground tabular-nums">
            {activeFilterCount > 0
              ? archivedData.length
              : archivedTotal > 0
                ? archivedTotal
                : "—"}
          </Text>
          <Pressable
            onPress={() => setFiltersOpen(true)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={
              activeFilterCount > 0
                ? t("inbox.archivedFiltersActive", { count: activeFilterCount })
                : t("inbox.archivedFilters")
            }
            className="flex-row items-center gap-1 p-0.5"
          >
            <Ionicons
              name="filter-outline"
              size={18}
              color={
                activeFilterCount > 0
                  ? THEME[colorScheme].primary
                  : THEME[colorScheme].mutedForeground
              }
            />
            {/* The count beside the glyph, so an active filter is visible
                without opening the sheet — web puts the same number on its
                trigger (`inbox-filter-menu.tsx`). */}
            {activeFilterCount > 0 ? (
              <Text className="text-caption font-medium text-primary tabular-nums">
                {activeFilterCount}
              </Text>
            ) : null}
          </Pressable>
        </View>
        <InboxArchiveFilterSheet
          visible={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          title={t("inbox.archivedFilters")}
          wsId={wsId}
          filters={filters}
          facets={facets}
          facetsLoading={facetsLoading}
          facetsError={facetsError}
          onRetryFacets={() => void refetchFacets()}
          prioritySupport={prioritySupport}
          activeCount={activeFilterCount}
          onToggleStatus={(status) => wsId && toggleStatusFilter(wsId, status)}
          onTogglePriority={(priority) =>
            wsId && togglePriorityFilter(wsId, priority)
          }
          onToggleActor={(actor) => wsId && toggleActorFilter(wsId, actor)}
          onToggleUnreadOnly={() => wsId && toggleUnreadOnly(wsId)}
          onClear={() => wsId && clearFilters(wsId)}
        />
        {archivedLoading ? (
          <InboxLoading />
        ) : archivedError ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-body text-destructive">
              {t("inbox.archivedLoadError")}
              {archivedErrorObj instanceof Error
                ? archivedErrorObj.message
                : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetchArchived()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : emptyReason === "archive" ? (
          // Transient: the fallback effect flips to the main list as soon as
          // the (non-loading, non-error, unfiltered) archive is confirmed
          // empty.
          <InboxEmpty
            iconColor={THEME[colorScheme].mutedForeground}
            titleText={t("inbox.archivedEmpty")}
          />
        ) : emptyReason === "filtered" ? (
          // Deliberately NOT the empty-archive copy: nothing is missing, the
          // selection is just narrow. Wording says which, and the way out is
          // one press rather than backing out of the archive.
          <View className="flex-1 items-center justify-center px-8 gap-3">
            <Ionicons
              name="filter-outline"
              size={42}
              color={THEME[colorScheme].mutedForeground}
            />
            <Text className="text-title-sm font-medium text-foreground text-center">
              {t("inbox.archivedFilterEmpty")}
            </Text>
            <Button variant="outline" onPress={() => wsId && clearFilters(wsId)}>
              <Text>{t("inbox.archivedFiltersClear")}</Text>
            </Button>
          </View>
        ) : (
          <FlatList
            data={archivedData}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={InboxSeparator}
            initialNumToRender={12}
            windowSize={9}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={40}
            contentContainerClassName="pb-6"
            renderItem={({ item }) => (
              <SwipeableInboxRow
                item={item}
                action="restore"
                archived
                onPress={() => onPressItem(item)}
                onAction={() => unarchive.mutate(item.id)}
                onLongPress={() => onLongPressItem(item)}
              />
            )}
            // Touch-to-load-more is the footer's press target; `onEndReached`
            // also fires when the user scrolls to the bottom, which is what
            // makes the list feel continuous. Both go through one guard so a
            // scroll cannot double-fetch a page the press already asked for.
            onEndReached={loadNextArchivedPage}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              <InboxArchiveListFooter
                hasMore={!!hasNextPage}
                isLoadingMore={isFetchingNextPage}
                isError={isFetchNextPageError}
                paged={hasPagedBeyondFirst(archivedPages?.pages.length ?? 0)}
                onLoadMore={loadNextArchivedPage}
                onRetry={loadNextArchivedPage}
              />
            }
            refreshing={isRefetchingArchived}
            onRefresh={refetchArchived}
          />
        )}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Header
        title={t("inbox.title")}
        right={
          <>
            {/* The filter entry. Web puts one `InboxFilterMenu` beside the
                title and passes it whichever list is on screen
                (`inbox-page.tsx:513-518`); mobile had it only inside the
                archived branch, so the main list had no way to narrow. Same
                trigger shape as the archived sub-view's, one screen up.
                `h-10 min-w-10` matches the neighbouring `IconButton`'s touch
                target; web's trigger widens to fit the count the same way
                (`w-auto px-2`), and the glyph plus count is the idiom the
                archived sub-view already uses. */}
            <Pressable
              onPress={() => setFiltersOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                mainActiveFilterCount > 0
                  ? t("inbox.filtersActive", { count: mainActiveFilterCount })
                  : t("inbox.filters")
              }
              className="h-10 min-w-10 flex-row items-center justify-center gap-1 px-1.5 active:bg-accent rounded-md"
            >
              <Ionicons
                name="filter-outline"
                size={20}
                color={
                  mainActiveFilterCount > 0
                    ? THEME[colorScheme].primary
                    : THEME[colorScheme].foreground
                }
              />
              {mainActiveFilterCount > 0 ? (
                <Text className="text-caption font-medium text-primary tabular-nums">
                  {mainActiveFilterCount}
                </Text>
              ) : null}
            </Pressable>
            <IconButton
              name="ellipsis-horizontal"
              onPress={onPressMenu}
              accessibilityLabel={t("inbox.actions")}
            />
            <HeaderActions />
          </>
        }
      />
      <InboxArchiveFilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={t("inbox.filters")}
        wsId={wsId}
        filters={mainFilters}
        facets={mainFacets}
        facetsLoading={false}
        prioritySupport={mainPrioritySupport}
        activeCount={mainActiveFilterCount}
        onToggleStatus={(status) => wsId && toggleStatusFilter(wsId, status)}
        onTogglePriority={(priority) =>
          wsId && togglePriorityFilter(wsId, priority)
        }
        onToggleActor={(actor) => wsId && toggleActorFilter(wsId, actor)}
        onToggleUnreadOnly={() => wsId && toggleUnreadOnly(wsId)}
        onClear={() => wsId && clearFilters(wsId)}
      />
      {isLoading ? (
        <InboxLoading />
      ) : error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-body text-destructive">
            {t("inbox.loadError")}
            {error instanceof Error ? error.message : t("common.unknownError")}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>{t("workspace.retry")}</Text>
          </Button>
        </View>
      ) : mainEmptyReason !== "none" ? (
        <View className="flex-1">
          {mainEmptyReason === "filtered" ? (
            // Deliberately NOT the empty-inbox copy: the inbox is not empty,
            // the selection is just narrow — and on this deployment it is
            // narrow enough to hide all 339 groups. Web draws the same
            // distinction (`inbox-page.tsx:602-617`), and the way out is one
            // press rather than clearing four dimensions by hand.
            <View className="flex-1 items-center justify-center px-8 gap-3">
              <Ionicons
                name="filter-outline"
                size={42}
                color={THEME[colorScheme].mutedForeground}
              />
              <Text className="text-title-sm font-medium text-foreground text-center">
                {t("inbox.filterEmpty")}
              </Text>
              <Button variant="outline" onPress={() => wsId && clearFilters(wsId)}>
                <Text>{t("inbox.archivedFiltersClear")}</Text>
              </Button>
            </View>
          ) : (
            <InboxEmpty
              iconColor={THEME[colorScheme].mutedForeground}
              titleText={t("inbox.zero")}
              subtitleText={t("inbox.emptySubtitle")}
            />
          )}
          {/* The archive entry is shown under BOTH empty states, matching
              web: its `InboxList` renders the footer (which carries this
              entry) in its empty branch whatever the label
              (`inbox-list.tsx:201-217`). "Nothing matches my filter" must not
              also hide the way to the archive, which is where a user who
              filed something away goes looking. */}
          {archivedEntry}
        </View>
      ) : (
        <FlatList
          data={visibleData}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={InboxSeparator}
          initialNumToRender={12}
          windowSize={9}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={40}
          contentContainerClassName="pb-6"
          ListFooterComponent={archivedEntry}
          renderItem={({ item }) => (
            <SwipeableInboxRow
              item={item}
              action="archive"
              onPress={() => onPressItem(item)}
              onAction={() => archive.mutate(item.id)}
              onLongPress={() => onLongPressItem(item)}
            />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
        />
      )}
    </View>
  );
}

// Loading state — 6 row-shaped Skeletons matching InboxRow's layout
// (avatar circle + two text lines). Perceived perf wins over a centered
// spinner because the eye immediately sees the list-like structure.
function InboxLoading() {
  return (
    <View className="px-4 pt-4 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} className="flex-row gap-3">
          <Skeleton className="size-9 rounded-full" />
          <View className="flex-1 gap-2 pt-1">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </View>
        </View>
      ))}
    </View>
  );
}

function InboxEmpty({
  iconColor,
  titleText,
  subtitleText,
}: {
  iconColor: string;
  titleText: string;
  subtitleText?: string;
}) {
  return (
    <View className="flex-1 items-center justify-center px-8 gap-3">
      <Ionicons name="mail-open-outline" size={42} color={iconColor} />
      <Text className="text-title-sm font-medium text-foreground text-center">
        {titleText}
      </Text>
      {subtitleText ? (
        <Text className="text-body text-muted-foreground text-center">
          {subtitleText}
        </Text>
      ) : null}
    </View>
  );
}