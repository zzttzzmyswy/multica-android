/**
 * Settings → Appearance → Text size and line spacing (MYS-2931).
 *
 * Web renders these inside one long `AppearanceTab` (1309 lines, 20+ rows).
 * Mobile's settings is a list of push screens, not tabs — the same choice
 * iteration 294 made for Workflows — so the two type controls live here and
 * the Appearance section on the parent screen gets one row that opens this.
 *
 * What is deliberately NOT here, and why (the issue requires the reasoning to
 * be written down rather than the gap silently left):
 *
 *   - **Theme gallery / custom theme import-export.** Web's themes are CSS
 *     variable sets injected into the document. React Native has no CSS
 *     cascade and no `:root`, so a ported theme would need a native
 *     translation layer per token. Shipping the UI without that layer would
 *     produce a gallery of themes that do nothing.
 *   - **Latin / CJK font families.** Web ships Inter, Source Serif, Geist and
 *     per-locale CJK stacks as webfonts. Mobile bundles none of them, so a
 *     picker would offer families the device does not have and every choice
 *     would render as the system face.
 *   - **Code font / ligatures.** Same: no bundled mono faces.
 *   - **Density.** RN has no density token; row height is layout, so a ported
 *     control would move nothing.
 *
 * Four have a real mobile meaning and are here: size (glyphs are small on a
 * phone and the reader cannot lean in), line spacing (CJK prose at 1.71
 * leading reads tight on a narrow column), **reduce motion** and **high
 * contrast** (MYS-2950).
 *
 * The last two were refused by iteration 296 under the same heading as the
 * theme gallery — "motion is already governed by the OS setting". That was
 * wrong in a way worth recording, because it is the difference between a
 * courtesy and an accommodation: the OS setting is the *floor*, not the whole
 * answer. Web ANDs its own switch with the system preference
 * (`store.reduceMotion || systemReducedMotion()`) precisely so a person can
 * ask for less motion on a phone that has not been configured globally, and
 * so a phone-level choice is never silently overridden by an app toggle. Both
 * directions are implemented here, plus the third state neither the switch nor
 * the OS could express on its own — "the system is holding this down, so this
 * control cannot turn it off" — which is what stops the row from reading
 * "off" while nothing animates.
 *
 * All four are device-scoped and apply at once — the screen is its own
 * preview, which is how web's page works too ("Every change applies at once,
 * so the page itself is the preview").
 */
import { Pressable, ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTranslation } from "@/lib/i18n/react";
import {
  CONTENT_LEADINGS,
  DEFAULT_FONT_SIZE,
  FOLLOW_SYSTEM,
  FONT_SIZES,
  type ContentLeading,
  type FontSizeChoice,
} from "@/lib/type-appearance";
import { useTypeAppearanceStore } from "@/data/stores/type-appearance-store";
import { useAppearanceA11yStore } from "@/data/stores/appearance-a11y-store";
import { useAppearanceA11y, useReducedMotionRow, useSystemHighContrast, useSystemReduceMotion, useThemePalette } from "@/lib/appearance-a11y-runtime";

/**
 * The rungs as the segmented control sees them.
 *
 * Only real sizes: "follow system" is its own switch above, because it is a
 * different KIND of state (no override) rather than one more value. Keeping it
 * out of this list is also what lets the control's value be a plain number, so
 * the mapping back goes through the sanitizer instead of `Number("system")`.
 */
const SIZE_VALUES: { value: string; choice: FontSizeChoice }[] = FONT_SIZES.map(
  (size) => ({ value: String(size), choice: size }),
);

export default function TextAppearanceScreen() {
  const theme = useThemePalette();
  const { t } = useTranslation();
  const fontSize = useTypeAppearanceStore((s) => s.fontSize);
  const contentLeading = useTypeAppearanceStore((s) => s.contentLeading);
  const setFontSize = useTypeAppearanceStore((s) => s.setFontSize);
  const setContentLeading = useTypeAppearanceStore((s) => s.setContentLeading);
  const reset = useTypeAppearanceStore((s) => s.reset);
  const followSystem = fontSize === FOLLOW_SYSTEM;

  // Reduce motion / high contrast (MYS-2950). The row state comes from the
  // pure rules, not from the store directly, so "the system is on" renders as
  // checked-and-locked rather than as whatever the app switch happens to say.
  const motionRow = useReducedMotionRow();
  const systemReduceMotion = useSystemReduceMotion();
  const setReduceMotion = useAppearanceA11yStore((s) => s.setReduceMotion);
  const setHighContrast = useAppearanceA11yStore((s) => s.setHighContrast);
  const resetA11y = useAppearanceA11yStore((s) => s.reset);
  const userHighContrast = useAppearanceA11yStore((s) => s.highContrast);
  const systemHighContrast = useSystemHighContrast();
  // Same union as motion: an OS-level contrast setting is not overridable by
  // an app switch that is merely off.
  const highContrastChecked = userHighContrast || systemHighContrast === true;
  const highContrastLocked = systemHighContrast === true;
  // The palette the preview below paints with, so turning the switch on shows
  // its effect immediately on the sample text rather than after a navigation.
  const { theme: liveTheme } = useAppearanceA11y();

  const sizeLabel = (size: FontSizeChoice): string =>
    size === FOLLOW_SYSTEM
      ? t("settings.appearance.fontSizeSystem")
      : t("settings.appearance.fontSizeValue", { size });

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-4 pb-8 pt-4"
    >
      <Stack.Screen options={{ title: t("settings.appearance.typeTitle") }} />

      {/* The preview sits ABOVE the controls so the effect of a tap is visible
          without scrolling — on a phone the control and the thing it changes
          cannot both fit otherwise. The sample is the app's own body text
          rather than lorem ipsum: a reader judges the size against the text
          they actually read. */}
      <View
        className="gap-2 rounded-2xl border border-border bg-surface-1 px-4 py-4"
        // The inline muted colour is what the high-contrast switch changes, so
        // the sample below it has to read from the same palette or the switch
        // would only take effect after leaving this screen.
        style={{ borderColor: liveTheme.border }}
      >
        <Text className="text-body text-foreground">
          {t("settings.appearance.typeSample")}
        </Text>
        <Text
          className="text-label text-muted-foreground"
          style={{ color: liveTheme.mutedForeground }}
        >
          {t("settings.appearance.typeSampleMeta", {
            size: fontSize === FOLLOW_SYSTEM ? t("settings.appearance.fontSizeSystemShort") : fontSize,
          })}
        </Text>
      </View>

      <Section
        title={t("settings.appearance.fontSizeTitle")}
        description={t("settings.appearance.fontSizeDescription")}
      >
        <View className="px-4 py-3.5 gap-3">
          {/* "Follow system" is a SWITCH, not a sixth segment. Six options in a
              flex-1 row on a 360dp screen leaves ~55dp each — "跟随系统" would
              be clipped to an ellipsis — and more importantly the two states
              are not siblings: one is "no override", the other is a value. A
              switch says that; a segment labelled the same as its neighbours
              makes "system" look like a size called system. */}
          <Pressable
            onPress={() => setFontSize(followSystem ? 14 : FOLLOW_SYSTEM)}
            accessibilityRole="switch"
            accessibilityState={{ checked: followSystem }}
            accessibilityLabel={t("settings.appearance.fontSizeSystem")}
            className="flex-row items-center justify-between gap-3"
          >
            <View className="flex-1">
              <Text className="text-title-sm text-foreground">
                {t("settings.appearance.fontSizeSystem")}
              </Text>
              <Text className="text-caption text-muted-foreground mt-0.5">
                {t("settings.appearance.fontSizeSystemHint")}
              </Text>
            </View>
            <View
              className={cn(
                "w-11 h-6 rounded-full justify-center px-0.5",
                followSystem ? "bg-brand items-end" : "bg-muted items-start",
              )}
            >
              <View className="size-5 rounded-full bg-background" />
            </View>
          </Pressable>
          <Separator />
          {/* Disabled while following the device: the rungs are still shown so
              a reader can see what the ladder offers before committing, but an
              inert control must not look tappable. */}
          <View className={cn(followSystem && "opacity-40")} pointerEvents={followSystem ? "none" : "auto"}>
            <SegmentedControl
              options={SIZE_VALUES.map((entry) => ({
                value: entry.value,
                label: String(entry.choice),
                a11yLabel: t("settings.appearance.fontSizeValue", {
                  size: entry.choice,
                }),
              }))}
              value={followSystem ? "" : String(fontSize)}
              onChange={(next) =>
                setFontSize(
                  SIZE_VALUES.find((entry) => entry.value === next)?.choice ??
                    DEFAULT_FONT_SIZE,
                )
              }
            />
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-caption text-muted-foreground">A</Text>
            <Text className="text-caption tabular-nums text-muted-foreground">
              {sizeLabel(fontSize)}
            </Text>
            <Text className="text-title-sm text-muted-foreground">A</Text>
          </View>
        </View>
      </Section>

      <Section
        title={t("settings.appearance.contentLeadingTitle")}
        description={t("settings.appearance.contentLeadingDescription")}
      >
        <View className="px-4 py-3.5">
          <SegmentedControl
            options={CONTENT_LEADINGS.map((id) => ({
              value: id,
              label: t(`settings.appearance.leading.${id}`),
              a11yLabel: t(`settings.appearance.leading.${id}`),
            }))}
            value={contentLeading}
            onChange={(next) => setContentLeading(next as ContentLeading)}
          />
        </View>
      </Section>

      {/* ── Reduce motion (MYS-2950) ───────────────────────────────────────
          Three states, not two. `motionRow.checked` is the UNION of the switch
          and the phone's setting, and `locked` means the phone is holding it
          on — so the row shows "已由系统开启" instead of a switch that reads
          off while nothing animates. A switch that lies about its effect is
          worse than no switch: the person taps it twice, sees nothing change,
          and stops trusting the screen. */}
      <Section
        title={t("settings.appearance.motionTitle")}
        description={t("settings.appearance.motionDescription")}
      >
        <ToggleRow
          checked={motionRow.checked}
          locked={motionRow.locked}
          onPress={() => setReduceMotion(!motionRow.checked)}
          title={t("settings.appearance.motionTitle")}
          stateLabel={
            motionRow.source === "system"
              ? t("settings.appearance.motionSystemOn")
              : motionRow.checked
                ? t("settings.appearance.motionOn")
                : t("settings.appearance.motionOff")
          }
          hint={
            systemReduceMotion
              ? t("settings.appearance.motionSystemHint")
              : undefined
          }
        />
      </Section>

      {/* ── High contrast (MYS-2950) ─────────────────────────────────────── */}
      <Section
        title={t("settings.appearance.contrastTitle")}
        description={t("settings.appearance.contrastDescription")}
      >
        <ToggleRow
          checked={highContrastChecked}
          locked={highContrastLocked}
          onPress={() => setHighContrast(!highContrastChecked)}
          title={t("settings.appearance.contrastTitle")}
          stateLabel={
            highContrastLocked
              ? t("settings.appearance.contrastSystemOn")
              : highContrastChecked
                ? t("settings.appearance.contrastOn")
                : t("settings.appearance.contrastOff")
          }
          hint={
            highContrastLocked
              ? t("settings.appearance.contrastSystemHint")
              : undefined
          }
        />
      </Section>

      <View className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <Separator />
        <ResetRow
          label={t("settings.appearance.typeReset")}
          onPress={reset}
          color={theme.mutedForeground}
        />
        <Separator />
        <ResetRow
          label={t("settings.appearance.a11yReset")}
          onPress={resetA11y}
          color={theme.mutedForeground}
        />
      </View>
    </ScrollView>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="text-caption uppercase tracking-wider text-muted-foreground px-1">
        {title}
      </Text>
      {description ? (
        <Text className="text-body text-muted-foreground px-1">{description}</Text>
      ) : null}
      <View className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        {children}
      </View>
    </View>
  );
}

/**
 * A settings switch row (MYS-2950).
 *
 * Written here rather than reusing `components/ui/switch` because of the third
 * state: a LOCKED row must not look tappable and must say why. The primitive
 * has no such state, and faking it by leaving the switch interactive while
 * ignoring the tap is exactly the "control that does nothing" defect this
 * iteration exists to remove.
 *
 * The track is drawn with plain Views (the same approach `components/ui/switch`
 * documents) rather than utility classes on an RN primitive: that file records
 * a release build where `bg-*` classes on the switch primitive painted nothing
 * and every switch in the app was invisible. Sizes are numbers for the same
 * reason.
 */
function ToggleRow({
  checked,
  locked,
  onPress,
  title,
  stateLabel,
  hint,
}: {
  checked: boolean;
  locked: boolean;
  onPress: () => void;
  title: string;
  stateLabel: string;
  hint?: string;
}) {
  const { theme } = useAppearanceA11y();
  const trackWidth = 51;
  const trackHeight = 31;
  const thumbSize = 27;
  const inset = 2;
  return (
    <Pressable
      onPress={onPress}
      disabled={locked}
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled: locked }}
      accessibilityLabel={title}
      accessibilityHint={hint}
      className={cn(
        "flex-row items-center justify-between gap-3 px-4 py-3.5",
        !locked && "active:bg-secondary",
      )}
    >
      <View className="flex-1">
        <Text className="text-title-sm text-foreground">{title}</Text>
        <Text className="text-caption text-muted-foreground mt-0.5">
          {stateLabel}
        </Text>
        {hint ? (
          <Text className="text-caption text-muted-foreground mt-1">{hint}</Text>
        ) : null}
      </View>
      <View
        style={{
          width: trackWidth,
          height: trackHeight,
          borderRadius: trackHeight / 2,
          backgroundColor: checked ? theme.primary : theme.input,
          paddingHorizontal: inset,
          justifyContent: "center",
          // A locked row is dimmed rather than hidden: the person still needs
          // to see that the setting is ON, they just cannot be the one to turn
          // it off.
          opacity: locked ? 0.6 : 1,
        }}
      >
        <View
          style={{
            width: thumbSize,
            height: thumbSize,
            borderRadius: thumbSize / 2,
            backgroundColor: theme.background,
            alignSelf: checked ? "flex-end" : "flex-start",
          }}
        />
      </View>
    </Pressable>
  );
}

function ResetRow({
  label,
  onPress,
  color,
}: {
  label: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center justify-center px-4 py-3.5 active:bg-secondary"
    >
      <Text className="text-title-sm text-foreground">{label}</Text>
    </Pressable>
  );
}
