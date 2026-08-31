import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
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
import {
  archivedInboxListOptions,
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
  // Archived sub-view. Fetched in BOTH views, not just the archived one: the
  // main list's entry into the archive is labelled with this count, so it has
  // to be known before the user goes there (web inbox-page.tsx:104-112).
  const {
    data: rawArchivedItems,
    isLoading: archivedLoading,
    isError: archivedError,
    error: archivedErrorObj,
    refetch: refetchArchived,
    isRefetching: isRefetchingArchived,
  } = useQuery(archivedInboxListOptions(wsId));
  const archivedData = useMemo(
    () => deduplicateArchivedInboxItems(rawArchivedItems ?? []),
    [rawArchivedItems],
  );

  const markRead = useMarkInboxRead();
  const markUnread = useMarkInboxUnread();
  const archive = useArchiveInbox();
  const unarchive = useUnarchiveInbox();
  const markAllRead = useMarkAllInboxRead();
  const archiveAll = useArchiveAllInbox();
  const archiveAllRead = useArchiveAllReadInbox();
  const archiveCompleted = useArchiveCompletedInbox();

  // Which view is showing. Local state, not URL-synced — mobile follows the
  // chat archive precedent (web keeps it in ?view=, a shared-link concern
  // this app doesn't have).
  const [view, setView] = useState<"inbox" | "archived">("inbox");

  // Never strand the user on an empty archive: when the last archived issue is
  // restored (or a new notification revives it into the main inbox), fall back
  // to the main list. Gated on the load so a cold-open doesn't bounce before
  // the data lands, and on error so a failed fetch swaps the error message
  // for the main list and leaves the user with no idea it failed (web
  // inbox-page.tsx:188-208).
  useEffect(() => {
    if (view !== "archived") return;
    if (archivedLoading) return;
    if (archivedError) return;
    if (archivedData.length > 0) return;
    setView("inbox");
  }, [view, archivedLoading, archivedError, archivedData.length]);

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
  const archivedEntry =
    view === "inbox" && archivedData.length > 0 ? (
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
        <Text className="flex-1 text-sm font-medium text-muted-foreground">
          {t("inbox.archivedTitle")}
        </Text>
        <Text className="text-sm text-muted-foreground tabular-nums">
          {archivedData.length}
        </Text>
        <Ionicons
          name="chevron-forward"
          size={14}
          className="text-muted-foreground"
        />
      </Pressable>
    ) : null;

  // Archived sub-view: back row (arrow + title + count), then the archived
  // rows. Swipe action is Restore; the header's batch menu is hidden. Same
  // shape as chat's archived view.
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
          <Text className="flex-1 text-base font-semibold text-foreground">
            {t("inbox.archivedTitle")}
          </Text>
          <Text className="text-sm text-muted-foreground tabular-nums">
            {archivedData.length}
          </Text>
        </View>
        {archivedLoading ? (
          <InboxLoading />
        ) : archivedError ? (
          <View className="px-4 gap-3 pt-4">
            <Text className="text-sm text-destructive">
              {t("inbox.archivedLoadError")}
              {archivedErrorObj instanceof Error
                ? archivedErrorObj.message
                : t("common.unknownError")}
            </Text>
            <Button variant="outline" onPress={() => refetchArchived()}>
              <Text>{t("workspace.retry")}</Text>
            </Button>
          </View>
        ) : archivedData.length === 0 ? (
          // Transient: the fallback effect flips to the main list as soon as
          // the (non-loading, non-error) archive is confirmed empty.
          <InboxEmpty
            iconColor={THEME[colorScheme].mutedForeground}
            titleText={t("inbox.archivedEmpty")}
          />
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
            <IconButton
              name="ellipsis-horizontal"
              onPress={onPressMenu}
              accessibilityLabel={t("inbox.actions")}
            />
            <HeaderActions />
          </>
        }
      />
      {isLoading ? (
        <InboxLoading />
      ) : error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            {t("inbox.loadError")}
            {error instanceof Error ? error.message : t("common.unknownError")}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>{t("workspace.retry")}</Text>
          </Button>
        </View>
      ) : !data || data.length === 0 ? (
        <View className="flex-1">
          <InboxEmpty
            iconColor={THEME[colorScheme].mutedForeground}
            titleText={t("inbox.zero")}
            subtitleText={t("inbox.emptySubtitle")}
          />
          {archivedEntry}
        </View>
      ) : (
        <FlatList
          data={data}
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
      <Text className="text-base font-medium text-foreground text-center">
        {titleText}
      </Text>
      {subtitleText ? (
        <Text className="text-sm text-muted-foreground text-center">
          {subtitleText}
        </Text>
      ) : null}
    </View>
  );
}