/**
 * Single-line text input. Notes:
 * - `fontSize` is set inline; do NOT use Tailwind `text-*` here. NativeWind
 *   maps those to fontSize+lineHeight, and `lineHeight` on iOS TextInput
 *   clips descenders (RN issues #41240, #28012, #45268, #49886).
 * - Height FLOOR is `min-h-10`, not a fixed `h-10`. A fixed height is measured
 *   in dp, but `fontSize` scales with the system font scale, so at font_scale
 *   1.3 a 36dp box could no longer hold its own single line and sheared the
 *   glyphs top and bottom. `min-h-*` keeps the 1.0x rhythm while letting the
 *   box grow with the text. Callers overriding the height must do the same
 *   (`min-h-9`, never `h-9`).
 * - `includeFontPadding` / `textAlignVertical` are Android-only; iOS no-op,
 *   kept for when Android lands.
 * - Focus state is tracked manually because NativeWind's `focus:` variant
 *   on TextInput is unreliable across SDK upgrades.
 */
import { useState } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { cn } from "@/lib/utils";
import { MOBILE_PLACEHOLDER_COLOR } from "./input-tokens";

export interface TextFieldProps extends TextInputProps {
  className?: string;
  invalid?: boolean;
}

export function TextField({
  className,
  style,
  invalid,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
      style={[
        { fontSize: 14, includeFontPadding: false, textAlignVertical: "center" },
        style,
      ]}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      className={cn(
        "rounded-md px-3 min-h-10 text-foreground border",
        invalid
          ? "bg-destructive/10 border-destructive/60"
          : focused
            ? "bg-secondary border-ring"
            : "bg-secondary/50 border-transparent",
        className,
      )}
      {...rest}
    />
  );
}
