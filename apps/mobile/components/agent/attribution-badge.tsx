/**
 * Mobile attribution badge — "on behalf of <member>", the accountable-human
 * provenance of an agent run (MUL-4302 §9). Port of web's
 * `packages/views/issues/components/attribution-badge.tsx`. Two deliberate
 * divergences from web, both forced by the platform:
 *
 *  1. **No `variant="badge"` chip.** Web defines that shape but never
 *     consumes it outside its own tests — the two production call sites both
 *     pass `avatar` (activity row) or `inline` (transcript header).
 *  2. **No hover.** Web parks the member name and the resolution source in a
 *     hover tooltip. A phone has none, so:
 *       - `avatar` keeps the row dense and moves both lines into the existing
 *         `ActionSheet` on tap (`lib/action-sheet`) — tapping is this repo's
 *         established hover stand-in (ActorAvatar's `onPressProfile`, every
 *         row-level "…" menu).
 *       - `inline` prints the name and the source side by side. Web splits
 *         them (name inline, source in the tooltip), but the transcript
 *         header has no room to hide the source on a phone without making it
 *         unreachable, and "<name> · <how>" is the form that stays legible in
 *         a single clamped line.
 *
 * Both shapes stay silent when no responsible member resolved: an
 * avatar-or-name surface has nothing meaningful to show for an unattributed
 * run, and the caller must not leave a dangling separator where it would have
 * gone (web guards both call sites on `task.attribution?.initiator` for the
 * same reason).
 */
import { Pressable } from "react-native";
import type { TaskAttribution } from "@multica/core/types";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Text } from "@/components/ui/text";
import { ActionSheet } from "@/lib/action-sheet";
import { useTranslation } from "@/lib/i18n/react";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";
import {
  attributionShouldRender,
  attributionSourceLabelKey,
  isAttributionUncertain,
} from "@/lib/task-attribution";

/**
 * The resolution source as display text. An unknown level (the server owns
 * this vocabulary and may add one) degrades to the raw value rather than a
 * blank label — web's `default: sourceLabel = attribution.source`.
 */
export function useAttributionSourceLabel(): (source: string) => string {
  const { t } = useTranslation();
  return (source: string) => {
    const key = attributionSourceLabelKey(source);
    return key ? t(key) : source;
  };
}

/** The accountable member's display name. The server can resolve a human
 *  without ever sending a name; web falls back to a generic placeholder
 *  rather than rendering an empty "on behalf of". */
function useInitiatorName(): (attribution: TaskAttribution) => string {
  const { t } = useTranslation();
  return (attribution: TaskAttribution) =>
    attribution.initiator?.name || t("agents.activity.attribution.someone");
}

export function AttributionBadge({
  attribution,
  variant,
  className,
}: {
  attribution?: TaskAttribution;
  variant: "avatar" | "inline";
  className?: string;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const initiatorName = useInitiatorName();
  const sourceLabel = useAttributionSourceLabel();

  if (!attributionShouldRender(attribution) || !attribution) return null;

  const name = initiatorName(attribution);
  // A fallback guess is called out; see `isAttributionUncertain` for why a
  // backfilled attribution is NOT among them despite failing `precise`.
  const uncertain = isAttributionUncertain(attribution);
  const how = sourceLabel(attribution.source);

  if (variant === "inline") {
    return (
      <Pressable
        onPress={() =>
          ActionSheet.showActionSheetWithOptions(
            {
              title: t("agents.activity.attribution.onBehalfOf", { name }),
              options: [t("common.cancel")],
              cancelButtonIndex: 0,
            },
            () => {},
          )
        }
        accessibilityRole="button"
        accessibilityLabel={`${name} · ${how}`}
        hitSlop={6}
        className={cn("min-w-0 shrink active:opacity-70", className)}
      >
        <Text numberOfLines={1} className="text-caption">
          <Text className={uncertain ? "text-warning" : "text-foreground"}>
            {name}
          </Text>
          <Text className="text-muted-foreground/70">{" · "}</Text>
          <Text className={uncertain ? "text-warning" : "text-muted-foreground"}>
            {how}
          </Text>
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() =>
        ActionSheet.showActionSheetWithOptions(
          {
            title: `${t("agents.activity.attribution.onBehalfOf", { name })}\n${how}`,
            options: [t("common.cancel")],
            cancelButtonIndex: 0,
          },
          () => {},
        )
      }
      accessibilityRole="button"
      accessibilityLabel={`${name} · ${how}`}
      hitSlop={6}
      className={cn(
        // The ring flags a fallback guess so an owner-fallback face never
        // silently reads as a confidently resolved responsible member.
        "shrink-0 rounded-full active:opacity-70",
        uncertain && "border",
        className,
      )}
      style={uncertain ? { borderColor: theme.warning } : undefined}
    >
      <ActorAvatar type="member" id={attribution.initiator?.id} size={16} />
    </Pressable>
  );
}
