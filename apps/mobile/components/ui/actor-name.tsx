/**
 * The shared "name, or not yet" primitive — one component every surface that
 * prints an actor's name in a row goes through, so `Unknown` stops appearing
 * on cold start in one place rather than in forty-three.
 *
 * Two wrappers, because the surfaces differ in one respect that matters:
 *
 *   - `ActorNameText` — the three settled/unsettled states as text. Use where
 *     the name stands on its own (the issue table's creator column, run rows,
 *     activity rows).
 *   - `ActorNameLabel` — the same, plus the row's other two slots: an avatar
 *     and a "no assignee" dash for a reference that is genuinely absent. Use
 *     where the name sits beside an avatar (the issue table's assignee column,
 *     issue rows, board cards).
 *
 * Why a skeleton rather than nothing: an unsettled cell that renders empty is
 * indistinguishable from a cell whose value is off-screen in a horizontally
 * scrolled table, and in a table the columns are sized by their neighbours —
 * an empty creator cell reflows every row the moment the read lands. The
 * skeleton occupies the same line without asserting a name, which is exactly
 * the contract `lib/catalog-state.ts` asks for: paint the load state, claim
 * nothing.
 *
 * `gone` renders the id fragment (`actorNameState`), not a sentence: a row must
 * still identify *which* actor is missing, and both clients already agreed on
 * that (`lib/actor-profile.ts`, web's `member-profile-card.tsx`).
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ActorNameState, ActorType } from "@/lib/actor-name-state";
import { ActorAvatar } from "@/components/ui/actor-avatar";

/** Width of the name skeleton. Sized to a typical resolved name so the cell
 *  does not visibly reflow when the directory answers — a fixed `w-14` in a
 *  table column reads as "a name goes here", which is the whole message. */
const SKELETON_WIDTH = "w-14";

// `actorNameText` lives in the pure module (with the decision it reads), and is
// re-exported here so a surface importing the components gets both from one
// path. It cannot be defined in this file: react-native is not parseable by the
// Node test lane, and that is where its behaviour is tested.
export { actorNameText } from "@/lib/actor-name-state";

export function ActorNameText({
  state,
  className,
  numberOfLines = 1,
}: {
  state: ActorNameState;
  className?: string;
  numberOfLines?: number;
}) {
  if (state.kind === "unsettled") {
    return (
      <Skeleton
        className={cn("h-3", SKELETON_WIDTH, className)}
        // A skeleton is a load state, not a value: announcing it as text would
        // put "Unknown" back into the accessibility tree under another name.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    );
  }
  return (
    <Text
      className={cn(
        "text-caption text-muted-foreground",
        state.kind === "gone" && "text-muted-foreground/70",
        className,
      )}
      numberOfLines={numberOfLines}
    >
      {state.name}
    </Text>
  );
}

/**
 * Avatar + name, with the states a row's assignee slot needs. `empty` is
 * passed when the issue holds no actor at all — that absence IS measured (it
 * is a field of the issue row, not of a directory), so it keeps its dash even
 * while the directories are loading.
 */
export function ActorNameLabel({
  type,
  id,
  state,
  empty = false,
  emptyLabel = "—",
  avatarSize = 18,
  textClassName,
  className,
  showPresence = false,
}: {
  type: ActorType | null | undefined;
  id: string | null | undefined;
  state: ActorNameState;
  empty?: boolean;
  emptyLabel?: string;
  avatarSize?: number;
  textClassName?: string;
  className?: string;
  showPresence?: boolean;
}) {
  if (empty) {
    return (
      <Text className="text-caption text-muted-foreground/60">{emptyLabel}</Text>
    );
  }
  return (
    <View className={cn("flex-row items-center gap-1.5", className)}>
      {type && id ? (
        <ActorAvatar type={type} id={id} size={avatarSize} showPresence={showPresence} />
      ) : null}
      <ActorNameText state={state} className={textClassName} />
    </View>
  );
}
