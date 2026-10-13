/**
 * Duplicate-mark surfaces (MUL-7349): the banner above a duplicate's title,
 * the sidebar list of an issue's duplicates, and the "→ MUL-123" row marker.
 *
 * Mobile port of web's `packages/views/issues/components/issue-duplicates.tsx`.
 * The RULES are not re-derived here — `isDuplicateIssue` and the two write
 * patches come from `@multica/core/issues/duplicates.ts` through
 * `@/lib/issue-duplicates`, so the three surfaces cannot disagree with each
 * other or with the picker about what a mark is.
 *
 * What differs from web, and why:
 *
 *  - The banner's whole strip is one `Pressable` that navigates, rather than an
 *    anchor plus a hover-underline. A phone has no hover; the affordance that
 *    replaces it is the trailing chevron, which is always drawn.
 *  - The row marker is a nested `Pressable` inside the row's own `Pressable`.
 *    React Native gives the touch to the innermost responder, so the marker
 *    navigates to the original without the row ALSO opening the duplicate —
 *    web needs an explicit `stopPropagation` for this
 *    (`issue-duplicates.tsx:117`), and the two variants there (`insideLink`)
 *    collapse into this one mechanism.
 */
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { issueDuplicatesOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { isDuplicateIssue } from "@/lib/issue-duplicates";

/**
 * Banner above a duplicate's title.
 *
 * Its one job is to send the reader on: the strip links to the original and
 * shows the original's OWN status, so "is that one done yet?" is answered
 * before the tap. Removing the mark is the rare correction, so it stays a quiet
 * secondary action on the right.
 *
 * Reads the original from `issue.duplicate_of` (the server resolves it into
 * every issue payload) rather than from the relation query — so the banner is
 * correct on first paint, with no request of its own. The relation query is
 * only what keeps the issue's *duplicates* list (the other direction) current.
 */
export function IssueDuplicateBanner({
  issue,
  onUnmark,
  unmarking = false,
}: {
  issue: Issue;
  onUnmark: () => void;
  /** A mark write is in flight — the action would be a second write on a state
   *  the server has not answered yet, so it is disabled while true. */
  unmarking?: boolean;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const statuses = useIssueStatuses();
  // Same test the section and the marker use. A local `if (!issue.duplicate_of)`
  // would draw a banner on a reopened issue that still carries a stale pointer.
  if (!isDuplicateIssue(issue)) return null;
  const original = issue.duplicate_of!;
  const entry = statuses.entryOf(original.status);

  return (
    <View className="mx-4 mt-3 flex-row items-center gap-1 rounded-md border border-border bg-secondary/40 py-1 pl-3 pr-1">
      <Pressable
        onPress={() => {
          if (wsSlug) router.push(`/${wsSlug}/issue/${original.id}`);
        }}
        className="min-w-0 flex-1 flex-row items-center gap-2 py-1 active:opacity-60"
        accessibilityRole="link"
        accessibilityLabel={`${t("duplicates.bannerPrefix")} ${original.identifier} ${original.title}`}
      >
        <Text className="shrink-0 text-caption text-muted-foreground">
          {t("duplicates.bannerPrefix")}
        </Text>
        <StatusIcon
          status={original.status}
          category={entry?.category}
          color={entry?.is_system ? undefined : (entry?.color ?? undefined)}
          size={14}
        />
        <Text className="shrink-0 text-caption text-muted-foreground">
          {original.identifier}
        </Text>
        <Text
          className="flex-1 text-caption font-medium text-foreground"
          numberOfLines={1}
        >
          {original.title}
        </Text>
        <Ionicons name="arrow-forward" size={14} color={theme.mutedForeground} />
      </Pressable>
      <Pressable
        onPress={onUnmark}
        disabled={unmarking}
        hitSlop={8}
        accessibilityRole="button"
        className="shrink-0 flex-row items-center gap-1 px-2 py-1 active:opacity-60"
      >
        {unmarking ? (
          <ActivityIndicator size="small" />
        ) : (
          <Text className="text-caption text-muted-foreground">
            {t("duplicates.unmark")}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/**
 * Sidebar list of the issues marked as duplicates of this one.
 *
 * Every entry is cancelled, so a status icon would say the same thing on each
 * row; the REPORTER is the signal — several faces means several people hit
 * this. Same call web makes (`issue-duplicates.tsx:84`).
 *
 * Fetches its own relation (the other direction is not on the issue payload),
 * and renders nothing while that read is pending or empty, so a common issue
 * gains no row and no spinner.
 */
export function IssueDuplicatesSection({ issueId }: { issueId: string }) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const [open, setOpen] = useState(true);
  const { data } = useQuery(issueDuplicatesOptions(wsId, issueId));
  const duplicates = data?.duplicates ?? [];
  if (duplicates.length === 0) return null;

  return (
    <View className="px-4 pb-2">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-1 py-1 active:opacity-60"
      >
        <Text
          className={`text-caption font-medium ${
            open ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {t("duplicates.sectionTitle")}
        </Text>
        {/* Count badge — the reason the section can be collapsed at all: the
            number stays visible when the list does not. */}
        <View className="rounded-sm bg-secondary px-1">
          <Text className="text-micro font-medium tabular-nums text-muted-foreground">
            {duplicates.length}
          </Text>
        </View>
        <Ionicons
          name={open ? "chevron-down" : "chevron-forward"}
          size={12}
          color="currentColor"
          className="text-muted-foreground"
        />
      </Pressable>
      {open ? (
        <View className="pt-0.5">
          {duplicates.map((duplicate: Issue) => (
            <Pressable
              key={duplicate.id}
              onPress={() => {
                if (wsSlug) router.push(`/${wsSlug}/issue/${duplicate.id}`);
              }}
              accessibilityRole="link"
              className="flex-row items-center gap-1.5 py-1.5 active:opacity-60"
            >
              <ActorAvatar
                type={duplicate.creator_type}
                id={duplicate.creator_id}
                size={16}
              />
              <Text className="shrink-0 text-caption text-muted-foreground">
                {duplicate.identifier}
              </Text>
              <Text
                className="flex-1 text-caption text-foreground"
                numberOfLines={1}
              >
                {duplicate.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * "→ MUL-123" beside a duplicate in list rows and board cards, so the original
 * is one tap away instead of two.
 *
 * Reads `issue.duplicate_of`, which the server resolves into the issue itself —
 * so this needs no request of its own and rows that are not duplicates render
 * nothing. That also means it works on a row whose relation query was never
 * mounted, which is the whole point: the marker is the cheap half of the
 * feature and has to be free on a hundred-row list.
 *
 * The `Pressable` is what keeps the row from also opening the duplicate: React
 * Native gives the touch to the innermost responder, so the outer row's
 * `onPress` never fires for a tap that landed here.
 */
export function IssueDuplicateOfMarker({
  issue,
  className,
}: {
  issue: Pick<Issue, "status" | "duplicate_of">;
  className?: string;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  // Read from the store rather than taken as a prop: this marker is mounted by
  // four list surfaces and only one of them threads a slug through, so a prop
  // would mean widening three signatures that have nothing to do with the
  // feature. `IssueReactionRow` reads the same store for the same reason.
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  if (!isDuplicateIssue(issue)) return null;
  const original = issue.duplicate_of!;
  return (
    <Pressable
      onPress={(event) => {
        // Belt and braces alongside the responder system: on some Android
        // builds the outer row's Pressable still receives the touch after an
        // inner one handles it, which would open the duplicate on top of the
        // original. Stopping propagation here is what web's `stopPress`
        // (`issue-duplicates.tsx:117`) does for the same class of bug.
        event.stopPropagation?.();
        if (wsSlug) router.push(`/${wsSlug}/issue/${original.id}`);
      }}
      hitSlop={6}
      accessibilityRole="link"
      accessibilityLabel={`${t("duplicates.bannerPrefix")} ${original.identifier} ${original.title}`}
      className={className ?? "shrink-0 flex-row items-center gap-0.5"}
    >
      <Ionicons name="arrow-forward" size={11} color={theme.mutedForeground} />
      <Text className="text-caption text-muted-foreground">
        {original.identifier}
      </Text>
    </Pressable>
  );
}
