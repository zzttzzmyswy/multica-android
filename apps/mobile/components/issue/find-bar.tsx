/**
 * Floating "find in issue" bar — the mobile counterpart of web's
 * `packages/views/issues/components/find-bar.tsx`.
 *
 * Presentational only: every search decision (what matches, which match is
 * active, where to scroll) lives in `lib/issue-find.ts` and the screen that
 * hosts it. This file is layout + touch.
 *
 * ## Why a floating bar rather than a sheet
 *
 * Web renders its bar floating over the top of the content column, and the
 * reason carries over unchanged: find is a *peek* interaction. The reader
 * types, sees the count, and steps through hits while watching the document
 * move underneath. A modal sheet would cover the very comments the bar is
 * navigating — `thread-nav-sheet.tsx` is the opposite case (picking a thread
 * from a list is a decision made *instead of* reading, so a sheet is right
 * there). Web's own comment on that panel says as much: it "needs a sheet
 * rather than a popover" precisely because it is a chooser, not a find.
 *
 * ## Touch replaces the keyboard
 *
 * Web binds Enter / Shift+Enter / Escape inside the input and relies on
 * `Cmd/Ctrl+F` to open. A phone has none of those, so:
 *
 *   - the entry point is a header button on the issue screen (there is no
 *     hardware Find key to intercept);
 *   - prev / next / close are real buttons, sized to be hit one-handed;
 *   - the input still handles Enter → next, since a soft keyboard shows a
 *     return key and that is the gesture the reader already has.
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import type { FindCounter } from "@/lib/issue-find";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Which counter string to draw, and its numbers. Never `0/0` — see
   *  `findCounter` in `lib/issue-find.ts`. */
  counter: FindCounter;
  /** False when there is nothing to step to, which disables both arrows
   *  rather than letting them no-op invisibly (web does the same). */
  canStep: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function FindBar({
  value,
  onChange,
  counter,
  canStep,
  onPrevious,
  onNext,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  return (
    <View
      // Floats over the timeline so the reader keeps seeing the document it is
      // scrolling. `elevation` is the Android shadow; the iOS shadow props are
      // inert there but keep the two platforms the same shape.
      className="absolute left-3 right-3 top-2 z-30 flex-row items-center gap-1 rounded-xl border border-border bg-popover px-2 py-1.5"
      style={{
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
        elevation: 6,
      }}
    >
      <Ionicons name="search" size={16} color={theme.mutedForeground} />
      <TextField
        value={value}
        onChangeText={onChange}
        placeholder={t("detail.find.placeholder")}
        accessibilityLabel={t("detail.find.placeholder")}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        // Return walks forward, the same gesture web binds to Enter. Shift is
        // not available on a soft keyboard, so "previous" gets its own button
        // instead (web has both).
        onSubmitEditing={onNext}
        // The field's own chrome would double up with the bar's border, so the
        // height / padding / background are stripped back to a bare input.
        className="h-9 flex-1 border-0 bg-transparent px-1"
      />
      {/* Fixed-width counter so the arrows do not shift as the numbers grow
          from 1/9 to 10/9. Blank before a query is typed — web leaves this
          area empty rather than printing 0/0. */}
      <Text className="min-w-[3.5rem] shrink-0 text-right text-caption tabular-nums text-muted-foreground">
        {counter.kind === "count"
          ? t("detail.find.count", {
              current: counter.current,
              total: counter.total,
            })
          : counter.kind === "no_matches"
            ? t("detail.find.no_matches")
            : ""}
      </Text>
      <ArrowButton
        name="chevron-up"
        label={t("detail.find.previous")}
        disabled={!canStep}
        onPress={onPrevious}
        color={theme.foreground}
      />
      <ArrowButton
        name="chevron-down"
        label={t("detail.find.next")}
        disabled={!canStep}
        onPress={onNext}
        color={theme.foreground}
      />
      <ArrowButton
        name="close"
        label={t("detail.find.close")}
        disabled={false}
        onPress={onClose}
        color={theme.foreground}
      />
    </View>
  );
}

/**
 * One 36 pt tap target. Hand-written rather than `<IconButton>` because that
 * wraps RNR's `size="icon"` (40×40) and this bar has to fit an input, a
 * counter and three buttons inside a phone's width.
 *
 * `disabled` dims the glyph and swallows the press — web disables its
 * chevrons on an empty result set for the same reason: an enabled-looking
 * button that does nothing reads as a bug.
 */
function ArrowButton({
  name,
  label,
  disabled,
  onPress,
  color,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  disabled: boolean;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      // hitSlop keeps the target finger-sized without widening the glyph.
      hitSlop={6}
      className="size-9 items-center justify-center rounded-md active:bg-secondary"
    >
      <Ionicons name={name} size={18} color={color} style={{ opacity: disabled ? 0.35 : 1 }} />
    </Pressable>
  );
}
