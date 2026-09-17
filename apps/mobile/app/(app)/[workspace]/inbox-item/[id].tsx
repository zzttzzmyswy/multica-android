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
import { useQuery } from "@tanstack/react-query";
import type { InboxItem } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { typeLabel } from "@/components/inbox/detail-label";
import { inboxBucketOptions } from "@/data/queries/inbox";
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
} from "@/lib/inbox-item-source";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";

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
  const phase = inboxItemPhase({
    hasItem: !!activeItem,
    workspaceReady: !!wsId,
    fetching: primaryQuery.isFetching || fallbackQuery.isFetching,
  });

  const archive = useArchiveInbox();
  const unarchive = useUnarchiveInbox();

  const editSeed = activeItem ? getQuickCreateEditSeed(activeItem) : null;

  const onToggleArchive = () => {
    if (!activeItem) return;
    const mutate =
      archiveMode === "archive" ? archive : unarchive;
    mutate.mutate(activeItem.id, { onSuccess: () => router.back() });
  };

  const onEditAdvanced = () => {
    if (!activeItem || !editSeed || !wsSlug) return;
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

  if (!activeItem) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8 gap-2">
        <Text className="text-sm text-muted-foreground text-center">
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
          title: typeLabel(t, activeItem.type),
          headerBackTitle: t("common.back"),
        }}
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-5 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-xl font-semibold text-foreground leading-snug">
          {getInboxDisplayTitle(activeItem)}
        </Text>
        <Text className="mt-1 text-sm text-muted-foreground">
          {typeLabel(t, activeItem.type)}
          {" · "}
          {timeAgo(activeItem.created_at)}
        </Text>

        {activeItem.body ? (
          <Text className="mt-4 text-sm leading-relaxed text-foreground">
            {activeItem.body}
          </Text>
        ) : null}

        {editSeed ? (
          <View className="mt-4 rounded-md border border-border bg-muted/40 p-3">
            <Text className="text-xs font-medium text-muted-foreground">
              {t("inbox.detail.originalInput")}
            </Text>
            <Text className="mt-1 text-sm leading-relaxed text-foreground">
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
