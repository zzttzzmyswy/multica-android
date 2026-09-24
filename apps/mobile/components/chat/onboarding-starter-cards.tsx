/**
 * Product-fixed starter cards under Mika's onboarding opening — mobile port of
 * web `packages/views/chat/components/onboarding-starter-cards.tsx`.
 *
 * The opening is the first assistant reply after the hidden `onboarding_kickoff`.
 * Its suggestions are not LLM output: they are three fixed ways to start, sent
 * in the member's name exactly like a quick-action chip. That matters most on a
 * deployment with no LLM configured (`MULTICA_LLM_API_KEY` / `_BASE_URL` empty →
 * `Enabled() = false`): quick-action generation degrades silently to an empty
 * list, so without these cards a new member's very first screen in a session is
 * blank with nothing to tap.
 *
 * The phone shape differs from web's: no hover tooltip to preview the prompt,
 * so the prompt is not hidden — each card shows its title and description, and
 * the tap sends the prompt. Web's vignettes are token-drawn miniatures that
 * rely on a wide three-column grid; at phone width they render as three
 * unreadable slivers, so the cards stack full-width and carry an icon instead.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatQuickAction } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";

/** Card keys are stable ids for keys and a11y labels; the copy lives in the
 *  locale bundles and must match web's `chat.onboarding_cards.*` verbatim
 *  (`zh-cross-bundle.test.ts` holds the two zh bundles to agreement). */
const CARD_KEYS = ["board", "delegate", "digest"] as const;
type CardKey = (typeof CARD_KEYS)[number];

const CARD_ICONS: Record<CardKey, React.ComponentProps<typeof Ionicons>["name"]> = {
  board: "grid-outline",
  delegate: "paper-plane-outline",
  digest: "time-outline",
};

export function OnboardingStarterCards({
  onPick,
  disabled,
}: {
  onPick: (action: ChatQuickAction) => void | Promise<unknown>;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [submitting, setSubmitting] = useState(false);
  const blocked = disabled || submitting;
  const accent =
    colorScheme === "dark" ? THEME.dark.primary : THEME.light.primary;

  const handlePick = async (key: CardKey) => {
    if (blocked) return;
    setSubmitting(true);
    try {
      await onPick({
        label: t(`chat.onboardingCards.${key}.title`),
        prompt: t(`chat.onboardingCards.${key}.prompt`),
      });
    } catch {
      // The send path owns user-facing error feedback and rolls its optimistic
      // message back; re-enable so a transient failure can be retried.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View
      className="gap-2 pt-0.5"
      accessibilityLabel={t("chat.onboardingCards.ariaLabel")}
    >
      {CARD_KEYS.map((key) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityState={{ disabled: blocked }}
          disabled={blocked}
          onPress={() => void handlePick(key)}
          className={
            "rounded-xl border border-border bg-card px-3.5 py-3 active:bg-accent/40" +
            (blocked ? " opacity-55" : "")
          }
        >
          <View className="flex-row items-center gap-2">
            <Ionicons name={CARD_ICONS[key]} size={16} color={accent} />
            <Text className="flex-1 text-sm font-medium text-foreground">
              {t(`chat.onboardingCards.${key}.title`)}
            </Text>
          </View>
          <Text className="mt-1 text-xs leading-4 text-muted-foreground">
            {t(`chat.onboardingCards.${key}.desc`)}
          </Text>
          <View className="mt-2 flex-row items-center gap-1">
            <Text className="text-xs font-medium" style={{ color: accent }}>
              {t("chat.onboardingCards.cta")}
            </Text>
            <Ionicons name="arrow-up-outline" size={12} color={accent} />
            {/* The digest card is the only one with a fixed schedule; web
                shows it as a badge on that card's vignette. */}
            {key === "digest" ? (
              <Text className="ml-auto text-[10px] text-muted-foreground">
                {t("chat.onboardingCards.digestBadge")}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}
