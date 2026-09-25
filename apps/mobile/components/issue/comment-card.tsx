/**
 * Comment timeline row. Rounded gray bubble containing the parent comment
 * plus, when applicable, every descendant reply stacked inline. The bubble
 * boundary itself is the thread indicator — no "↪ Replying to" header, no
 * recursive indentation. This matches the user's design call: "放在一个 card
 * 内部就行了 / no need for the Replying to label".
 *
 * Mobile flat-list rule (apps/mobile/CLAUDE.md): same comments as web,
 * different layout — web shows recursive tree, mobile shows one bubble per
 * thread. Counts agree (no comment is dropped or duplicated).
 *
 * Interaction: long-press inside a bubble fires a native iOS
 * `ActionSheetIOS` with the comment's actions (Reply, React…, Copy,
 * Select Text, Copy Link, Resolve, Delete). While the sheet is on screen
 * the targeted bubble's border highlights. See `useCommentLongPress` in
 * `./comment-context-menu.tsx`.
 *
 * Resolved threads render in a collapsed `<ResolvedThreadBar>` by default —
 * mirrors the same state language web uses (`packages/views/issues/
 * components/resolved-thread-bar.tsx`), but the visual is a single-line
 * tap-to-expand bar at iOS section-row scale. Tap expands the bar in place;
 * when expanded the resolved indicator stays at the top of the body so the
 * user keeps the "this thread is resolved" signal even while reading.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Reaction, TimelineEntry } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useActorLookup } from "@/data/use-actor-name";
import { useTimeAgo } from "@/lib/time-ago";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Markdown } from "@/lib/markdown";
import { LongPressView } from "@/components/ui/long-press-view";
import { CommentAttachmentList } from "@/components/issue/comment-attachment-list";
import {
  discardFailedComment,
  useCreateComment,
  useEditComment,
  useToggleCommentReaction,
} from "@/data/mutations/issues";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { issueAttachmentsOptions } from "@/data/queries/issues";
import { useFailedCommentsStore } from "@/data/stores/failed-comments-store";
import { useActorProfileStore } from "@/data/stores/actor-profile-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ReactionBar } from "./reaction-bar";
import { useCommentLongPress } from "./comment-context-menu";
import { useCommentSelectStore } from "@/data/comment-select-store";
import { useTranslation } from "@/lib/i18n/react";
import {
  useIsCommentCollapsed,
  useToggleCommentCollapsed,
} from "@/data/stores/comment-collapse-store";
import { commentPreview } from "@/lib/comment-collapse";
import {
  deriveThreadResolution,
  foldThreadReplies,
} from "@/lib/thread-resolution";

interface Props {
  entry: TimelineEntry;
  /** Flattened descendant replies. Rendered inline below the parent inside
   *  the same bubble, separated by a hairline divider. */
  replies?: TimelineEntry[];
  /** Plumbed through so each CommentBody can wire its reaction toggle to
   *  the correct issue's mutation key. */
  issueId: string;
  /** Human-readable identifier (e.g. `MUL-123`) used to build the shareable
   *  web URL for the long-press "Copy Link" item. Optional — that item
   *  hides when missing. */
  issueIdentifier: string | undefined;
  /** Inbox deep-link flash target. When this matches the root entry id we
   *  flash the outer bubble (ring + bg). When it matches a reply id we
   *  flash that reply's wrapper (bg only). Mirrors web's distinction at
   *  packages/views/issues/components/comment-card.tsx:498-682. */
  highlightedCommentId?: string | null;
}

export function CommentCard({
  entry,
  replies = [],
  issueId,
  issueIdentifier,
  highlightedCommentId,
}: Props) {
  // Resolved threads default to a single-line bar; tap expands in place for
  // the current session. Unmount (scroll out of viewport) resets — same
  // behavior as iOS Mail's "tap to expand a thread" pattern.
  //
  // `resolved_at` can sit on the ROOT ("Resolve thread" → the whole thread
  // folds) or on a REPLY ("Resolve thread with comment" → that reply is the
  // resolution, the other replies fold around it). Deriving it in one place
  // keeps both shapes on the same code path — see `lib/thread-resolution`.
  const resolution = useMemo(
    () => deriveThreadResolution(entry, replies),
    [entry, replies],
  );
  const rootResolved = resolution.kind === "root";
  const replyResolutionId =
    resolution.kind === "reply" ? resolution.resolutionId : null;
  const foldedReplies = useMemo(
    () => foldThreadReplies(replies, resolution),
    [replies, resolution],
  );
  const resolutionReply = useMemo(
    () =>
      replyResolutionId
        ? (replies.find((r) => r.id === replyResolutionId) ?? null)
        : null,
    [replies, replyResolutionId],
  );
  const [expanded, setExpanded] = useState(false);
  // Per-comment fold (iteration 179, G20). The state lives here — not inside
  // `CommentBody` — because folding a root has to hide its replies as well,
  // and the replies are rendered by this component. Replies themselves are
  // never foldable: web's `CommentRow` has no chevron either
  // (`packages/views/issues/components/comment-card.tsx:849`).
  const foldWsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const toggleFolded = useToggleCommentCollapsed();
  const rootFolded = useIsCommentCollapsed(foldWsId, issueId, entry.id);
  const handleToggleFold = useCallback(() => {
    if (foldWsId) toggleFolded(foldWsId, issueId, entry.id);
  }, [foldWsId, toggleFolded, issueId, entry.id]);
  // Highlight ring while a long-press action sheet is on screen — child
  // CommentBody flips this via onPressChange so the outer bubble shell can
  // visually bind the sheet to the targeted entry.
  const [pressedEntryId, setPressedEntryId] = useState<string | null>(null);
  const handlePressChange = useCallback(
    (entryId: string, pressed: boolean) => {
      setPressedEntryId((cur) => {
        if (pressed) return entryId;
        return cur === entryId ? null : cur;
      });
    },
    [],
  );
  const isHighlighted =
    pressedEntryId === entry.id ||
    replies.some((r) => r.id === pressedEntryId);
  // Translucent primary-tinted background while ANY body inside this card
  // is in text-selection mode. Subtle visual cue that replaces the prior
  // Done pill — exit is via scroll / tab switch / selecting another body.
  const selectingId = useCommentSelectStore((s) => s.selectingId);
  const isSelectingHere =
    selectingId === entry.id || replies.some((r) => r.id === selectingId);

  // Inbox deep-link target inside a folded thread expands automatically —
  // otherwise tapping a notification would just reveal a bar with no content
  // and force the user to tap again. Same reasoning applies to a manual fold:
  // deep-linking INTO a folded thread must not leave the target invisible, so
  // the fold is lifted rather than fighting the highlight. Web has no
  // equivalent (its folded root still shows every reply).
  useEffect(() => {
    if (resolution.kind === "none" || !highlightedCommentId) return;
    if (
      highlightedCommentId === entry.id ||
      replies.some((r) => r.id === highlightedCommentId)
    ) {
      setExpanded(true);
      if (foldWsId && rootFolded) {
        toggleFolded(foldWsId, issueId, entry.id);
      }
    }
  }, [
    resolution.kind,
    highlightedCommentId,
    entry.id,
    replies,
    foldWsId,
    rootFolded,
    toggleFolded,
    issueId,
  ]);

  if (rootResolved && !expanded) {
    return (
      <ResolvedThreadBar
        entry={entry}
        replies={replies}
        onExpand={() => setExpanded(true)}
      />
    );
  }

  return (
    <View className="px-4">
      <View className="rounded-2xl">
        {/* Bubble uses `surface-1` (L 98%) — extremely subtle elevation
         *  above the page, visible mostly through the rounded edge rather
         *  than the fill (iOS settings cell feel; see Refactoring UI #4
         *  "cards subtle from page"). Internal markdown elements (table
         *  headers / code blocks via markdown-style.ts) use `surface-2`
         *  (L 90%), 8% darker than the bubble — well over the 5%
         *  perceptibility threshold so the inner box is clearly framed.
         *  Border (L 84%) adds 6% on top for the outline. See global.css
         *  for the full 5-tier elevation scale.
         *
         *  Resolved-and-expanded path dims the bubble to 70% so the
         *  "this is settled" signal persists even while reading the
         *  body — mirrors web's muted resolved card visual. */}
        <View
          className={cn(
            "bg-surface-1 rounded-2xl px-4 py-3 gap-3 border-2 border-transparent transition-colors",
            rootResolved && "opacity-70",
            isHighlighted && "border-primary/30",
            isSelectingHere && "bg-primary/5 border-primary/30",
          )}
        >
          {rootResolved ? (
            <ResolvedIndicator
              entry={entry}
              onCollapse={() => setExpanded(false)}
            />
          ) : null}
          <CommentBody
            entry={entry}
            issueId={issueId}
            issueIdentifier={issueIdentifier}
            onPressChange={handlePressChange}
            collapsed={rootFolded}
            replyCount={replies.length}
            onToggleCollapse={handleToggleFold}
          />
          {rootFolded ? null : replyResolutionId !== null && !expanded ? (
            <>
              {/* Reply-mode resolution, folded: the other replies collapse
               *  behind one bar and the resolution stays pinned below it —
               *  web's `replyFolded` branch in comment-card.tsx. The root
               *  stays fully visible in both states. */}
              {foldedReplies.length > 0 ? (
                <View className="border-t border-border/60 pt-3">
                  <CommentsFoldBar
                    replies={foldedReplies}
                    onExpand={() => setExpanded(true)}
                  />
                </View>
              ) : null}
              {resolutionReply ? (
                <View className="border-t border-border/60 pt-3">
                  <ResolutionBadge />
                  <CommentBody
                    entry={resolutionReply}
                    issueId={issueId}
                    issueIdentifier={issueIdentifier}
                    onPressChange={handlePressChange}
                  />
                  <ReplyHighlightOverlay
                    active={highlightedCommentId === resolutionReply.id}
                  />
                </View>
              ) : null}
            </>
          ) : (
            replies.map((reply) => (
              <View key={reply.id} className="border-t border-border/60 pt-3">
                {reply.id === replyResolutionId ? <ResolutionBadge /> : null}
                <CommentBody
                  entry={reply}
                  issueId={issueId}
                  issueIdentifier={issueIdentifier}
                  onPressChange={handlePressChange}
                />
                <ReplyHighlightOverlay
                  active={highlightedCommentId === reply.id}
                />
              </View>
            ))
          )}
        </View>
        <RootHighlightOverlay active={highlightedCommentId === entry.id} />
      </View>
    </View>
  );
}

/**
 * Compact "thread is resolved" bar — substitutes the full card when a
 * resolved root is collapsed (default state). Tap anywhere to expand.
 *
 * Mirrors web's `<ResolvedThreadBar>` (`packages/views/issues/components/
 * resolved-thread-bar.tsx`): checkmark + N participant authors + reply
 * count + chevron. On mobile we drop the dedicated <Card> chrome and use
 * the same `bg-surface-1` bubble so the resolved bar reads as the same
 * "row" rhythm as the full card it stands in for.
 */
function ResolvedThreadBar({
  entry,
  replies,
  onExpand,
}: {
  entry: TimelineEntry;
  replies: TimelineEntry[];
  onExpand: () => void;
}) {
  const { getName } = useActorLookup();
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const mutedFg = THEME[colorScheme].mutedForeground;

  // Unique participant set across root + replies, preserving chronological
  // order of first appearance. Up to two authors are named; the rest are
  // rolled into "+N more" so the bar stays a single line on a narrow phone.
  const authorsLabel = useMemo(() => {
    const MAX_NAMED = 2;
    const seen = new Set<string>();
    const ordered: { type: string | null; id: string | null }[] = [];
    for (const e of [entry, ...replies]) {
      const key = `${e.actor_type}:${e.actor_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push({ type: e.actor_type, id: e.actor_id });
    }
    const named = ordered
      .slice(0, MAX_NAMED)
      .map((a) =>
        getName(a.type as "member" | "agent" | null | undefined, a.id),
      )
      .join(", ");
    const remaining = ordered.length - MAX_NAMED;
    return remaining > 0 ? `${named} +${remaining}` : named;
  }, [entry, replies, getName]);

  const total = 1 + replies.length;
  const messageCount = t(total === 1 ? "comment.message" : "comment.messages");

  return (
    <View className="px-4">
      <Pressable
        onPress={onExpand}
        className="flex-row items-center gap-2.5 px-4 py-3 rounded-2xl bg-surface-1 active:opacity-70"
        accessibilityRole="button"
        accessibilityLabel={t("comment.resolvedBarLabel", {
          authors: authorsLabel,
          count: total,
          messageCount,
        })}
      >
        <Ionicons name="checkmark-circle" size={18} color={mutedFg} />
        <Text
          className="flex-1 text-sm text-muted-foreground"
          numberOfLines={1}
        >
          {t("comment.resolvedBar", {
            count: total,
            messageCount,
            authors: authorsLabel,
          })}
        </Text>
        <Ionicons name="chevron-down" size={14} color={mutedFg} />
      </Pressable>
    </View>
  );
}

/**
 * Middle fold — the thread's resolution is a REPLY, so the other replies
 * collapse behind this bar while the root and the resolution stay visible.
 * Mobile port of web's `<CommentsFoldBar>`
 * (`packages/views/issues/components/resolved-thread-bar.tsx`), at the same
 * single-line section-row scale as `<ResolvedThreadBar>` above.
 */
function CommentsFoldBar({
  replies,
  onExpand,
}: {
  replies: TimelineEntry[];
  onExpand: () => void;
}) {
  const { getName } = useActorLookup();
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const mutedFg = THEME[colorScheme].mutedForeground;

  const authorsLabel = useMemo(() => {
    const MAX_NAMED = 2;
    const seen = new Set<string>();
    const ordered: { type: string | null; id: string | null }[] = [];
    for (const e of replies) {
      const key = `${e.actor_type}:${e.actor_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push({ type: e.actor_type, id: e.actor_id });
    }
    const named = ordered
      .slice(0, MAX_NAMED)
      .map((a) =>
        getName(a.type as "member" | "agent" | null | undefined, a.id),
      )
      .join(", ");
    const remaining = ordered.length - MAX_NAMED;
    return remaining > 0 ? `${named} +${remaining}` : named;
  }, [replies, getName]);

  const total = replies.length;
  const messageCount = t(total === 1 ? "comment.message" : "comment.messages");

  return (
    <Pressable
      onPress={onExpand}
      className="flex-row items-center gap-2.5 px-3 py-2.5 rounded-xl bg-secondary/60 active:opacity-70"
      accessibilityRole="button"
      accessibilityLabel={t("comment.foldBarLabel", {
        authors: authorsLabel,
        count: total,
        messageCount,
      })}
    >
      <Ionicons name="chevron-forward" size={13} color={mutedFg} />
      <Text className="flex-1 text-sm text-muted-foreground" numberOfLines={1}>
        {t("comment.foldBar", {
          count: total,
          messageCount,
          authors: authorsLabel,
        })}
      </Text>
    </Pressable>
  );
}

/**
 * "Resolution" chip pinned above the reply that settled the thread
 * ("Resolve thread with comment"). Web's `resolution_badge`; it only ever
 * renders on the single derived resolution, never on the root (that case is
 * carried by `<ResolvedIndicator>` / `<ResolvedThreadBar>`).
 */
function ResolutionBadge() {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center gap-1 pb-1.5">
      <Ionicons name="checkmark-circle" size={13} color="#22c55e" />
      <Text className="text-xs font-medium text-emerald-500">
        {t("comment.resolutionBadge")}
      </Text>
    </View>
  );
}

/**
 * Resolved indicator row that sits at the top of an expanded resolved
 * thread. Carries the "who resolved + when" attribution and a collapse
 * affordance — equivalent to web's "Mark as resolved" header bar
 * (`packages/views/issues/components/comment-card.tsx:519-532`).
 *
 * Tap collapses the thread back to the bar without firing the
 * <CommentBody> long-press action sheet (the row is a self-contained
 * Pressable, sits above CommentBody in the bubble's gap-3 layout).
 */
function ResolvedIndicator({
  entry,
  onCollapse,
}: {
  entry: TimelineEntry;
  onCollapse: () => void;
}) {
  const { t } = useTranslation();
  const { getName } = useActorLookup();
  const timeAgo = useTimeAgo();
  const { colorScheme } = useColorScheme();
  const mutedFg = THEME[colorScheme].mutedForeground;
  const resolverName = getName(
    entry.resolved_by_type as "member" | "agent" | null | undefined,
    entry.resolved_by_id,
  );

  return (
    <Pressable
      onPress={onCollapse}
      className="flex-row items-center gap-2 active:opacity-60"
      accessibilityRole="button"
      accessibilityLabel={t("comment.collapseResolvedLabel")}
    >
      <Ionicons name="checkmark-circle" size={14} color={mutedFg} />
      <Text className="text-xs text-muted-foreground flex-1" numberOfLines={1}>
        {t("comment.resolvedBy", { name: resolverName })}
        {entry.resolved_at ? ` · ${timeAgo(entry.resolved_at)}` : ""}
      </Text>
      <Text className="text-xs text-muted-foreground">{t("common.collapse")}</Text>
    </Pressable>
  );
}

/**
 * Animated highlight overlay for a root comment bubble. Sits absolute-
 * positioned over the parent <View className="rounded-2xl">, no pointer
 * capture (long-press still works through it). Border + background wash
 * — equivalent to web's `ring-2 ring-brand/50 bg-brand/5`.
 *
 * Reflow note: animating `borderWidth` would push children every frame,
 * so we keep it constant at 2 and animate `opacity` 0→1→0. Same trick
 * for the wash. Single shared value, one animated style.
 */
function RootHighlightOverlay({ active }: { active: boolean }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) return;
    // 700ms fade-in → 1800ms hold → 700ms fade-out. Matches web's
    // `transition-colors duration-700` + `setTimeout(2500)` timing.
    progress.value = withSequence(
      withTiming(1, { duration: 700 }),
      withDelay(1800, withTiming(0, { duration: 700 })),
    );
  }, [active, progress]);

  const style = useAnimatedStyle(() => ({ opacity: progress.value }));

  // Brand colour comes from the `brand` token; alpha via NativeWind `/50`
  // syntax mirrors web's `ring-brand/50 bg-brand/5`. Only opacity is
  // animated — the borderColor / backgroundColor stay constant, so
  // className is safe here (animating those channels via className isn't).
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute inset-0 rounded-2xl border-2 border-brand/50 bg-brand/5"
      style={style}
    />
  );
}

/**
 * Animated wash overlay for a reply row. Same timing as root, but no
 * border — mirrors web's reply branch which applies only `bg-brand/5`
 * (packages/views/issues/components/comment-card.tsx:682).
 */
function ReplyHighlightOverlay({ active }: { active: boolean }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) return;
    progress.value = withSequence(
      withTiming(1, { duration: 700 }),
      withDelay(1800, withTiming(0, { duration: 700 })),
    );
  }, [active, progress]);

  const style = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Animated.View
      pointerEvents="none"
      className="absolute inset-0 bg-brand/5"
      style={style}
    />
  );
}

function CommentBody({
  entry,
  issueId,
  issueIdentifier,
  onPressChange,
  collapsed = false,
  replyCount = 0,
  onToggleCollapse,
}: {
  entry: TimelineEntry;
  issueId: string;
  issueIdentifier: string | undefined;
  onPressChange?: (entryId: string, pressed: boolean) => void;
  /**
   * This row's body is folded. The fold STATE lives one level up (in
   * `CommentCard`), because folding a root has to hide its replies too and
   * those are rendered by the card, not by this row.
   */
  collapsed?: boolean;
  /** Reply count shown beside a folded root's preview (web parity). */
  replyCount?: number;
  /** Supplied only for the thread root — replies have no fold toggle, same
   *  as web, where the chevron lives on the root header and `CommentRow`
   *  never renders one (`comment-card.tsx:849`). */
  onToggleCollapse?: () => void;
}) {
  // When this comment is the active selection target, drop the long-press
  // wrapper AND make the markdown selectable — so the next long-press
  // routes to UIKit's native text-selection magnifier instead of our
  // gesture handler. Selection mode is exited via the Done pill, scrolling
  // the timeline, or unmounting the issue screen.
  const isSelecting = useCommentSelectStore(
    (s) => s.selectingId === entry.id,
  );
  const { getName } = useActorLookup();
  const { colorScheme } = useColorScheme();
  const userId = useAuthStore((s) => s.user?.id);
  // Comment authors are the highest-value "who is this?" surface on the
  // phone: the row shows a name and nothing else. The avatar itself owns no
  // gesture here (the bubble's long-press is on the wrapper, not the header),
  // so it is safe to make it its own press target.
  const openProfile = useActorProfileStore((s) => s.open);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const timeAgo = useTimeAgo();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const toggle = useToggleCommentReaction(issueId);
  // Fold state is owned by `CommentCard` (it has to hide the replies too) and
  // passed down; this row only renders the chevron + summary the parent asked
  // for.
  const isFolded = collapsed;
  const qc = useQueryClient();
  const createComment = useCreateComment(issueId);
  // Inline edit (iteration-127). Web opens a rich editor from the comment's
  // "Edit" menu item when `canEditEntry` is true
  // (packages/views/issues/components/comment-card.tsx:539); mobile's editor
  // is text-only, so it preserves the existing attachments by omitting
  // `attachment_ids` (api.updateComment drops the key when undefined) and
  // the long-press entry hides for attachment-only comments.
  const editComment = useEditComment(issueId);
  const [editing, setEditing] = useState(false);
  // Failed-comment state for THIS entry — undefined when the entry is a
  // normal server-backed comment OR an in-flight optimistic. Only set when
  // the matching `useCreateComment` mutation errored and the entry was
  // intentionally left in the cache to surface inline retry.
  const failed = useFailedCommentsStore((s) => s.failed[entry.id]);
  // Same query as IssueDescription — TanStack dedupes so this fires once
  // per issue regardless of how many comments need to resolve attachments.
  const { data: attachments } = useQuery(
    issueAttachmentsOptions(wsId, issueId),
  );

  const name = getName(
    entry.actor_type as "member" | "agent" | null | undefined,
    entry.actor_id,
  );
  const edited =
    entry.updated_at &&
    entry.created_at &&
    entry.updated_at !== entry.created_at;

  // Reactions live on TimelineEntry.reactions (mirrored from Comment).
  // Pass through to the bar; toggle finds existing match by emoji + actor.
  const reactions: Reaction[] = (entry.reactions ?? []) as Reaction[];

  const onToggleReaction = useCallback(
    (emoji: string) => {
      const existing = reactions.find(
        (r) =>
          r.emoji === emoji &&
          r.actor_type === "member" &&
          r.actor_id === userId,
      );
      toggle.mutate({ commentId: entry.id, emoji, existing });
    },
    [reactions, userId, toggle, entry.id],
  );

  const handleRetry = useCallback(() => {
    if (!failed || !wsId) return;
    // Remove the stale optimistic + failed marker BEFORE re-firing so the
    // mutation's own optimistic insert lands on a clean slate instead of
    // creating a duplicate row. The new attempt mints a fresh optimistic id.
    discardFailedComment(qc, wsId, issueId, entry.id);
    createComment.mutate({
      content: failed.content,
      parentId: failed.parentId,
      attachmentIds: failed.attachmentIds,
      suppressAgentIds: failed.suppressAgentIds,
    });
  }, [failed, qc, wsId, issueId, entry.id, createComment]);

  const handleDiscard = useCallback(() => {
    if (!wsId) return;
    discardFailedComment(qc, wsId, issueId, entry.id);
  }, [qc, wsId, issueId, entry.id]);

  // Per-comment attachments render in two complementary places:
  //   - inline via the markdown renderer when the content references
  //     them with `![](url)` (typical for web/desktop comments authored
  //     in the rich editor)
  //   - via <CommentAttachmentList> below the body when they exist but
  //     aren't referenced in markdown (mobile-authored comments take this
  //     path — see inline-comment-composer.tsx for why mobile doesn't
  //     inline-insert).
  // Mirrors web's split: comment-card.tsx:124 `AttachmentList`.
  //
  // When NOT selecting: long-press fires the native ActionSheetIOS via
  // useCommentLongPress. Markdown is non-selectable so the long-press
  // gesture doesn't race UIKit's text selection.
  //
  // When selecting: long-press wrapper is gone, markdown is selectable.
  // The next long-press fires UIKit's native text-selection magnifier
  // + handles + Copy/Look Up callout. The outer bubble shell carries a
  // translucent primary-tint background as the mode cue (no Done pill).
  // Exit: scroll the timeline, leave the issue, or long-press another body.
  const longPress = useCommentLongPress(
    entry,
    issueId,
    issueIdentifier,
    entry.actor_type === "member" && entry.actor_id === userId
      ? () => setEditing(true)
      : undefined,
  );

  useEffect(() => {
    if (isSelecting) return;
    onPressChange?.(entry.id, longPress.isPressed);
  }, [longPress.isPressed, entry.id, isSelecting, onPressChange]);

  const body = (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        {/* Fold toggle — root only. Web puts the same chevron in its comment
            header (`comment-card.tsx:849`) and hides only the root body;
            mobile folds the whole bubble (replies included), which is why the
            state lives in `CommentCard` and not here. See
            `lib/comment-collapse.ts` for the granularity note. */}
        {onToggleCollapse ? (
          <Pressable
            onPress={onToggleCollapse}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t(
              isFolded ? "comment.expandAria" : "comment.collapseAria",
              { name },
            )}
            className="active:opacity-60"
          >
            <Ionicons
              name={isFolded ? "chevron-forward" : "chevron-down"}
              size={13}
              color={THEME[colorScheme].mutedForeground}
            />
          </Pressable>
        ) : null}
        <ActorAvatar
          type={entry.actor_type as "member" | "agent"}
          id={entry.actor_id}
          size={24}
          showPresence
          onPressProfile={
            entry.actor_id &&
            (entry.actor_type === "member" || entry.actor_type === "agent")
              ? () => openProfile(entry.actor_type as "member" | "agent", entry.actor_id)
              : undefined
          }
        />
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          className="shrink text-sm font-medium text-foreground"
        >
          {name}
        </Text>
        <Text
          numberOfLines={1}
          className="shrink-0 text-xs text-muted-foreground"
        >
          · {timeAgo(entry.created_at)}
          {edited ? ` · ${t("comment.edited")}` : ""}
        </Text>
        {/* Folded row keeps the summary the hidden body would have given:
            an 80-char preview and the reply count, same as web's collapsed
            header (`comment-card.tsx:873-882`). */}
        {isFolded ? (
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            className="min-w-0 flex-1 text-xs text-muted-foreground"
          >
            {commentPreview(entry.content)}
          </Text>
        ) : null}
        {isFolded && replyCount > 0 ? (
          <Text className="shrink-0 text-xs text-muted-foreground">
            {t(
              replyCount === 1
                ? "comment.replyCount_one"
                : "comment.replyCount_other",
              { count: replyCount },
            )}
          </Text>
        ) : null}
      </View>
      {isFolded ? null : (
        <>
          {editing ? (
            <CommentEditBox
              initialContent={entry.content ?? ""}
              saving={editComment.isPending}
              onCancel={() => setEditing(false)}
              onSave={async (next) => {
                try {
                  await editComment.mutateAsync({
                    commentId: entry.id,
                    content: next,
                  });
                  setEditing(false);
                } catch {
                  // Keep the editor open with the draft intact so the text is
                  // never lost; `useEditComment` already rolled the optimistic
                  // timeline patch back to the server value.
                  Alert.alert(t("comment.updateFailed"));
                }
              }}
            />
          ) : entry.content ? (
            <Markdown
              content={entry.content}
              attachments={attachments}
              selectable={isSelecting}
            />
          ) : null}
          <CommentAttachmentList
            attachments={entry.attachments}
            content={entry.content}
            source={{ kind: "issue", name: issueIdentifier }}
          />
          {failed ? (
            <FailedActions
              error={failed.error}
              onRetry={handleRetry}
              onDiscard={handleDiscard}
            />
          ) : (
            <ReactionBar
              reactions={reactions}
              currentUserId={userId}
              onToggle={onToggleReaction}
              onOpenFullPicker={
                wsSlug
                  ? () =>
                      router.push({
                        pathname:
                          "/[workspace]/issue/[id]/comment/[commentId]/emoji-picker",
                        params: {
                          workspace: wsSlug,
                          id: issueId,
                          commentId: entry.id,
                        },
                      })
                  : undefined
              }
            />
          )}
        </>
      )}
    </View>
  );

  if (isSelecting) return body;
  // The editor owns the gesture surface while it is open — wrapping it in
  // the long-press view would keep re-opening the action sheet over the
  // keyboard and swallow taps meant for Save / Cancel.
  if (editing) return body;

  return (
    <LongPressView onLongPress={longPress.onLongPress} delayLongPress={500}>
      {body}
    </LongPressView>
  );
}

/**
 * Inline comment editor — replaces the rendered markdown in place while
 * editing, so the user keeps the thread's position and context (web swaps
 * the card body for its editor the same way). Save is disabled when the
 * trimmed draft is unchanged, mirroring web's "nothing changed — close
 * without a write" shortcut (comment-card.tsx:430-435).
 */
function CommentEditBox({
  initialContent,
  saving,
  onCancel,
  onSave,
}: {
  initialContent: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (content: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialContent);
  const trimmed = draft.trim();
  const unchanged = trimmed === initialContent.trim();

  return (
    <View className="gap-2">
      <AutosizeTextArea
        value={draft}
        onChangeText={setDraft}
        autoFocus
        editable={!saving}
        maxHeight={240}
        placeholder={t("comment.placeholder")}
        className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        accessibilityLabel={t("comment.editComment")}
      />
      <View className="flex-row justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={saving} onPress={onCancel}>
          <Text>{t("common.cancel")}</Text>
        </Button>
        <Button
          size="sm"
          disabled={saving || unchanged || trimmed.length === 0}
          onPress={() => onSave(trimmed)}
        >
          <Text>{saving ? t("comment.saving") : t("common.save")}</Text>
        </Button>
      </View>
    </View>
  );
}

/**
 * Inline retry strip shown beneath a failed optimistic comment body. Sits
 * where ReactionBar normally lives — same vertical rhythm, but the slot
 * carries the error message + Retry/Discard buttons. Single source of the
 * error surface (no parallel toast), so the user always lands on the row
 * they typed if they come back later.
 */
function FailedActions({
  error,
  onRetry,
  onDiscard,
}: {
  error: string;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const destructive = THEME[colorScheme].destructive;
  return (
    <View className="flex-row items-center gap-2 mt-0.5">
      <Ionicons name="alert-circle" size={14} color={destructive} />
      <Text
        className="flex-1 text-xs text-destructive"
        numberOfLines={1}
      >
        {error || t("comment.couldntSend")}
      </Text>
      <Pressable
        onPress={onRetry}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={t("comment.retryLabel")}
      >
        <Text className="text-xs text-primary font-medium">{t("common.retry")}</Text>
      </Pressable>
      <Pressable
        onPress={onDiscard}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={t("comment.discardFailedLabel")}
      >
        <Text className="text-xs text-muted-foreground font-medium">
          {t("comment.discard")}
        </Text>
      </Pressable>
    </View>
  );
}
