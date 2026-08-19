/**
 * Issue detail screen.
 *
 * Read-mostly timeline with an inline comment composer pinned to the
 * bottom (`<InlineCommentComposer>`). The composer is a single
 * `<TextInput>` + mention suggestion bar — no modal route, no toolbar,
 * no draft persistence. Sticks to the keyboard via `KeyboardStickyView`.
 *
 * Header note: the parent _layout.tsx already declares the `issue/[id]`
 * Stack.Screen with title "Issue". We override that here once the data
 * lands so the navigation bar shows `MUL-123` (Linear-style).
 */
import { useCallback, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { TimelineList } from "@/components/issue/timeline-list";
import { AgentHeaderBadge } from "@/components/issue/agent-header-badge";
import { InlineCommentComposer } from "@/components/issue/inline-comment-composer";
import {
  issueDetailOptions,
  issueKeys,
  issueTimelineOptions,
  issueChildrenOptions,
} from "@/data/queries/issues";
import { useDeleteIssue, useUpdateIssueRelations } from "@/data/mutations/issues";
import { useArchiveInbox, useUnarchiveInbox } from "@/data/mutations/inbox";
import { pinListOptions } from "@/data/queries/pins";
import { useCreatePin, useDeletePin } from "@/data/mutations/pins";
import { useAuthStore } from "@/data/auth-store";
import { useIssueRealtime } from "@/data/realtime/use-issue-realtime";
import { useWorkspaceStore } from "@/data/workspace-store";
import { getInboxArchiveMode } from "@/lib/inbox-display";
import { getWebBaseUrl } from "@/data/server-config";
import { ActionSheet } from "@/lib/action-sheet";
import { useViewedIssuesStore } from "@/data/viewed-issues-store";
import { useCommentSelectStore } from "@/data/comment-select-store";
import { useReplyTargetStore } from "@/data/stores/reply-target-store";
import { useTranslation } from "@/lib/i18n/react";

export default function IssueDetail() {
  // `highlight` + `h` come from inbox deep-link (apps/mobile/app/(app)/
  // [workspace]/(tabs)/inbox.tsx). `highlight` is the target comment id;
  // `h` is a per-tap nonce so re-tapping the same row re-fires the
  // scroll-and-flash effect. `inbox` / `inboxView` / `inboxItemId` carry the
  // inbox origin so the header can offer the Archive / Unarchive toggle
  // (reversed by the view the row was read in) — see onPressItem in
  // (tabs)/inbox.tsx.
  const { id, workspace: wsSlug, highlight, h, inbox, inboxView, inboxItemId } =
    useLocalSearchParams<{
    id: string;
    workspace: string;
    highlight?: string;
    h?: string;
    inbox?: string;
    inboxView?: string;
    inboxItemId?: string;
  }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();
  const { t } = useTranslation();

  const detail = useQuery(issueDetailOptions(wsId, id));
  const timeline = useQuery(issueTimelineOptions(wsId, id));
  const children = useQuery(issueChildrenOptions(wsId, id));

  // Subscribe to per-issue WS events: status/priority/assignee/label
  // changes, comments, activity, reactions, agent task progress.
  // Mounted with `id` — cleans up automatically on navigate-away.
  // If another client deletes the issue we're viewing, pop back so the
  // user isn't stranded on a 404 detail page.
  useIssueRealtime(id, () => router.back());

  // Track viewed issues so the chat composer's `@` suggestion bar can
  // surface "Recent" — the user just looked at MUL-123, likely wants to
  // ask the agent about it next. Workspace-scoped + in-memory; see
  // data/viewed-issues-store.ts.
  useEffect(() => {
    if (wsId && id) {
      useViewedIssuesStore.getState().push(wsId, id);
    }
  }, [wsId, id]);

  // Screen-scoped composer state — clear on unmount so re-entering the
  // issue starts from a clean slate (no stale text-selection comment id,
  // no stale "Replying to X" target). Both stores are singletons used by
  // the long-press action sheet.
  useEffect(() => {
    return () => {
      useCommentSelectStore.getState().clear();
      useReplyTargetStore.getState().clear();
    };
  }, []);

  const onRefresh = useCallback(async () => {
    await Promise.all([
      detail.refetch(),
      qc.invalidateQueries({ queryKey: issueKeys.timeline(wsId, id) }),
      qc.invalidateQueries({ queryKey: issueKeys.children(wsId, id) }),
    ]);
  }, [detail, qc, wsId, id]);

  const issue = detail.data;
  const deleteIssue = useDeleteIssue();
  const updateRelations = useUpdateIssueRelations();
  const archive = useArchiveInbox();
  const unarchive = useUnarchiveInbox();
  // Inbox-originated detail (deep link from an inbox row): the header shows an
  // Archive (main view) / Unarchive (archived view) toggle that mirrors web's
  // inbox detail panel. Only rendered when the row actually carried an id.
  const fromInbox = inbox === "1";
  const archiveMode = fromInbox
    ? getInboxArchiveMode(inboxView === "archived" ? "archived" : "inbox")
    : null;
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const onToggleInboxArchive = useCallback(() => {
    if (!inboxItemId || !archiveMode) return;
    // Optimistic patch + invalidate both inbox lists live in the mutations;
    // popping back to the list shows the row already gone (archived) or back
    // in the main inbox (unarchived). Read state is preserved verbatim.
    const mutate = archiveMode === "archive" ? archive : unarchive;
    mutate.mutate(inboxItemId, { onSuccess: () => router.back() });
  }, [inboxItemId, archiveMode, archive, unarchive]);
  const { data: pins } = useQuery(pinListOptions(wsId, userId));
  const isPinned =
    !!issue &&
    !!pins?.some((p) => p.item_type === "issue" && p.item_id === issue.id);
  const createPin = useCreatePin();
  const deletePin = useDeletePin();

  // Three-dot menu: Pin/Unpin / Copy link / Open on web (if web URL set) /
  // Delete. Mirrors apps/mobile/app/(app)/[workspace]/project/[id].tsx — same
  // ActionSheetIOS + Alert.alert confirm pattern. Property edits (status,
  // priority, assignee, due_date) live on the IssueHeaderCard chips inside
  // the timeline list, not in this menu — one entry per action.
  const onPressMore = useCallback(() => {
    if (!issue || !wsSlug) return;
    const webUrl = getWebBaseUrl();
    const issueLink = webUrl
      ? `${webUrl}/${wsSlug}/issue/${issue.identifier}`
      : null;
    type ActionEntry = { kind: string; label: string };
    const actions: ActionEntry[] = [
      { kind: "cancel", label: t("issue.cancel") },
      { kind: isPinned ? "unpin" : "pin", label: isPinned ? t("issue.unpin") : t("issue.pin") },
      { kind: "edit", label: t("issue.editDetails") },
      // Issue-tree relations (MYS-493) — web's "Relations" submenu flattened
      // into the mobile ActionSheet (one entry per action). Add sub-issue /
      // set parent open searchable pickers; remove parent applies directly
      // (reversible via set parent), mirroring web actions.removeParent().
      { kind: "addChild", label: t("issueRelation.addChildTitle") },
      { kind: "setParent", label: t("issueRelation.setParentTitle") },
    ];
    if (issue.parent_issue_id) {
      actions.push({
        kind: "removeParent",
        label: t("issueRelation.removeParentAction"),
      });
    }
    if (issueLink) actions.push({ kind: "copy", label: t("issue.copyLink") });
    if (issueLink) actions.push({ kind: "openWeb", label: t("issue.openWeb") });
    actions.push({ kind: "delete", label: t("issue.deleteIssue") });
    const destructiveIndex = actions.length - 1;
    ActionSheet.showActionSheetWithOptions(
      {
        options: actions.map((a) => a.label),
        cancelButtonIndex: 0,
        destructiveButtonIndex: destructiveIndex,
        title: issue.identifier,
      },
      (i) => {
        const kind = actions[i]?.kind;
        if (kind === "pin") {
          createPin.mutate({ item_type: "issue", item_id: issue.id });
        } else if (kind === "unpin") {
          deletePin.mutate({ itemType: "issue", itemId: issue.id });
        } else if (kind === "edit") {
          if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}/edit`);
        } else if (kind === "addChild") {
          if (wsSlug)
            router.push(`/${wsSlug}/issue/${issue.id}/picker/child`);
        } else if (kind === "setParent") {
          if (wsSlug)
            router.push(`/${wsSlug}/issue/${issue.id}/picker/parent`);
        } else if (kind === "removeParent") {
          updateRelations.mutate(
            { id: issue.id, patch: { parent_issue_id: null, stage: null } },
            {
              onError: (err) =>
                Alert.alert(
                  t("issueRelation.updateFailed"),
                  err instanceof Error ? err.message : undefined,
                ),
            },
          );
        } else if (kind === "copy" && issueLink) {
          Clipboard.setStringAsync(issueLink);
        } else if (kind === "openWeb" && issueLink) {
          Linking.openURL(issueLink);
        } else if (kind === "delete") {
          confirmDelete(issue, t, () =>
            deleteIssue.mutate(issue.id, {
              onSuccess: () => router.back(),
            }),
          );
        }
      },
    );
  }, [issue, wsSlug, deleteIssue, isPinned, createPin, deletePin, updateRelations, t]);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: issue?.identifier ?? t("screen.issue"),
          headerBackTitle: t("common.back"),
          headerRight: issue
            ? () => (
                <View className="flex-row items-center gap-2">
                  {/* Inbox-origin archive toggle. Archive (main view) vs
                   *  Unarchive (archived view), mirroring web's inbox detail
                   *  panel; hidden for every other entry point into the issue.
                   */}
                  {fromInbox && inboxItemId && archiveMode ? (
                    <IconButton
                      name={
                        archiveMode === "archive"
                          ? "archive-outline"
                          : "arrow-undo-outline"
                      }
                      onPress={onToggleInboxArchive}
                      accessibilityLabel={t(
                        archiveMode === "archive"
                          ? "inbox.detail.archive"
                          : "inbox.detail.unarchive",
                      )}
                    />
                  ) : null}
                  {/* Ambient agent-working badge — renders null when no
                   *  active tasks, so it doesn't crowd the header in the
                   *  common case. See agent-header-badge.tsx. */}
                  <AgentHeaderBadge issueId={id} />
                  <IconButton
                    name="ellipsis-horizontal"
                    onPress={onPressMore}
                    accessibilityLabel={t("issue.actions")}
                  />
                </View>
              )
            : undefined,
        }}
      />
      {detail.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : detail.error || !issue ? (
        <View className="flex-1 items-center justify-center px-6 gap-3">
          <Text className="text-sm text-destructive text-center">
            {t("issues.loadError")}
            {detail.error instanceof Error
              ? detail.error.message
              : t("issue.notFound")}
          </Text>
          <Button variant="outline" onPress={() => detail.refetch()}>
            <Text>{t("issue.retry")}</Text>
          </Button>
        </View>
      ) : (
        <View className="flex-1">
          <TimelineList
            issue={issue}
            entries={timeline.data}
            timelineLoading={timeline.isLoading}
            refreshing={detail.isRefetching || timeline.isRefetching}
            onRefresh={onRefresh}
            highlightCommentId={highlight}
            highlightNonce={h}
            subIssues={children.data}
            wsSlug={wsSlug}
          />
          <InlineCommentComposer issueId={id} />
        </View>
      )}
    </View>
  );
}

function confirmDelete(
  issue: Issue,
  t: (id: string, params?: Record<string, string | number>) => string,
  onConfirm: () => void,
) {
  Alert.alert(
    t("issue.deleteTitle"),
    t("issue.deleteMessage", { identifier: issue.identifier }),
    [
      { text: t("issue.cancel"), style: "cancel" },
      { text: t("issue.delete"), style: "destructive", onPress: onConfirm },
    ],
  );
}
