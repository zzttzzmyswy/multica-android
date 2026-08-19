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
 * The item itself is read from the inbox query cache (the tab holds both lists
 * warm); an empty cache means the notification is gone — show the missing
 * state instead of a crash.
 */
import { View, ScrollView } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import type { InboxItem } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { typeLabel } from "@/components/inbox/detail-label";
import { inboxKeys } from "@/data/queries/inbox";
import { useArchiveInbox, useUnarchiveInbox } from "@/data/mutations/inbox";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  getInboxArchiveMode,
  getInboxDisplayTitle,
  getQuickCreateEditSeed,
} from "@/lib/inbox-display";
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
  const qc = useQueryClient();
  const readFrom = view === "archived" ? "archived" : "inbox";
  const archiveMode = getInboxArchiveMode(readFrom);

  const activeItem =
    lookupCached(id, qc, wsId, readFrom) ?? lookupCached(id, qc, wsId, readFrom === "archived" ? "inbox" : "archived");

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

/** Read a single inbox item out of either query cache (list or archived),
 *  falling back through both. Both lists are kept warm by the inbox tab, so
 *  a tap-then-push always finds its row. */
function lookupCached(
  id: string,
  qc: ReturnType<typeof useQueryClient>,
  wsId: string | null,
  bucket: "inbox" | "archived",
): InboxItem | undefined {
  const key =
    bucket === "archived" ? inboxKeys.archived(wsId) : inboxKeys.list(wsId);
  return qc.getQueryData<InboxItem[]>(key)?.find((row) => row.id === id);
}