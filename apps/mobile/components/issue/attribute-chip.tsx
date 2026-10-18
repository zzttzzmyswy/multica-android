/**
 * Generic attribute chip used in the issue-detail header. Each chip pairs
 * an icon node (any RN element — StatusIcon, PriorityIcon, ActorAvatar,
 * emoji, etc) with a textual label. Filled = the property has a value;
 * dimmed = empty placeholder ("Label", "Cycle", ...).
 *
 * The chip becomes a Pressable when `onPress` is provided. Without onPress
 * it renders as a plain View — used for read-only chips (e.g. project
 * chip while picker is deferred).
 */
import { Pressable, View } from "react-native";
import type { ReactNode } from "react";
import { Text } from "@/components/ui/text";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Props {
  icon: ReactNode;
  /** The chip's text. `null` means "this value exists but may not be stated
   *  yet" — an actor whose directory has not answered (MYS-2219). The chip
   *  keeps its icon, its shape and its tap target, and draws a load mark where
   *  the text would be instead of asserting a fallback name. */
  label: string | null;
  variant?: "filled" | "dimmed";
  onPress?: () => void;
  className?: string;
  /** Optional a11y label override — e.g. the quick-create actor chip
   *  announces "choose agent" instead of the current agent's name. */
  accessibilityLabel?: string;
}

export function AttributeChip({
  icon,
  label,
  variant = "filled",
  onPress,
  className,
  accessibilityLabel,
}: Props) {
  const containerClass = cn(
    "flex-row items-center gap-1.5 rounded-full border px-2.5 py-1",
    variant === "filled"
      ? "border-border bg-secondary/60"
      : "border-dashed border-muted-foreground/30 bg-transparent",
    className,
  );
  const labelClass = cn(
    "text-caption",
    variant === "filled"
      ? "text-foreground"
      : "text-muted-foreground/70",
  );

  const inner = (
    <>
      {icon}
      {label === null ? (
        // A chip whose value is not yet known: the mark occupies the label's
        // line so the row does not reflow when the directory lands, and it is
        // hidden from the accessibility tree (a load state is not a value).
        <Skeleton
          className="h-2.5 w-10"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : (
        <Text className={labelClass} numberOfLines={1}>
          {label}
        </Text>
      )}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        className={cn(containerClass, "active:bg-secondary")}
        hitSlop={4}
      >
        {inner}
      </Pressable>
    );
  }
  return <View className={containerClass}>{inner}</View>;
}
