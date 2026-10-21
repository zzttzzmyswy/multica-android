/**
 * Inbox notification detail — for inbox rows WITHOUT an issue behind them
 * (`issue_id` null: failed / unconfirmed quick-create, plain email-style
 * notifications). Rows that DO carry an issue_id push straight to
 * `issue/[id]`; only the messageless tail lands here.
 *
 * Layout mirrors web's inbox-page.tsx notification panel: title, kind · time,
 * body, the quick-create "Original input" card, and the toggle action row —
 * the Archive / Unarchive button reverses the view the item is being read in
 * (main → Archive, archived → Unarchive) plus the quick-create
 * "Edit as advanced form" recovery link that reseeds the new-issue form with
 * the original prompt (and agent hint).
 *
 * The screen is reachable by deep link, so it can mount with a cold query
 * cache — nothing has listed this notification in this process. It therefore
 * reads the list through `useQuery` rather than off the cache: a miss fetches
 * instead of being mistaken for a deleted notification, and "not found yet" is
 * rendered as loading rather than as the missing state. Which list to read and
 * which state to render is `lib/inbox-item-source.ts`.
 */
import { View, ScrollView, ActivityIndicator } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { InboxItem } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { CatalogStatus } from "@/components/catalog/catalog-status";
import { typeLabel } from "@/components/inbox/detail-label";
import {
  archivedInboxLookupOptions,
  inboxBucketOptions,
} from "@/data/queries/inbox";
import { useArchiveInbox, useUnarchiveInbox } from "@/data/mutations/inbox";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  getInboxArchiveMode,
  getInboxDisplayTitle,
  getQuickCreateEditSeed,
} from "@/lib/inbox-display";
import {
  inboxItemBuckets,
  inboxItemPhase,
  shouldFetchFallback,
  shouldLookupArchivedItem,
} from "@/lib/inbox-item-source";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";

/**
 * The lookup's filter set is empty on purpose — see the call site. Declared at
 * module scope so the query key holds a stable shape across renders: a fresh
 * object literal would still serialize identically (the key is normalized),
 * but an inline literal next to a `useQuery` reads as "this varies".
 */
const EMPTY_ARCHIVED_FILTERS = {
  statuses: [] as const,
  priorities: [] as const,
  actors: [] as const,
  unreadOnly: false,
};

/**
 * True once the cache entry at `queryKey` is in the error state.
 *
 * Exists because this screen's lookup gate has to read the lookup's own
 * failure while BUILDING that lookup — a query object cannot reference itself
 * in its own initializer (TS7022/TS2448), and hard-coding the flag to `false`
 * would re-arm a failing request on every render. Subscribing to the key
 * instead breaks the cycle: the failure lands in the cache, this re-renders,
 * and the next `enabled` evaluation sees it.
 *
 * `queryClient.getQueryCache()`'s notify manager already suppresses
 * notifications while a render is in flight, so this cannot loop on its own
 * subscription.
 */
function useQueryFailed(queryKey: readonly unknown[]): boolean {
  const qc = useQueryClient();
  return useSyncExternalStore(
    (onChange) => qc.getQueryCache().subscribe(onChange),
    () => qc.getQueryState(queryKey)?.status === "error",
    // Server snapshot: this screen has no SSR pass, but supplying one keeps
    // the hook total and matches how the rest of the app calls it.
    () => false,
  );
}

export default function InboxItemDetail() {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  const { id, workspace: wsSlug, view } = useLocalSearchParams<{
    id: string;
    workspace: string;
    // Which list the user was reading — the archive toggle reverses with it.
    view?: string;
  }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [primary, fallback] = inboxItemBuckets(view);
  const readFrom = primary;
  const archiveMode = getInboxArchiveMode(readFrom);

  const primaryQuery = useQuery(inboxBucketOptions(primary, wsId));
  const primaryItem = findRow(primaryQuery.data, id);

  // The other list is only worth a request once the primary has answered
  // without the row: an archived notification opened from a deep link carries
  // no `view` param, so only the archive holds it. A cache hit never fetches.
  const fallbackQuery = useQuery({
    ...inboxBucketOptions(fallback, wsId),
    enabled: shouldFetchFallback({
      workspaceReady: !!wsId,
      primarySettled: primaryQuery.isFetched,
      hasPrimaryItem: !!primaryItem,
    }),
  });

  const activeItem = primaryItem ?? findRow(fallbackQuery.data, id);

  // Third read, for the case both lists miss. Neither is complete: the legacy
  // archive endpoint caps at 200 GROUPS server-side (314 rows / 200 groups
  // against 1,287 archived groups on this deployment) and the paged endpoint
  // is read here only at page one. A notification past either bound is absent
  // from both, which used to render as 「这条通知已不可用。」 — an absence
  // asserted from reads that never covered it. `group_id` resolves it
  // directly. See `shouldLookupArchivedItem` for the gates and the live
  // evidence.
  const lookupOptions = archivedInboxLookupOptions(
    wsId,
    id,
    // Unfiltered: this screen has no filter UI, and the server's default (no
    // dimensions set) matches what the two lists above return. Sending the
    // inbox tab's live selection instead would make a deep link fail whenever
    // the reader had a filter on in another tab.
    EMPTY_ARCHIVED_FILTERS,
  );
  // Read BEFORE the query so the gate can see the lookup's own failure without
  // the query object referring to itself (a self-referential initializer does
  // not typecheck). React Query keeps an errored entry's state when `enabled`
  // flips false, so this is what stops the gate re-arming on every render —
  // and unlike a `useRef` latch it clears by itself when the entry does (a
  // different notification, or the retry below), which is exactly when a retry
  // IS wanted.
  const lookupFailed = useQueryFailed(lookupOptions.queryKey);

  const lookupQuery = useQuery({
    ...lookupOptions,
    enabled: shouldLookupArchivedItem({
      workspaceReady: !!wsId,
      hasItem: !!activeItem,
      failed: primaryQuery.isError || fallbackQuery.isError,
      lookupFailed,
      notificationId: id,
    }),
  });

  const lookedUpItem = lookupQuery.data?.items.find((row) => row.id === id);
  const resolvedItem = activeItem ?? lookedUpItem;
  const phase = inboxItemPhase({
    hasItem: !!resolvedItem,
    workspaceReady: !!wsId,
    fetching:
      primaryQuery.isFetching ||
      fallbackQuery.isFetching ||
      lookupQuery.isFetching,
    // A failed list read is a third thing: not "still arriving", not "gone".
    // Without this the screen asserted the notification no longer existed.
    failed: primaryQuery.isError || fallbackQuery.isError || lookupQuery.isError,
  });

  const archive = useArchiveInbox();
  const unarchive = useUnarchiveInbox();

  const editSeed = resolvedItem ? getQuickCreateEditSeed(resolvedItem) : null;

  const onToggleArchive = () => {
    if (!resolvedItem) return;
    const mutate =
      archiveMode === "archive" ? archive : unarchive;
    mutate.mutate(resolvedItem.id, { onSuccess: () => router.back() });
  };

  const onEditAdvanced = () => {
    if (!resolvedItem || !editSeed || !wsSlug) return;
    router.push({
      pathname: "/[workspace]/new-issue",
      params: {
        workspace: wsSlug,
        seedDescription: editSeed.description,
        ...(editSeed.agentId ? { seedAssigneeId: editSeed.agentId } : {}),
      },
    });
  };

  if (phase === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  // A failed read gets the failure and a retry, never the missing sentence: the
  // notification is reachable, we just could not reach it from here. This used
  // to fall through to the not-found branch, whose copy also invites the user to
  // accept a notification loss that did not happen.
  if (phase === "error") {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <CatalogStatus
          state="error"
          onRetry={() => {
            void primaryQuery.refetch();
            if (fallbackQuery.isError) void fallbackQuery.refetch();
          }}
          layout="centered"
        />
      </View>
    );
  }

  if (!resolvedItem) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8 gap-2">
        <Text className="text-body text-muted-foreground text-center">
          {t("inbox.detail.notificationMissing")}
        </Text>
      </View>
    );
  }

  const archiveKey =
    archiveMode === "archive" ? "inbox.detail.archive" : "inbox.detail.unarchive";

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: typeLabel(t, resolvedItem.type),
          headerBackTitle: t("common.back"),
        }}
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-5 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-title-lg font-semibold text-foreground leading-snug">
          {getInboxDisplayTitle(resolvedItem)}
        </Text>
        <Text className="mt-1 text-body text-muted-foreground">
          {typeLabel(t, resolvedItem.type)}
          {" · "}
          {timeAgo(resolvedItem.created_at)}
        </Text>

        {resolvedItem.body ? (
          <Text className="mt-4 text-body leading-relaxed text-foreground">
            {resolvedItem.body}
          </Text>
        ) : null}

        {editSeed ? (
          <View className="mt-4 rounded-md border border-border bg-muted/40 p-3">
            <Text className="text-caption font-medium text-muted-foreground">
              {t("inbox.detail.originalInput")}
            </Text>
            <Text className="mt-1 text-body leading-relaxed text-foreground">
              {editSeed.description}
            </Text>
          </View>
        ) : null}

        <View className="mt-4 flex-row flex-wrap gap-2">
          {editSeed ? (
            <Button variant="outline" onPress={onEditAdvanced}>
              <Text>{t("inbox.detail.editAdvanced")}</Text>
            </Button>
          ) : null}
          <Button variant="outline" onPress={onToggleArchive}>
            <Text>{t(archiveKey)}</Text>
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}

/** The row with this id in a fetched (or cached) inbox list, if it is there. */
function findRow(rows: InboxItem[] | undefined, id: string): InboxItem | undefined {
  return rows?.find((row) => row.id === id);
}
