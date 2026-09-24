/**
 * Create-method chooser — the landing step of the create flow, mirroring
 * web's `MethodChooser` (packages/views/skills/components/
 * create-skill-dialog.tsx:60-102).
 *
 * Web renders this inside a dialog header; mobile renders it as the body of
 * the `more/skills/new` route, because a phone has no room for a chooser plus
 * a form and the Stack header already carries "New skill". Choosing a card
 * swaps the route body to that method's form (see `SkillForm`).
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import type { SkillCreateMethod } from "@/lib/skill-import";

type ChooserMethod = Exclude<SkillCreateMethod, "chooser">;

const METHODS: {
  value: ChooserMethod;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  titleKey: string;
  descKey: string;
}[] = [
  {
    value: "manual",
    icon: "create-outline",
    titleKey: "skills.create.method.manualTitle",
    descKey: "skills.create.method.manualDesc",
  },
  {
    value: "url",
    icon: "download-outline",
    titleKey: "skills.create.method.urlTitle",
    descKey: "skills.create.method.urlDesc",
  },
  {
    value: "runtime",
    icon: "hardware-chip-outline",
    titleKey: "skills.create.method.runtimeTitle",
    descKey: "skills.create.method.runtimeDesc",
  },
];

export function SkillMethodChooser({
  onChoose,
}: {
  onChoose: (method: ChooserMethod) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  return (
    <View className="px-4 pt-4 gap-2">
      {METHODS.map(({ value, icon, titleKey, descKey }) => (
        <Pressable
          key={value}
          accessibilityRole="button"
          onPress={() => onChoose(value)}
          className="flex-row items-start gap-3 rounded-lg border border-border bg-card p-4 active:bg-secondary/60"
        >
          <View className="h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
            <Ionicons name={icon} size={16} color={theme.mutedForeground} />
          </View>
          <View className="flex-1 min-w-0 gap-0.5">
            <Text className="text-sm font-medium text-foreground">
              {t(titleKey)}
            </Text>
            <Text className="text-xs text-muted-foreground leading-4">
              {t(descKey)}
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={theme.mutedForeground}
          />
        </Pressable>
      ))}
    </View>
  );
}
