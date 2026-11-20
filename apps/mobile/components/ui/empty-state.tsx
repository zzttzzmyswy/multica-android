import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";
import { cn } from "@/lib/utils";

/** Shared visual treatment; each screen still owns copy, actions, and scroll. */
export function EmptyState({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const theme = useThemePalette();
  return (
    <View className={cn("w-full items-center justify-center px-6 py-6", className)}>
      <View
        className="mb-4 size-14 items-center justify-center rounded-2xl bg-secondary"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Ionicons name={icon} size={25} color={theme.foreground} />
      </View>
      <Text accessibilityRole="header" className="max-w-sm text-center text-title font-semibold text-foreground">
        {title}
      </Text>
      {description ? (
        <Text className="mt-2 max-w-xs text-center text-body text-muted-foreground">
          {description}
        </Text>
      ) : null}
      {children ? (
        <View className="mt-4 w-full max-w-xs items-center gap-3">{children}</View>
      ) : null}
    </View>
  );
}
