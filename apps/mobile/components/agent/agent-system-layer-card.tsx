/**
 * Read-only card for the product half of a system agent's prompt.
 *
 * One component, two hosts: the edit form's instruction field and the agent
 * detail screen. Both answer the same question — "what was this agent actually
 * told to do?" — and both need the same answer, so the card, its collapse
 * state and its copy live here rather than being written twice with two
 * chances to drift.
 *
 * Mobile shape vs web (`packages/views/agents/components/tabs/instructions-tab.tsx:56-84`):
 * web puts the label, hint and Show/Hide button on ONE flex row and unfolds a
 * pre-formatted block beneath. A phone cannot fit a label, a two-line hint and
 * a button on one row at a readable size, so the rows stack and the whole
 * header becomes the trigger (chevron-first, the same expand discipline
 * `transcript-entry.tsx` uses). The body is a `ScrollView` capped at 260px
 * instead of web's `max-h-80`: the 3.5 KB prompt is far taller than the screen,
 * and an uncapped block would push the editable field the author came for out
 * of reach.
 *
 * Read-only by construction: the body is `<Text>`, never an input, and the
 * component takes no `value`/`onChange` pair — there is no prop through which a
 * caller could wire this text back into a draft or an update request.
 */
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function AgentSystemLayerCard({ instructions }: { instructions: string }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [open, setOpen] = useState(false);

  return (
    <View className="overflow-hidden rounded-md border border-border bg-secondary/30">
      <Pressable
        onPress={() => setOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${t("agents.systemLayer.label")} ${
          open ? t("agents.systemLayer.hide") : t("agents.systemLayer.show")
        }`}
        className="flex-row items-start gap-2 px-3 py-2.5 active:opacity-70"
      >
        <Ionicons
          name={open ? "chevron-down" : "chevron-forward"}
          size={14}
          color={theme.mutedForeground}
          style={{ marginTop: 2 }}
        />
        <View className="flex-1 min-w-0 gap-0.5">
          <Text className="text-body font-medium text-foreground">
            {t("agents.systemLayer.label")}
          </Text>
          <Text className="text-micro leading-snug text-muted-foreground">
            {t("agents.systemLayer.hint")}
          </Text>
        </View>
        <Text className="text-caption font-medium text-brand">
          {open ? t("agents.systemLayer.hide") : t("agents.systemLayer.show")}
        </Text>
      </Pressable>
      {open ? (
        <ScrollView
          className="max-h-[260px] border-t border-border"
          contentContainerClassName="px-3 py-2.5"
          nestedScrollEnabled
        >
          <Text className="text-caption leading-5 text-muted-foreground">
            {instructions}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}
