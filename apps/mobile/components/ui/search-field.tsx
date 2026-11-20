import { Pressable, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";
import { useTranslation } from "@/lib/i18n/react";
import { cn } from "@/lib/utils";

export function SearchField({
  value,
  onChange,
  placeholder,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const palette = useThemePalette();
  const { t } = useTranslation();
  return (
    <View className={cn("min-h-12 flex-row items-center gap-2 rounded-xl border border-border bg-surface-1 pl-3", className)}>
      <Ionicons name="search" size={19} color={palette.mutedForeground} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.mutedForeground}
        accessibilityLabel={placeholder}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        className="min-w-0 flex-1 text-title-sm text-foreground"
      />
      {/* Reserve the same space while empty so typing doesn't shift the field. */}
      <View className="size-12 items-center justify-center">
        {value.length ? (
          <Pressable
            onPress={() => onChange("")}
            accessibilityRole="button"
            accessibilityLabel={t("common.clear")}
            className="size-12 items-center justify-center rounded-xl active:bg-secondary"
          >
            <Ionicons name="close-circle" size={19} color={palette.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
