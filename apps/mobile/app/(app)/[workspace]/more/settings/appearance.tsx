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
 *   - **Density and reduced motion.** RN has no density token, and motion is
 *     already governed by the OS setting.
 *
 * The two that DO have a real mobile meaning are here: size (glyphs are
 * small on a phone and the reader cannot lean in) and line spacing (CJK
 * prose at 1.71 leading reads tight on a narrow column).
 *
 * Both are device-scoped and apply at once — the screen is its own preview,
 * which is how web's page works too ("Every change applies at once, so the
 * page itself is the preview").
 */
import { Pressable, ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
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
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { t } = useTranslation();
  const fontSize = useTypeAppearanceStore((s) => s.fontSize);
  const contentLeading = useTypeAppearanceStore((s) => s.contentLeading);
  const setFontSize = useTypeAppearanceStore((s) => s.setFontSize);
  const setContentLeading = useTypeAppearanceStore((s) => s.setContentLeading);
  const reset = useTypeAppearanceStore((s) => s.reset);
  const followSystem = fontSize === FOLLOW_SYSTEM;

  const sizeLabel = (size: FontSizeChoice): string =>
    size === FOLLOW_SYSTEM
      ? t("settings.appearance.fontSizeSystem")
      : t("settings.appearance.fontSizeValue", { size });

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-6"
    >
      <Stack.Screen options={{ title: t("settings.appearance.typeTitle") }} />

      {/* The preview sits ABOVE the controls so the effect of a tap is visible
          without scrolling — on a phone the control and the thing it changes
          cannot both fit otherwise. The sample is the app's own body text
          rather than lorem ipsum: a reader judges the size against the text
          they actually read. */}
      <View className="rounded-md border border-border bg-card px-4 py-3 gap-1.5">
        <Text className="text-body text-foreground">
          {t("settings.appearance.typeSample")}
        </Text>
        <Text className="text-label text-muted-foreground">
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

      <View className="rounded-md border border-border bg-card overflow-hidden">
        <Separator />
        <ResetRow
          label={t("settings.appearance.typeReset")}
          onPress={reset}
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
      <View className="rounded-md border border-border bg-card overflow-hidden">
        {children}
      </View>
    </View>
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
