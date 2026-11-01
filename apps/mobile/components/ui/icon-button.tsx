/**
 * Icon-only button — RNR `<Button variant="ghost" size="icon">` wrapping an
 * Ionicon. The icon color falls back to the active navigation theme's
 * foreground (via `useTheme()`), so dark mode flips automatically without
 * anyone passing a color prop.
 *
 * Use everywhere we'd otherwise hand-write
 *   <Pressable className="size-9 active:bg-secondary"><Ionicons color="#3f3f46" /></Pressable>
 * — that pattern hardcodes a light-mode hex and reinvents button chrome RNR
 * already ships.
 */
import { type ComponentProps } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@react-navigation/native";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  HEADER_ACTION_SIZE,
  HEADER_TOUCH_TARGET,
} from "@/lib/header-title-budget";

/**
 * `hitSlop` needed to grow the 32dp visual box back to the 44dp accessible
 * tappable size without overlapping the neighbouring button (half the
 * difference, so the padding is shared).
 */
const HEADER_ICON_HIT_SLOP = Math.round(
  (HEADER_TOUCH_TARGET - HEADER_ACTION_SIZE) / 2,
);

interface Props extends Omit<ButtonProps, "children" | "size"> {
  name: ComponentProps<typeof Ionicons>["name"];
  /** Glyph size in points. Default 20 matches iOS toolbar icons. */
  iconSize?: number;
  /** Override the icon color. Defaults to NAV_THEME[scheme].text. */
  color?: string;
  /**
   * Toolbar variant: a 32dp visual box that still taps at 44dp.
   *
   * Opt-in rather than the default on purpose. This component is also used in
   * sheet headers and row menus, where the 40dp box is fine and a narrower one
   * would only hurt reach. The native Stack toolbar is the surface where the
   * width is contested — React Navigation sizes the title LAST, so the trailing
   * actions decide whether the title survives (MYS-2534). Callers in
   * `Stack.Screen`'s `headerRight` pass this.
   */
  toolbar?: boolean;
}

export function IconButton({
  name,
  iconSize = 20,
  color,
  className,
  toolbar = false,
  hitSlop,
  ...buttonProps
}: Props) {
  const { colors } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(toolbar && "h-header-icon w-header-icon", className)}
      hitSlop={toolbar ? HEADER_ICON_HIT_SLOP : hitSlop}
      {...buttonProps}
    >
      <Ionicons name={name} size={iconSize} color={color ?? colors.text} />
    </Button>
  );
}
