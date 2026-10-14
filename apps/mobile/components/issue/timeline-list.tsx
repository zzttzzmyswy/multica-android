/**
 * The scrolling timeline. ASC chronological — oldest at top, newest near the
 * bottom (above the composer). Pull-to-refresh refetches issue + timeline.
 *
 * Backend returns the full timeline in one shot (server-side pagination
 * was dropped in #2322 — p99 ~30 entries per issue, cursor walking only
 * created bugs at reply-thread boundaries). The previous "Pull to load
 * older" UX and top-edge `fetchOlder` trigger are gone.
 *
 * Inbox deep-link — FlashList v2 `startRenderingFromBottom` (mirrors
 * chat-message-list.tsx):
 *   When `highlightCommentId` is set, we pass
 *   `maintainVisibleContentPosition.startRenderingFromBottom: true` to
 *   FlashList and remount the list via `key={`hl-${highlightNonce}`}` once
 *   timeline data has arrived. FlashList's `getInitialScrollIndex()` then
 *   lands on the last data item; after the initial paint MVCP keeps the
 *   visible content stable across async resizes (Shiki highlight, image
 *   natural-size, WS `comment:updated`). No JS-side scroll dance.
 *
 *   The previous implementation hand-rolled a `landed` state gate that
 *   re-fired `scrollToEnd` on every `onContentSizeChange`. That deadlocked
 *   the user at the bottom: `onScrollBeginDrag` queued `setLanded(true)`
 *   but a concurrent `onContentSizeChange` (from MVCP's own ScrollAnchor
 *   reposition, or from a markdown pass finishing) read the stale React
 *   closure, saw `landed === false`, and slammed the user back to bottom
 *   before the commit landed. State-vs-event races don't survive iOS
 *   markdown rendering hogging the JS thread.
 *
 *   The matching <CommentCard>'s `RootHighlightOverlay` fires when the
 *   target row enters the render window — so for a deep-link pointing
 *   at an old comment, the user scrolls up and the flash plays as the
 *   row mounts. `HIGHLIGHT_HOLD_MS` (5s) is the window for that.
 *
 *   Why not `scrollToIndex`: it requires accurate height estimates that
 *   variable-height markdown bubbles can't provide, even with
 *   `onScrollToIndexFailed` retry. Same lesson web learned (see
 *   `packages/views/issues/components/issue-detail.tsx:1822-1850` — they
 *   split the path into virtualized-for-browse / flat-for-deep-link
 *   precisely because "virtualization and 'land precisely on a target'
 *   have fundamentally opposed contracts"). Mobile sidesteps the split
 *   by not pretending to land precisely.
 *
 * `maintainVisibleContentPosition` is enabled by default on FlashList v2
 * and is implemented inside the C++ shadow tree — it compensates the
 * scroll offset both when a row is INSERTED above the viewport AND when
 * an upper row RESIZES (a WS `comment:updated` / `reaction:added` /
 * `resolved` event on an older comment used to push the user's read
 * position down by the delta). On FlatList the same prop was iOS-only
 * + JS-side; the FlashList path is steadier and animates the offset
 * compensation rather than snapping it.
 *
 * List engine: FlashList v2 (Shopify). Migrated from FlatList because:
 *   1. Cell recycling — markdown bubbles (Shiki highlight, image natural-
 *      size, lightbox provider injection) are expensive to mount; FlashList
 *      keeps them in recycled cells when scrolling through history rather
 *      than re-running the multi-pass render each time a row re-enters the
 *      window.
 *   2. Native MVCP — see paragraph above. Smoother behavior than FlatList's
 *      JS-side implementation when WS events resize an upper row.
 *   3. Async-render stability — async markdown size changes inside the
 *      viewport no longer cause the visual "twitch" we saw with FlatList,
 *      because FlashList re-layouts inside the shadow tree without
 *      surfacing a JS-side onContentSizeChange storm.
 *
 * What FlashList v2 does NOT change about this file:
 *   - The deep-link "land at bottom + flash on row mount" pattern (Linear
 *     iOS). FlashList's `scrollToIndex` is still estimate-based, so we
 *     intentionally don't try to land precisely on a specific comment —
 *     we land at the bottom and let `RootHighlightOverlay` claim the
 *     target when the user scrolls past it. `startRenderingFromBottom`
 *     is NOT enabled: a normal issue-open should show the header (title,
 *     description, status) first, not jump straight to the latest reply.
 *   - Spacing between rows. FlashList ignores `gap-*` on
 *     `contentContainer` the same way it does in chat-message-list.tsx —
 *     we use `ItemSeparatorComponent` for the 12 px breathing room and
 *     `ListHeaderComponentStyle` to add the same gap below the header.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { Issue, TimelineEntry } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { IssueHeaderCard } from "./issue-header-card";
import { IssueDescription } from "./issue-description";
import { IssueReactionRow } from "./issue-reaction-row";
import { IssueParentSection } from "./issue-parent-section";
import { IssueChildrenSection } from "./issue-children-section";
import {
  IssueDuplicateBanner,
  IssueDuplicatesSection,
} from "./issue-duplicates";
import { IssueSourceContextBanner } from "./issue-source-context";
import { PullRequestList } from "./pull-request-list";
import { DeliverablesSection } from "./deliverables-section";
import { QuickActionsSection } from "@/components/quick-action/quick-actions-section";
import { WakeupsSection } from "./wakeups-section";
import { isClosedIssue } from "@/lib/wakeup-presentation";
import { IssueMetadataSection } from "./issue-metadata-section";
import { SubscriptionControl } from "./subscription-control";
import { ActivityRow } from "./activity-row";
import { CommentCard } from "./comment-card";
import { useLastViewedStore } from "@/data/stores/last-viewed-store";
import { coalesceTimeline } from "@/lib/timeline-coalesce";
import { buildTimelineRows, type TimelineRow } from "@/lib/timeline-thread";
import { ImageSequenceProvider } from "@/lib/markdown/image-sequence";
import { issueAttachmentsOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import type { ImageSequenceBlock } from "@multica/core/attachments/image-sequence";
import { collectDeliverableFiles } from "@multica/core/attachments/deliverables";
import type { DownloadSource } from "@/lib/download-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useCommentSelectStore } from "@/data/comment-select-store";
import { useTranslation } from "@/lib/i18n/react";
import {
  descriptionFindOffset,
  descriptionTargetIndex,
  FIND_TARGET_TITLE,
  isDescriptionFindTarget,
} from "@/lib/issue-find";
import { HighlightOverlay } from "./highlight-overlay";
import {
  isNearBottom,
  AT_BOTTOM_SLACK_PX,
  nextFabVisibility,
  nextJumpTopFabVisibility,
} from "@/lib/scroll-bottom";
import { ScrollJumpControl } from "@/components/ui/scroll-jump-control";

interface Props {
  issue: Issue;
  entries: TimelineEntry[] | undefined;
  timelineLoading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /** Direct sub-issues of the parent, for the sub-task section in the
   *  header. `undefined` covers loading/error; an empty array hides the
   *  section. */
  subIssues?: Issue[];
  wsSlug?: string;
  /**
   * Remove this issue's duplicate mark (MUL-7349), when it has one. Passed in
   * rather than handled here because the write is a status change on the issue
   * the SCREEN owns (`useUnmarkDuplicate`) and this list is presentational —
   * same split as `onRefresh`.
   */
  onUnmarkDuplicate?: () => void;
  /** A mark write is in flight, so the banner's action is disabled. */
  unmarkingDuplicate?: boolean;
  /** Inbox deep-link target. Root comment id OR reply id — replies live
   *  inline inside their parent's CommentCard, so a reply target scrolls
   *  to the parent's row and the card highlights the matching child. */
  highlightCommentId?: string;
  /** Per-tap nonce. Re-tapping the same inbox row produces the same
   *  `highlightCommentId` but a fresh nonce, which re-triggers the
   *  scroll-and-flash effect (without this, identical props short-circuit). */
  highlightNonce?: string;
  /** Thread-navigator jump target (a top-level comment id). Distinct from
   *  `highlightCommentId`, which deep-links from inbox and deliberately lands
   *  at the BOTTOM with MVCP; a navigator jump must land ON the thread, so it
   *  scrolls by index instead. */
  jumpToThreadId?: string;
  /** Per-jump nonce — re-picking the same thread re-fires the scroll. */
  jumpNonce?: string;
  /** In-page find target, from `lib/issue-find.ts`. Either a comment id —
   *  which may be a ROOT **or a reply** — or one of the header sentinels
   *  (`FIND_TARGET_TITLE` / `findDescriptionTarget(i)`).
   *
   *  A comment lands like a navigator jump (scroll to the owning row) and
   *  resolves through replies too: a reply is not its own row in the mobile
   *  flat list, so matching only `row.entry.id` would leave every hit inside a
   *  reply with no scroll target — and replies are precisely the half of the
   *  timeline find exists to reach.
   *
   *  A sentinel lands on the header block instead. That is a different scroll
   *  (an offset, not a row index) and a different flash surface, which is why
   *  the two are told apart here rather than both being fed to `scrollToIndex`. */
  findTargetId?: string;
  /** Per-step nonce. Stepping onto the same comment twice (a query edited back
   *  to a previous one, or two hits inside one comment) must re-fire the
   *  scroll and re-flash, so the target alone cannot be the trigger. */
  findNonce?: string;
  /** Where inside a description segment the match sits, `0 ≤ fraction ≤ 1`, as
   *  computed by `lib/issue-find.ts` (MYS-2112). Only meaningful together with
   *  a description `findTargetId`: it is what turns "the segment that holds the
   *  match" into a position inside that segment.
   *
   *  Undefined for every other target, and also for a description target when
   *  the caller had no fraction to give — in which case the landing degrades to
   *  the segment's top, which is still strictly better than the description's. */
  findFraction?: number;
}

/** How long the flash stays "claimed" before we let a new highlight take
 *  over. The fade-out itself is driven by the Reanimated sequence inside
 *  CommentCard; this is just the upstream gate. 5s gives the user time
 *  to land at the bottom, realise the target is an older comment, and
 *  scroll up to it — the overlay still fires when the row mounts. */
const HIGHLIGHT_HOLD_MS = 5000;

/** Flash length after a thread-navigator jump. Shorter than the deep-link's
 *  hold: the jump lands the row in view immediately, so the flash only has to
 *  confirm which row it was — not keep a target alive while the reader scrolls
 *  a long way to reach it. Web's `jumpToThread` uses 2s for the same reason. */
const JUMP_HIGHLIGHT_HOLD_MS = 2000;

/** Sentinel id for the "New since last view" divider row injected into the
 *  FlatList data. Picked because it can never collide with a real comment
 *  / activity uuid. */
const DIVIDER_ID = "__divider__";

/** Whether a find target names one of the two header blocks rather than a
 *  comment. Every other target is a comment id.
 *
 *  A description target is now per-SEGMENT (`findDescriptionTarget`), so the
 *  test goes through `isDescriptionFindTarget` rather than comparing against
 *  the bare sentinel — otherwise every hit past the description's first segment
 *  would fall through to the comment path and find no row to scroll to. */
function isHeaderFindTarget(id: string): boolean {
  return id === FIND_TARGET_TITLE || isDescriptionFindTarget(id);
}

export function TimelineList({
  issue,
  entries,
  timelineLoading,
  refreshing,
  onRefresh,
  subIssues,
  wsSlug,
  onUnmarkDuplicate,
  unmarkingDuplicate,
  highlightCommentId,
  highlightNonce,
  jumpToThreadId,
  jumpNonce,
  findTargetId,
  findNonce,
  findFraction,
}: Props) {
  const { t } = useTranslation();
  // Top-level selection subscription gates the outer "tap-outside-to-dismiss"
  // Pressable below. When null, the Pressable stays disabled and every tap
  // passes through to comment cards / chip rows / reactions normally.
  const selectingId = useCommentSelectStore((s) => s.selectingId);

  // Server already returns ASC oldest-first. Pipeline:
  //   1. coalesceTimeline → merge consecutive identical activities
  //   2. buildTimelineRows → reorder so replies sit adjacent to their parent
  //      and tag each reply with `replyTo` for the card to render the
  //      "↪ Replying to" header + thread-line border. This is the mobile
  //      flat-list interpretation of web's recursive reply tree.
  const data = useMemo<TimelineRow[]>(() => {
    if (!entries) return [];
    return buildTimelineRows(coalesceTimeline(entries));
  }, [entries]);

  // Every image on this screen, in render order: the description first, then
  // each comment row with its replies (MUL-5752). Tapping any of them opens
  // the lightbox at its real position so a swipe walks to the next.
  //
  // The description's attachments come from the same query IssueDescription
  // uses — TanStack Query dedupes it, so this adds no request.
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issueAttachments } = useQuery(
    issueAttachmentsOptions(wsId, issue.id),
  );
  const imageBlocks = useMemo<ImageSequenceBlock[]>(() => {
    const blocks: ImageSequenceBlock[] = [
      { content: issue.description, attachments: issueAttachments },
    ];
    for (const row of data) {
      if (row.entry.type !== "comment") continue;
      blocks.push({
        content: row.entry.content,
        attachments: row.entry.attachments,
      });
      for (const reply of row.replies) {
        blocks.push({ content: reply.content, attachments: reply.attachments });
      }
    }
    return blocks;
  }, [issue.description, issueAttachments, data]);

  // The files this issue delivered as a whole (MUL-7649) — the sidebar
  // section, its overview and the per-file version badges all read this.
  //
  // Built from `entries`, NOT from `data`: `buildTimelineRows` folds replies
  // into their parent row, and `collectDeliverableFiles` must see every comment
  // entry to count an issue's output correctly. Web computes the same memo from
  // its raw timeline (`issue-detail.tsx:2343`) for the same reason.
  const deliverableFiles = useMemo(
    () => collectDeliverableFiles(entries ?? []),
    [entries],
  );

  // Memoized, not an inline literal: `useOpenDeliverable` carries `source` in a
  // `useCallback` dependency list, so a fresh object each render would rebuild
  // that callback every time — and the header block re-renders on every
  // keystroke in the composer below it.
  const deliverableSource = useMemo<DownloadSource>(
    () => ({ kind: "issue", name: issue.identifier }),
    [issue.identifier],
  );

  const listRef = useRef<FlashListRef<TimelineRow>>(null);
  // Where the header's two flashable blocks sit inside the scroll content, as
  // measured by the description wrapper's own `onLayout`. Only the description
  // needs this: the title is at offset 0, but the header card above the
  // description grows and shrinks with its attribute chips, custom properties
  // and agent-activity row, so its offset is not a constant. A ref, not state:
  // measuring must not re-render the list, and nothing renders from the value.
  const measuredHeaderTopsRef = useRef({ description: 0 });
  // Each description segment's measured rectangle, WRAPPER-RELATIVE (exactly
  // what `IssueDescription` reports), keyed by the segment index `splitMarkdown`
  // assigned (MYS-2112). This is what lets a find hit deep in the description
  // land on the segment holding it rather than on the description's top. A ref,
  // not state: measuring must not re-render the list, and nothing renders from
  // these values.
  //
  // The description's own offset is added when these are READ, never when they
  // are written. Storing scroll-content coordinates instead would be wrong twice
  // over: it double-counts that offset (a bug this round shipped and the device
  // caught — a 213dp overshoot that pushed the match past the viewport edge),
  // and it goes stale the moment the header card above resizes, since that moves
  // every segment in the content without moving any of them inside the
  // description, so no segment `onLayout` would fire to correct it. Reading
  // through `measuredHeaderTopsRef` (which DOES re-fire on that change) keeps
  // the landing and the flash consistent by construction.
  const measuredSegmentRectsRef = useRef(
    new Map<number, { top: number; height: number }>(),
  );
  // The scroll container's visible height, captured by `handleScroll`. Read by
  // the description landing, which centres the match — see
  // `descriptionFindOffset` for why centring rather than a top pad. `0` until
  // the first scroll event, which the landing treats as "no pad".
  const viewportHeightRef = useRef(0);
  // Gates single-shot per (commentId, nonce) tuple. Re-tap from inbox
  // bumps the nonce → ref no longer matches → effect re-fires.
  const lastStampRef = useRef<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // ── "New since last view" divider ─────────────────────────────────────
  // Snapshot the last-viewed timestamp ONCE on mount. Subsequent WS
  // appends shouldn't shift the divider — the user wants a stable
  // "where I was when I came back" boundary. The store update happens on
  // unmount, gated on the user having actually scrolled past the divider.
  const lastViewedSnapshotRef = useRef<string | null | undefined>(undefined);
  if (lastViewedSnapshotRef.current === undefined) {
    lastViewedSnapshotRef.current =
      useLastViewedStore.getState().getLastViewed(issue.id) ?? null;
  }
  const dividerAnchorId = useMemo(() => {
    const snapshot = lastViewedSnapshotRef.current;
    if (!snapshot) return null;
    // First entry strictly newer than the snapshot anchors the divider;
    // divider draws ABOVE this row. If everything is older, no divider.
    const found = data.find((r) => r.entry.created_at > snapshot);
    return found ? found.entry.id : null;
  }, [data]);
  const dividerScrolledPastRef = useRef(false);

  useEffect(() => {
    if (!highlightCommentId || data.length === 0) return;
    const stamp = `${highlightCommentId}:${highlightNonce ?? ""}`;
    if (lastStampRef.current === stamp) return;
    lastStampRef.current = stamp;

    setHighlightedId(highlightCommentId);

    const fade = setTimeout(() => setHighlightedId(null), HIGHLIGHT_HOLD_MS);
    return () => clearTimeout(fade);
  }, [highlightCommentId, highlightNonce, data.length]);

  // ── New-comment-while-reading chip ────────────────────────────────────
  // After landing, if WS appends new entries while the user is NOT at the
  // bottom, surface a floating "↓ N new" chip instead of silently shifting
  // content below the viewport. Tapping the chip scrolls to bottom and
  // clears the counter; reaching the bottom by hand also clears it.
  const [newCount, setNewCount] = useState(0);
  const isAtBottomRef = useRef(true);

  // ── "Jump to bottom" floating button ─────────────────────────────────
  // Shown while the user is scrolled up away from the latest comment and
  // hidden once they return to the bottom. Distinct from the "↓ N new"
  // chip: that chip only appears when WS appends arrive while scrolled up,
  // whereas the FAB reflects the bare at-bottom state regardless of new
  // content. `handleScroll` already tracks at-bottom; we fold the FAB flip
  // into it so a habitually-churned scroll handler doesn't re-render per
  // frame (state update only fires on an actual visibility change).
  //
  // A normal issue-open lands at the TOP (header first) — the FAB should
  // greet the reader immediately. Only a deep-link (`highlightCommentId`)
  // starts at the bottom (FlashList `startRenderingFromBottom`), where the
  // FAB starts hidden. The up button starts hidden either way: at the top it
  // is pointless, and at the bottom the "caught up" state stays clean.
  const [showJumpFab, setShowJumpFab] = useState(!highlightCommentId);
  const showJumpFabRef = useRef(!highlightCommentId);
  const [showJumpTopFab, setShowJumpTopFab] = useState(false);
  const showJumpTopFabRef = useRef(false);

  const lastDataLenRef = useRef(0);
  useEffect(() => {
    const grew = data.length > lastDataLenRef.current;
    const diff = data.length - lastDataLenRef.current;
    lastDataLenRef.current = data.length;
    if (!grew) return;
    // `isAtBottomRef` defaults to `true` so the initial 0→N load is treated
    // as "user is already at the bottom" and the chip stays silent until a
    // later WS append arrives while the user is scrolled up.
    if (isAtBottomRef.current) return;
    setNewCount((prev) => prev + diff);
  }, [data.length]);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      // The visible height, kept for the find landing: centring a description
      // hit needs it, and `onScroll` is the earliest point it is known without
      // adding a second layout listener to the list. A ref, not state — nothing
      // renders from it, and a scroll handler that set state per frame would be
      // the churn the FAB logic above exists to avoid.
      viewportHeightRef.current = layoutMeasurement.height;
      const metrics = {
        contentOffsetY: contentOffset.y,
        contentHeight: contentSize.height,
        viewportHeight: layoutMeasurement.height,
        slackPx: AT_BOTTOM_SLACK_PX,
      };
      const nowAtBottom = isNearBottom(metrics);
      const wasAtBottom = isAtBottomRef.current;
      isAtBottomRef.current = nowAtBottom;
      // Reaching the bottom clears the unread-new chip — same iMessage /
      // chat-app semantic: "I've caught up".
      if (!wasAtBottom && nowAtBottom && newCount > 0) {
        setNewCount(0);
      }
      // FAB shows when scrolled up, hides when at bottom. `onScroll` fires
      // every frame; only re-render when a button's visibility flips.
      const nextFab = nextFabVisibility(showJumpFabRef.current, metrics);
      if (nextFab !== showJumpFabRef.current) {
        showJumpFabRef.current = nextFab;
        setShowJumpFab(nextFab);
      }
      const nextTopFab = nextJumpTopFabVisibility(
        showJumpTopFabRef.current,
        metrics,
      );
      if (nextTopFab !== showJumpTopFabRef.current) {
        showJumpTopFabRef.current = nextTopFab;
        setShowJumpTopFab(nextTopFab);
      }
    },
    [newCount],
  );

  const onJumpToNew = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
    setNewCount(0);
  }, []);

  const onJumpToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // ── Inject divider as a sentinel row before its anchor entry ──────────
  // FlatList wants a flat data[] and a stable key per row. Rather than
  // teach the renderer about "items + dividers" via a union type, fake a
  // TimelineRow with a sentinel id; renderItem checks the id first.
  const dataWithDivider = useMemo<TimelineRow[]>(() => {
    if (!dividerAnchorId) return data;
    const anchorIdx = data.findIndex((r) => r.entry.id === dividerAnchorId);
    if (anchorIdx <= 0) return data;
    const divider: TimelineRow = {
      // Cast: this entry is a synthetic marker, not a real TimelineEntry —
      // renderItem keys off `id === DIVIDER_ID` and never reads other fields.
      entry: {
        id: DIVIDER_ID,
        type: "activity",
        created_at: "",
        actor_type: "",
        actor_id: "",
      } as unknown as TimelineEntry,
      replies: [],
    };
    return [...data.slice(0, anchorIdx), divider, ...data.slice(anchorIdx)];
  }, [data, dividerAnchorId]);

  // ── Thread-navigator jump ─────────────────────────────────────────────
  // Land the picked thread's row at the top of the viewport, then flash it
  // through the SAME `highlightedId` channel the inbox deep-link uses — one
  // "this is the row you asked for" affordance, not two.
  //
  // `scrollToIndex` rather than the deep-link's `startRenderingFromBottom`:
  // a deep-link wants the end of the document, a navigator jump wants one
  // specific row (web `jumpToThread` reads the same way). FlashList's index
  // is into `dataWithDivider`, so resolve it against that array, header
  // offset included — the underlying call handles ListHeaderComponent.
  const lastJumpRef = useRef<string | null>(null);
  useEffect(() => {
    if (!jumpToThreadId || dataWithDivider.length === 0) return;
    const stamp = `${jumpToThreadId}:${jumpNonce ?? ""}`;
    if (lastJumpRef.current === stamp) return;
    lastJumpRef.current = stamp;

    const index = dataWithDivider.findIndex(
      (row) => row.entry.id === jumpToThreadId,
    );
    if (index < 0) return;

    // The promise rejects when the index cannot be resolved yet (FlashList
    // still measuring); swallowing it is right here — the row is on screen
    // either way, and the flash below still marks it.
    listRef.current
      ?.scrollToIndex({ index, animated: true, viewPosition: 0 })
      .catch(() => {});
    setHighlightedId(jumpToThreadId);
    const fade = setTimeout(() => setHighlightedId(null), JUMP_HIGHLIGHT_HOLD_MS);
    return () => clearTimeout(fade);
  }, [jumpToThreadId, jumpNonce, dataWithDivider]);

  // ── In-page find step ─────────────────────────────────────────────────
  // Stepping through find hits reuses the SAME `highlightedId` channel the
  // deep-link and the navigator jump use — one "this is the row you asked for"
  // affordance, not three.
  //
  // The lookup goes through replies as well as top-level rows. Replies live
  // inside their parent's `CommentCard` rather than in `dataWithDivider`, so
  // resolving only `row.entry.id` would find nothing for a hit inside a reply —
  // i.e. for exactly the matches that motivated this feature. `CommentCard`
  // already highlights a child reply when `highlightedCommentId` names it
  // (`reply.id === highlightedCommentId`), so scrolling to the OWNING row is
  // all that is needed for the flash to land on the right line.
  //
  // Hold time matches a navigator jump rather than the 5s inbox hold: find
  // lands the row in view immediately and the reader may step again at any
  // moment, so the flash only has to confirm which row it was.
  const lastFindRef = useRef<string | null>(null);
  // A find hit in the title or the description is not a row, so it cannot go
  // through `scrollToIndex`: the header is `ListHeaderComponent`, above index
  // 0, and scrolling row 0 into view would push the very block holding the
  // match off the top of the screen. Those two get an offset scroll instead,
  // and their own flash surface (`findHeaderFlash`) rather than
  // `highlightedId` — which is a COMMENT-id channel, and a sentinel pushed
  // through it would reach every `CommentCard` as a target that matches
  // nothing.
  const [findHeaderFlash, setFindHeaderFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!findTargetId) return;
    const stamp = `${findTargetId}:${findNonce ?? ""}`;
    if (lastFindRef.current === stamp) return;

    if (isHeaderFindTarget(findTargetId)) {
      // Deliberately NOT gated on `dataWithDivider.length`: the header exists
      // whether or not the issue has comments, and an issue whose description
      // is its only prose (the case this round exists for) must still land.
      lastFindRef.current = stamp;
      // The title sits at the very top, so 0 is exact. A description hit sits
      // below the header card, whose height varies with the attribute chips and
      // any custom properties, so its offset is what `onLayout` measured.
      //
      // For the description the landing is the SEGMENT that holds the match
      // (MYS-2112), not the description's top: the description renders as a
      // list of segments, each measured by its own `onLayout`
      // (`measuredSegmentRectsRef`), and a hit deep in the 4th segment is
      // unreachable from the top — measured on MYS-2077, the matched row sits
      // 1,987dp down against a ~700dp viewport. `descriptionFindOffset` then
      // CENTRES the match inside that measured rectangle, which is what makes
      // the modelled fraction's error survivable (it measured 12 points of a
      // segment on the fixture — far more than a top pad could absorb). See that
      // function's docblock for the numbers and for why web centres too.
      //
      // A segment whose rectangle is not measured yet degrades to the
      // description's top — exactly the previous behaviour, so nothing that
      // worked before can regress.
      const segmentTop = isDescriptionFindTarget(findTargetId)
        ? measuredSegmentRectsRef.current.get(descriptionTargetIndex(findTargetId))
        : undefined;
      const offset =
        findTargetId === FIND_TARGET_TITLE
          ? 0
          : descriptionFindOffset({
              segmentTop:
                segmentTop === undefined
                  ? Math.max(0, measuredHeaderTopsRef.current.description)
                  : Math.max(
                      0,
                      measuredHeaderTopsRef.current.description + segmentTop.top,
                    ),
              segmentHeight: segmentTop?.height ?? 0,
              fraction: findFraction,
              viewportHeight: viewportHeightRef.current,
            });
      listRef.current?.scrollToOffset({ offset, animated: true });
      setFindHeaderFlash(findTargetId);
      const fade = setTimeout(() => setFindHeaderFlash(null), JUMP_HIGHLIGHT_HOLD_MS);
      return () => clearTimeout(fade);
    }

    if (dataWithDivider.length === 0) return;
    const index = dataWithDivider.findIndex(
      (row) =>
        row.entry.id === findTargetId ||
        row.replies.some((reply) => reply.id === findTargetId),
    );
    // The stamp is committed only once the row resolves. Committing it first
    // (as the navigator effect below does) would burn the one shot on a render
    // where the target's row is not in `data` yet, and the scroll could then
    // never fire — the stamp would already match on the render that does have
    // it. Re-running `findIndex` on later renders is free; a lost jump is not.
    if (index < 0) return;
    lastFindRef.current = stamp;

    // Swallowed for the same reason the navigator's is: a rejection means
    // FlashList has not measured the index yet — the row is on screen either
    // way, and the flash below still marks it.
    listRef.current
      ?.scrollToIndex({ index, animated: true, viewPosition: 0 })
      .catch(() => {});
    setHighlightedId(findTargetId);
    const fade = setTimeout(() => setHighlightedId(null), JUMP_HIGHLIGHT_HOLD_MS);
    return () => clearTimeout(fade);
    // `findFraction` is a dependency for closure correctness — the effect body
    // reads it to compute the landing. It advances together with `findNonce`
    // (the screen sets both from one match), so it can never cause a re-fire the
    // stamp guard would not already have allowed: the guard is keyed on
    // (targetId, nonce), and a fraction that changed under a fixed nonce would be
    // a screen bug, not a reason to scroll.
  }, [findTargetId, findNonce, findFraction, dataWithDivider]);

  // Mark "scrolled past" once the divider row leaves the viewport — used
  // by the unmount effect below to decide whether to bump last-viewed.
  const viewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: 1 }),
    [],
  );
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (!dividerAnchorId) return;
      if (dividerScrolledPastRef.current) return;
      const dividerIdx = dataWithDivider.findIndex(
        (r) => r.entry.id === DIVIDER_ID,
      );
      if (dividerIdx < 0) return;
      const minVisibleIdx = viewableItems.reduce(
        (acc, v) => (v.index != null && v.index < acc ? v.index : acc),
        Number.POSITIVE_INFINITY,
      );
      if (minVisibleIdx > dividerIdx) {
        dividerScrolledPastRef.current = true;
      }
    },
    [dividerAnchorId, dataWithDivider],
  );
  // FlashList v2 captures `viewabilityConfigCallbackPairs` at mount —
  // "Changing viewabilityConfig on the fly is not supported." So we wrap
  // the handler in a stable ref-backed forwarder and pass a frozen pairs
  // array. The inner closure still updates with deps (dividerAnchorId,
  // dataWithDivider), but the prop identity FlashList sees is stable.
  const handlerRef = useRef(handleViewableItemsChanged);
  useEffect(() => {
    handlerRef.current = handleViewableItemsChanged;
  }, [handleViewableItemsChanged]);
  const stableViewabilityHandler = useCallback(
    (info: { viewableItems: ViewToken[] }) => handlerRef.current(info),
    [],
  );
  const viewabilityCallbackPairs = useRef([
    {
      viewabilityConfig,
      onViewableItemsChanged: stableViewabilityHandler,
    },
  ]);

  // On unmount, mark the issue's timeline as "viewed up to now" if the
  // user has either (a) scrolled past the divider or (b) had no divider
  // because everything was already older than their previous visit.
  // Otherwise leave the snapshot alone so a next visit preserves the
  // "where I was" line.
  const markViewed = useLastViewedStore((s) => s.markViewed);
  useEffect(() => {
    const issueId = issue.id;
    return () => {
      if (!dividerAnchorId || dividerScrolledPastRef.current) {
        markViewed(issueId);
      }
    };
    // We intentionally bind the cleanup to the issueId-snapshot only —
    // re-running on `dividerAnchorId` changes would lose the original
    // anchor's "scrolled past" state if WS extended the timeline mid-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue.id]);

  // The rectangle the description's flash should cover: the segment holding the
  // active find hit, in the coordinate space of the description block's wrapper
  // (which is what `absolute` inside that wrapper resolves against). The ref
  // already stores wrapper-relative coordinates, so this is a direct read — the
  // block's own offset is never added here.
  //
  // Zero when the target is the title, when the description is not being
  // flashed, or when the segment has not been measured — and a zero-height
  // overlay draws nothing, so no stale rectangle can linger over the block.
  const descriptionFlashRect = useMemo(() => {
    if (!findHeaderFlash || !isDescriptionFindTarget(findHeaderFlash)) {
      return { top: 0, left: 0, right: 0, height: 0 };
    }
    const rect = measuredSegmentRectsRef.current.get(
      descriptionTargetIndex(findHeaderFlash),
    );
    if (!rect || rect.height <= 0) {
      return { top: 0, left: 0, right: 0, height: 0 };
    }
    return { top: rect.top, left: 0, right: 0, height: rect.height };
  }, [findHeaderFlash]);

  const ListHeader = (
    <View>
      {/* Duplicate banner (MUL-7349) — ABOVE the title, which is where web
       *  puts it (issue-detail.tsx:3277, outside the title block). It has to
       *  be: a cancelled issue's title otherwise reads as the whole story, and
       *  the one thing the reader needs is "this is a duplicate of something
       *  else, go there". Renders null for every issue that is not a duplicate.
       *
       *  Outside `IssueHeaderCard` rather than inside it because the card is
       *  the issue's own identity block — title, chips, properties — and the
       *  banner is about a DIFFERENT issue. Keeping them apart is also what
       *  lets the card stay untouched by this feature. */}
      {onUnmarkDuplicate ? (
        <IssueDuplicateBanner
          issue={issue}
          onUnmark={onUnmarkDuplicate}
          unmarking={unmarkingDuplicate}
        />
      ) : null}
      {/* Source-context strip (MYS-2137) — where a comment-born issue came
       *  from, and whether that source has moved on. Same slot as the duplicate
       *  banner and for the same reason: both are statements about ANOTHER
       *  issue, so both sit outside `IssueHeaderCard`, above the title. Renders
       *  null for every issue that was not opened from a comment, which is
       *  almost all of them.
       *
       *  Unconditional where the duplicate banner is gated on `onUnmarkDuplicate`
       *  — that prop exists because the banner carries a write (the unmark
       *  action), and this strip carries none. It is a pure read of a field the
       *  server already resolved into the payload. */}
      <IssueSourceContextBanner issue={issue} />
      {/* Find indexes the title (it is the first thing the page renders), so
       *  the header card takes a flag for it. The flash lives inside that card
       *  around the title line rather than here around the whole card: the card
       *  also holds the attribute chips, the agent-activity row and the custom
       *  properties, and washing all of them would claim the match is
       *  somewhere it is not. */}
      <IssueHeaderCard
        issue={issue}
        titleHighlighted={findHeaderFlash === FIND_TARGET_TITLE}
      />
      {/* Wrapped so `onLayout` can report where the description actually sits:
       *  a find hit in it has to scroll there, and the header card above grows
       *  and shrinks with its chips, so the offset is not a constant. The
       *  wrapper is layout-transparent — no padding, margin or background — so
       *  it changes nothing about how the header draws. */}
      <View
        onLayout={(e) => {
          measuredHeaderTopsRef.current.description = e.nativeEvent.layout.y;
        }}
      >
        {/* Segment rectangles feed the description's find landing (MYS-2112):
         *  a hit deep in a long description must land on the segment that holds
         *  it, and each segment is the finest geometry the native renderer will
         *  measure.
         *
         *  Stored WRAPPER-RELATIVE (`report.top` as measured), NOT converted to
         *  scroll-content coordinates here. The landing adds the description's
         *  own measured offset when it reads them, so baking it in on this side
         *  as well double-counts it — which is a bug this round actually shipped
         *  and the device caught: it scrolled 213dp (exactly
         *  `measuredHeaderTopsRef.current.description`) too far, putting the
         *  matched row just past the viewport's bottom edge. One conversion, on
         *  the reading side, is what keeps it correct — and it needs to be there
         *  anyway, because a description whose header above it resizes moves in
         *  the content without any segment `onLayout` firing.
         *
         *  Written into a ref rather than state: this fires on every layout
         *  pass (fonts loading, a table re-measuring) and nothing renders from
         *  the values, so routing them through state would re-render the whole
         *  timeline for a measurement only the next jump reads. */}
        <IssueDescription
          issueId={issue.id}
          description={issue.description}
          onSegmentLayout={(report) => {
            measuredSegmentRectsRef.current.set(report.index, {
              top: report.top,
              height: report.height,
            });
          }}
        />
        {/* Flashed when an in-page find step lands in the description. Covers
         *  the SEGMENT that holds the match, not the whole block (MYS-2112): a
         *  description-level wash would claim the match is somewhere it is
         *  demonstrably not — the very confusion this round exists to remove.
         *
         *  Still coarser than the matched LINE, and deliberately so: the native
         *  renderer exposes no line geometry, so a tighter mark would have to be
         *  drawn from the same modelled `fraction` the scroll uses and would
         *  point at the wrong line whenever the model is off — worse than
         *  covering a whole segment, which is at least always true. */}
        <HighlightOverlay
          active={findHeaderFlash !== null && isDescriptionFindTarget(findHeaderFlash)}
          className="absolute rounded-lg border-2 border-brand/50 bg-brand/5"
          style={descriptionFlashRect}
        />
      </View>
      <IssueReactionRow issue={issue} />
      {/* Parent block (MYS-493) — renders null when the issue has no
          parent, so it doesn't crowd the header in the common case. */}
      <IssueParentSection issue={issue} wsSlug={wsSlug} />
      <IssueChildrenSection issueId={issue.id} subIssues={subIssues} wsSlug={wsSlug} />
      {/* Duplicates of THIS issue (MUL-7349) — "three other people hit the
       *  same thing". Web's sidebar order puts it directly after the parent
       *  block and before the pull-request section
       *  (issue-detail.tsx:2921), which is the order kept here: relations
       *  first, then the linked-PR and deliverable sections. Fetches its own
       *  relation and renders null when empty, so an issue nobody duplicated
       *  gains no row. */}
      <IssueDuplicatesSection issueId={issue.id} />
      {/* Linked GitHub PRs (MYS-526) — mirrors web's sidebar section. Sits
          between the sub-issue list and the Activity header; fetches its own
          data via issuePullRequestsOptions and re-renders on cache changes. */}
      <PullRequestList issueId={issue.id} />
      {/* Deliverables (MUL-7649) — the files this issue's comments delivered,
          as a whole. Web's sidebar puts it directly below the PR section, and
          the same order is kept here. Reads the raw `entries` rather than the
          coalesced/threaded rows: `collectDeliverableFiles` wants the comment
          entries themselves, and `coalesceTimeline` only merges activities.
          Renders nothing when the issue delivered no file. */}
      <DeliverablesSection
        files={deliverableFiles}
        identifier={issue.identifier}
        entries={entries}
        source={deliverableSource}
      />
      {/* Issue-sidebar Quick Actions (MYS-680) — workspace-configured presets
       * run on the issue with one tap, mirroring web's sidebar section.
       * Renders null when the workspace has no active quick action, so it
       * doesn't crowd the header in the common case. */}
      <QuickActionsSection issueId={issue.id} />
      {/* Issue wakeup rules (MYS-2023) — the conditions this issue is waiting
       * on, mirroring web's sidebar section. Web's order is QuickActions →
       * Wakeups → Plugin → Parent (issue-detail.tsx:2870); mobile has no
       * plugin panel, so it lands directly after QuickActions. Renders
       * nothing when the issue is closed and has no rules, so the common
       * issue gains no row. */}
      <WakeupsSection
        issueId={issue.id}
        closed={isClosedIssue(issue)}
        // The issue's agent assignee is who a new rule should wake by default —
        // the same seed web passes (`issue-detail.tsx:2873`). Absent for a
        // member assignee or none, and the form then asks for one.
        defaultAgentId={
          issue.assignee_type === "agent"
            ? (issue.assignee_id ?? undefined)
            : undefined
        }
      />
      {/* Raw metadata bag (G26) — renders null when the issue has none, so an
          issue that never used metadata gains no row. Read-only: the bag is
          the agents' channel and web has no write path either. */}
      <IssueMetadataSection metadata={issue.metadata} />
      <View className="px-4 pt-4 pb-2 border-t border-border">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-caption uppercase tracking-wider text-muted-foreground font-medium">
            {t("timeline.activity")}
          </Text>
          {/* Subscribe / unsubscribe — mirrors web's Activity-header
           * subscription control (issue-detail.tsx:2888). Renders nothing
           * until the subscribers query resolves. `subIssues` length is the
           * "known children" signal that decides whether the unsubscribe
           * menu needs the subtree entry. */}
          <SubscriptionControl
            issueId={issue.id}
            childCount={subIssues ? subIssues.length : null}
          />
        </View>
      </View>
      {timelineLoading && (!entries || entries.length === 0) ? (
        <View className="py-6 items-center">
          <ActivityIndicator />
        </View>
      ) : null}
    </View>
  );

  // When a fresh inbox deep-link arrives AND timeline data has loaded, force
  // a FlashList remount so `getInitialScrollIndex()` re-runs with
  // `startRenderingFromBottom: true` and lands on the last data item. If we
  // mounted before data arrived, FlashList's one-shot initial-scroll
  // (useRecyclerViewController.applyInitialScrollIndex, gated on
  // `initialScrollCompletedRef`) would have already declared completion at
  // length 0 and never re-fire. Switching the key when data goes empty →
  // non-empty under a live highlight is the cheapest way to re-arm it.
  const hasData = dataWithDivider.length > 0;
  const flashListKey =
    highlightCommentId && hasData
      ? `hl-${highlightNonce ?? "0"}`
      : "list";

  // Stable renderItem — timeline rows re-render only when their slice of
  // `dataWithDivider` actually changes, not on every parent render. Deps are
  // the values renderItem closes over: issue identity + the transient
  // highlight id.
  const renderItem = useCallback(
    ({ item }: { item: TimelineRow }) => {
      if (item.entry.id === DIVIDER_ID) {
        return <UnreadDivider />;
      }
      return item.entry.type === "comment" ? (
        <CommentCard
          entry={item.entry}
          replies={item.replies}
          issueId={issue.id}
          issueIdentifier={issue.identifier}
          highlightedCommentId={highlightedId}
        />
      ) : (
        // An activity row is a find target too (MYS-2109), so it takes the same
        // highlight bit a comment card does. `highlightedId` reaches it by the
        // same `findIndex` over `row.entry.id` above — no second channel.
        <ActivityRow entry={item.entry} highlighted={highlightedId === item.entry.id} />
      );
    },
    [issue.id, issue.identifier, highlightedId],
  );

  return (
    <ImageSequenceProvider blocks={imageBlocks}>
    <View className="flex-1">
      {/* Outer Pressable owns the "tap anywhere outside the selected
          comment to exit text-selection mode" gesture. Disabled when
          no comment is selected → layout-only wrapper, every tap passes
          through to cells / chips / reactions. Active state captures any
          tap that didn't fire an inner Pressable — selecting CommentBody
          renders without its own Pressable wrapper (see comment-card.tsx
          `if (isSelecting) return body;`), so taps on the selected
          comment dismiss too, matching iOS Notes / iMessage. Scroll
          gestures are unaffected. */}
      <Pressable
        onPress={
          selectingId
            ? () => useCommentSelectStore.getState().clear()
            : undefined
        }
        disabled={!selectingId}
        style={{ flex: 1 }}
      >
      <FlashList
        key={flashListKey}
        ref={listRef}
        data={dataWithDivider}
        keyExtractor={(row) => row.entry.id}
        ListHeaderComponent={ListHeader}
        // Drag-to-dismiss keyboard — when the user scrolls the timeline
        // while the composer keyboard is up, the keyboard slides down
        // interactively (iMessage / WhatsApp / Slack idiom). Pairs with the
        // composer's `onBlur` → auto-collapse to pill: scroll dismisses
        // keyboard → TextInput blurs → composer collapses if empty.
        keyboardDismissMode="on-drag"
        // Tap-on-row inside the list (long-press a comment, tap a
        // reaction) should still register even when the keyboard is up.
        keyboardShouldPersistTaps="handled"
        // FlashList v2 MVCP. `startRenderingFromBottom` only applies when a
        // deep-link is active — a normal issue-open lands at the top so the
        // user sees the header (title, description, status) first. After
        // initial paint the (always-on) MVCP keeps visible content stable
        // when upper rows resize via async markdown / WS events; we do NOT
        // set `autoscrollToBottomThreshold` because timeline uses an
        // explicit "↓ N new" chip instead of silently following appends.
        maintainVisibleContentPosition={{
          startRenderingFromBottom: !!highlightCommentId,
        }}
        // "Activity" is a section heading, not a sibling row — it should
        // hug the first entry the way iOS Settings / Linear sections do.
        // 4 px is just enough breathing room without making the heading
        // float above the list. (12 px = row-to-row gap, wrong here.)
        ListHeaderComponentStyle={{ marginBottom: 4 }}
        ItemSeparatorComponent={RowSeparator}
        renderItem={renderItem}
        // 区分 cell 类型（comment / activity / divider 哨兵），FlashList
        // 复用时不把 divider 槽位塞给 comment。v2 自动测量尺寸，无需
        // v1 的 estimatedItemSize。
        getItemType={(item) =>
          item.entry.id === DIVIDER_ID
            ? "divider"
            : item.entry.type === "comment"
              ? "comment"
              : "activity"
        }
        onScroll={handleScroll}
        // The viewport height is needed the FIRST time find lands in the
        // description, which can happen before any scroll event fires (typing a
        // query scrolls nothing until the jump). `onLayout` on the list is where
        // it is known that early; `handleScroll` keeps it current afterwards.
        // A ref, so this fires without a re-render.
        onLayout={(e) => {
          viewportHeightRef.current = e.nativeEvent.layout.height;
        }}
        // Any user-initiated scroll exits comment text-selection mode —
        // matches iMessage's behavior where scrolling implicitly commits /
        // dismisses the selection caret. Hooks both drag-start and the
        // momentum kick after a flick so a fast scroll can't escape.
        onScrollBeginDrag={() =>
          useCommentSelectStore.getState().clear()
        }
        onMomentumScrollBegin={() =>
          useCommentSelectStore.getState().clear()
        }
        viewabilityConfigCallbackPairs={viewabilityCallbackPairs.current}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingBottom: 16 }}
      />
      </Pressable>
      {newCount > 0 ? (
        <NewCommentChip count={newCount} onPress={onJumpToNew} />
      ) : null}
      <ScrollJumpControl
        showJumpToTop={showJumpTopFab}
        showJumpToBottom={showJumpFab}
        onJumpToTop={onJumpToTop}
        onJumpToBottom={onJumpToNew}
        jumpToTopLabel={t("a11y.jumpToTop")}
        jumpToBottomLabel={t("a11y.jumpToBottom")}
      />
    </View>
    </ImageSequenceProvider>
  );
}

/**
 * 12 px vertical gap between every timeline row. FlashList ignores
 * `gap-*` on `contentContainer`, so the spacing is supplied via this
 * separator component — same pattern as chat-message-list.tsx.
 */
function RowSeparator() {
  return <View style={{ height: 12 }} />;
}

/**
 * Horizontal rule + "New" pill spanning the row width. Drawn between the
 * last entry the user had seen on their previous visit and the first one
 * they haven't. Mirrors Slack / iMessage / Things' "unread divider"
 * idiom — a passive visual mark, not interactive (no tap-to-dismiss; it
 * disappears the next time the user scrolls past and unmounts the screen).
 */
function UnreadDivider() {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center gap-2 px-4">
      <View className="flex-1 h-px bg-destructive/40" />
      <Text className="text-micro uppercase tracking-wider font-medium text-destructive">
        {t("timeline.new")}
      </Text>
      <View className="flex-1 h-px bg-destructive/40" />
    </View>
  );
}

/**
 * Floating "↓ N new" chip pinned above the composer area. Surfaces WS
 * arrivals the user can't currently see because they're scrolled up.
 * Tap → smooth scrollToEnd + reset counter. Reaching the bottom by hand
 * also clears it (see handleScroll above).
 *
 * Positioned absolute bottom-center inside the parent <View flex-1> wrap;
 * doesn't overlap content because the timeline's `contentContainer`
 * already has its own bottom padding for breathing room above the
 * composer hand-off.
 */
function NewCommentChip({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const fg = THEME[colorScheme].primaryForeground;
  const messages = t(count === 1 ? "comment.message" : "comment.messages");
  return (
    <Pressable
      onPress={onPress}
      className="absolute bottom-3 self-center px-3.5 py-1.5 rounded-full bg-primary active:opacity-80 flex-row items-center gap-1.5"
      accessibilityRole="button"
      accessibilityLabel={t("timeline.jumpToNew", { count, messages })}
      style={{
        // shadow comes from system, not Tailwind — keeps the chip readable
        // against either light or dark timeline content beneath.
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
        elevation: 4,
      }}
    >
      <Ionicons name="arrow-down" size={14} color={fg} />
      <Text className="text-caption font-semibold text-primary-foreground">
        {t("timeline.newCount", { count })}
      </Text>
    </Pressable>
  );
}
