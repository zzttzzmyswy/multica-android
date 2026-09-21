/**
 * Shared pinned-items browser — the list body only (loading / error / empty /
 * rows), no screen chrome. Used by both the "Pinned" bottom-tab
 * (`(tabs)/pins.tsx`, which draws its own `<Header>`) and the `more/pins`
 * push screen (native Stack header).
 *
 * Architecture invariant (matches web): `PinnedItem` only carries metadata
 * (`item_type` + `item_id`). Title / status / icon are fetched per-row via
 * `issueDetailOptions` / `projectDetailOptions` / `issueViewDetailOptions`, so
 * when an issue's status or a project's title changes via `issue:updated` /
 * `project:updated`, this list updates automatically — no cross-entity
 * invalidate on pinKeys is needed. Do NOT inline the display fields into the
 * pin row; that couples this view to a stale snapshot. See
 * packages/core/types/pin.ts top comment.
 *
 * Rendering split by `item_type`:
 *   - issue → existing `<IssueRow>` (used by my-issues / more/issues /
 *     project-related-issues), `showStatus` because pins are heterogeneous
 *     (no section grouping by status).
 *   - project → existing `<ProjectRow>` (used by more/projects).
 *   - view → `<ViewPinRow>`, navigating to the surface that owns the view's
 *     scope and marking the view active there (web `app-sidebar.tsx:305-357`).
 *   - anything else → the unavailable row, and NOTHING ELSE. A type this
 *     build does not know must never be treated as one it does: that is how a
 *     pinned `view` used to be read as an `issue`, 404 on the view id, and get
 *     deleted by a single tap.
 *
 * Unpinning is never a one-tap accident. A resolved issue/project row is
 * removed through its own action (the row's pin toggle), and an unavailable
 * row — the one case where the target cannot be confirmed — asks first. Web
 * auto-unpins on a 404 for issues/projects; on a phone a modal question is
 * cheaper than a silent deletion the user cannot undo.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import type { Issue, PinnedItem, Project } from "@multica/core/types";
import type { IssueView } from "@multica/core/api/schemas";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IssueRow } from "@/components/issue/issue-row";
import { ProjectRow } from "@/components/project/project-row";
import { pinListOptions } from "@/data/queries/pins";
import { useDeletePin, useReorderPins } from "@/data/mutations/pins";
import { issueDetailOptions } from "@/data/queries/issues";
import { projectDetailOptions } from "@/data/queries/projects";
import { issueViewDetailOptions } from "@/data/queries/issue-views";
import {
  issueViewContainerKey,
  useActiveIssueViewStore,
} from "@/data/stores/active-issue-view-store";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { dragTargetIndex, reorderByMove } from "@/lib/pin-reorder";
import { useTranslation } from "@/lib/i18n/react";

export function PinnedScreen() {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    pinListOptions(wsId, userId),
  );
  const reorderPins = useReorderPins();

  // Sort by `position` ascending so the order matches web's sidebar
  // (the reorder endpoint writes 1-based positions there too).
  const serverPins = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.position - b.position),
    [data],
  );

  // Local order while a drag is in flight. Without it the dragged row would
  // snap back to its server slot on every render until the mutation lands —
  // the optimistic cache write is async, so there is a frame gap. Cleared as
  // soon as the server order catches up.
  const [dragOrder, setDragOrder] = useState<PinnedItem[] | null>(null);
  const pins = dragOrder ?? serverPins;
  // Measured heights, keyed by pin id: a drag's drop target is the row the
  // finger is over, and the rows have no common height.
  const heightsRef = useRef<Record<string, number>>({});

  const commitOrder = useCallback(
    (next: PinnedItem[]) => {
      setDragOrder(null);
      reorderPins.mutate(next);
    },
    [reorderPins],
  );

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-background px-4 gap-3 pt-4">
        <Text className="text-sm text-destructive">
          {t("pins.loadFailed")}
          {error instanceof Error ? error.message : t("common.unknownError")}
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>{t("common.retry")}</Text>
        </Button>
      </View>
    );
  }

  if (pins.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-sm text-muted-foreground text-center">
          {t("pins.empty")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="pb-6"
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => refetch()}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {pins.map((pin, idx) => (
        <View
          key={pin.id}
          onLayout={(e) => {
            heightsRef.current[pin.id] = e.nativeEvent.layout.height;
          }}
        >
          {idx > 0 ? <View className="h-px bg-border ml-4" /> : null}
          <DraggablePinRow
            pin={pin}
            index={idx}
            pins={pins}
            heights={heightsRef}
            wsId={wsId}
            wsSlug={wsSlug}
            onDragTo={(to) => {
              // Rebuilt from the row's ORIGINAL index, never its current one:
              // after the first move the row already sits at `to`, and
              // splicing by a stale index would drop a different pin.
              setDragOrder(reorderByMove(pins, idx, to));
            }}
            onDrop={() => {
              if (!dragOrder) return;
              commitOrder(dragOrder);
            }}
          />
        </View>
      ))}
    </ScrollView>
  );
}

/**
 * One pin row plus its drag handle. The handle owns the PanResponder and the
 * row follows it by translation — rewriting the array mid-drag would remount
 * the moving row and drop the gesture, so `onDragTo` only rewrites the local
 * preview order and the server is told once, on release.
 *
 * The drop target is computed from MEASURED row heights, not from an assumed
 * uniform one: a pin list mixes issue rows with taller project rows, and a
 * fixed divisor puts the drop in the wrong slot as soon as the two appear
 * together.
 */
function DraggablePinRow({
  pin,
  index,
  pins,
  heights,
  wsId,
  wsSlug,
  onDragTo,
  onDrop,
}: {
  pin: PinnedItem;
  index: number;
  pins: PinnedItem[];
  heights: { current: Record<string, number> };
  wsId: string | null;
  wsSlug: string | null;
  onDragTo: (to: number) => void;
  onDrop: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const [dy, setDy] = useState(0);

  // All gesture-time state lives in refs: the responder is rebuilt on every
  // render, and closures over `index`/`pins` would otherwise be one frame
  // stale mid-drag.
  const indexRef = useRef(index);
  indexRef.current = index;
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const dyRef = useRef(0);
  const targetRef = useRef(index);
  // The order as it stood when the drag began — the drag's `from` index is
  // resolved against THIS, so a mid-drag preview rewrite cannot shift it.
  const orderAtStartRef = useRef<PinnedItem[]>(pins);

  const targetIndexFor = (delta: number) =>
    dragTargetIndex({
      ids: orderAtStartRef.current.map((p) => p.id),
      heights: heights.current,
      startIndex: indexRef.current,
      delta,
    });

  const responder = useMemo(
    () =>
      PanResponder.create({
        // CAPTURE, not bubble. The handle sits inside the list's ScrollView,
        // and the ScrollView claims a vertical drag before the child ever
        // sees it — with only the bubble-phase handlers below, the responder
        // never fired at all (verified on-device: grant/move counts stayed 0
        // across a swipe that scrolled the list). Capture runs parent-first,
        // so the handle takes the gesture before the scroller can.
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 2,
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          orderAtStartRef.current = pinsRef.current;
          targetRef.current = indexRef.current;
          Haptics.selectionAsync().catch(() => {});
        },
        onPanResponderMove: (_e, g) => {
          dyRef.current = g.dy;
          setDy(g.dy);
          const next = targetIndexFor(g.dy);
          if (next !== targetRef.current) {
            targetRef.current = next;
            Haptics.selectionAsync().catch(() => {});
            onDragTo(next);
          }
        },
        onPanResponderRelease: () => {
          dyRef.current = 0;
          setDy(0);
          onDrop();
        },
        onPanResponderTerminate: () => {
          dyRef.current = 0;
          setDy(0);
          onDrop();
        },
      }),
    [onDragTo, onDrop],
  );

  return (
    <View
      style={dy !== 0 ? { transform: [{ translateY: dy }], zIndex: 10 } : undefined}
      className="flex-row items-center bg-background"
    >
      <View className="flex-1">
        <PinRow pin={pin} wsId={wsId} wsSlug={wsSlug} />
      </View>
      <View
        {...responder.panHandlers}
        accessibilityLabel={t("pins.reorder")}
        accessibilityHint={t("pins.reorderHint")}
        accessibilityRole="adjustable"
        className="px-3 py-4"
        hitSlop={4}
      >
        <Ionicons
          name="reorder-two"
          size={18}
          color={THEME[colorScheme].mutedForeground}
        />
      </View>
    </View>
  );
}

function PinRow({
  pin,
  wsId,
  wsSlug,
}: {
  pin: PinnedItem;
  wsId: string | null;
  wsSlug: string | null;
}) {
  // Exhaustive over the known types; anything else falls through to the
  // unavailable row. See the module doc — an unknown type must not be routed
  // to a branch that can delete the pin.
  switch (pin.item_type) {
    case "issue":
      return <IssuePinRow pin={pin} wsId={wsId} wsSlug={wsSlug} />;
    case "project":
      return <ProjectPinRow pin={pin} wsId={wsId} wsSlug={wsSlug} />;
    case "view":
      return <ViewPinRow pin={pin} wsId={wsId} wsSlug={wsSlug} />;
    default:
      return <MissingPinRow itemType={null} itemId={pin.item_id} />;
  }
}

function IssuePinRow({
  pin,
  wsId,
  wsSlug,
}: {
  pin: PinnedItem;
  wsId: string | null;
  wsSlug: string | null;
}) {
  const { data, isLoading } = useQuery(issueDetailOptions(wsId, pin.item_id));
  // EMPTY_ISSUE_FALLBACK has an empty id — treat as deleted/no-access.
  const issue = data && data.id ? (data as Issue) : null;

  if (isLoading) return <SkeletonRow />;
  if (!issue)
    return <MissingPinRow itemType="issue" itemId={pin.item_id} />;

  return (
    <IssueRow
      issue={issue}
      showStatus
      onPress={() => {
        if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}`);
      }}
    />
  );
}

function ProjectPinRow({
  pin,
  wsId,
  wsSlug,
}: {
  pin: PinnedItem;
  wsId: string | null;
  wsSlug: string | null;
}) {
  const { data, isLoading } = useQuery(
    projectDetailOptions(wsId, pin.item_id),
  );
  const project = data && data.id ? (data as Project) : null;

  if (isLoading) return <SkeletonRow />;
  if (!project)
    return <MissingPinRow itemType="project" itemId={pin.item_id} />;

  return (
    <ProjectRow
      project={project}
      onPress={() => {
        if (wsSlug) router.push(`/${wsSlug}/project/${project.id}`);
      }}
    />
  );
}

/**
 * A pinned saved view. Tapping opens the surface that owns the view's scope
 * and marks the view active in that surface's container, which then applies
 * the snapshot (`useApplyExternallyActivatedView`). Mirrors web
 * `app-sidebar.tsx:305-357`.
 *
 * Two deliberate divergences from web, both about not losing the pin:
 *   - a view whose detail query FAILS (older backend without the view
 *     endpoints, a transient 5xx) renders as unavailable instead of
 *     disappearing, so the user can see it is still pinned;
 *   - nothing here auto-unpins.
 */
function ViewPinRow({
  pin,
  wsId,
  wsSlug,
}: {
  pin: PinnedItem;
  wsId: string | null;
  wsSlug: string | null;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const { data, isLoading } = useQuery(
    issueViewDetailOptions(wsId, pin.item_id),
  );
  const view = data?.id ? (data as IssueView) : null;

  if (isLoading) return <SkeletonRow />;
  if (!view) return <MissingPinRow itemType="view" itemId={pin.item_id} />;

  // One resolved scope drives both the destination and the container key, so
  // a scope_type from a newer backend degrades coherently (web does the same
  // for `scope_type`).
  const scopeType: "workspace" | "my" | "project" =
    view.scope_type === "my"
      ? "my"
      : view.scope_type === "project" && view.scope_id
        ? "project"
        : "workspace";

  return (
    <Pressable
      onPress={() => {
        if (!wsSlug) return;
        const containerKey = issueViewContainerKey(wsId, {
          scope_type: scopeType,
          scope_id: scopeType === "project" ? view.scope_id : null,
        });
        useActiveIssueViewStore.getState().setActive(containerKey, view.id);
        if (scopeType === "my") router.push(`/${wsSlug}/my-issues`);
        else if (scopeType === "project")
          router.push(`/${wsSlug}/project/${view.scope_id}`);
        else router.push(`/${wsSlug}/more/issues`);
      }}
      className="px-4 py-3 flex-row items-center gap-3 active:bg-secondary"
      accessibilityRole="button"
    >
      <Ionicons
        name="layers-outline"
        size={18}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
        {view.name || t("screen.view")}
      </Text>
      {view.visibility === "workspace" ? (
        <Ionicons
          name="people"
          size={13}
          color={THEME[colorScheme].mutedForeground}
        />
      ) : null}
    </Pressable>
  );
}

function SkeletonRow() {
  return (
    <View className="px-4 py-3 flex-row items-center gap-3">
      <View className="size-5 rounded bg-muted" />
      <View className="flex-1 h-4 rounded bg-muted" />
    </View>
  );
}

/**
 * Renders for pins whose target could not be resolved — deleted, revoked, or
 * a type this build does not recognise (`itemType: null`).
 *
 * Tapping asks for confirmation before unpinning. The previous behaviour
 * deleted on a single tap, which turned "the row did not load" into permanent
 * data loss: a view pin mis-parsed as an issue 404'd on the very first tap and
 * was gone. A confirmation is the cheapest possible guard, and it keeps the
 * cleanup affordance the dead-pin case actually needs.
 */
function MissingPinRow({
  itemType,
  itemId,
}: {
  itemType: "issue" | "project" | "view" | null;
  itemId: string;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const deletePin = useDeletePin();

  const typeLabel = itemType
    ? t(
        itemType === "issue"
          ? "screen.issue"
          : itemType === "project"
            ? "screen.project"
            : "screen.view",
      )
    : t("screen.pinned");

  const confirmUnpin = () => {
    Alert.alert(
      t("pins.unpinConfirmTitle"),
      t("pins.unpinConfirmMessage", { itemType: typeLabel }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("pins.unpin"),
          style: "destructive",
          // An unknown type has no endpoint to call — the row stays until the
          // build that understands it arrives. Deleting is not an option here
          // because we cannot name what we would be deleting.
          onPress: () => {
            if (!itemType) return;
            deletePin.mutate({ itemType, itemId });
          },
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <Pressable
      onPress={confirmUnpin}
      className="px-4 py-3 flex-row items-center gap-3 active:bg-secondary opacity-60"
      accessibilityLabel={t("pins.unavailable", { itemType: typeLabel })}
    >
      <Ionicons
        name="alert-circle-outline"
        size={18}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="flex-1 text-sm text-muted-foreground" numberOfLines={1}>
        {t("pins.unavailable", { itemType: typeLabel })}
      </Text>
    </Pressable>
  );
}
