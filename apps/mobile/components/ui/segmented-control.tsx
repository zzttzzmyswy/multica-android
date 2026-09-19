/**
 * Two-or-more target segmented control — the phone's stand-in for web's
 * `Tabs` on the surfaces where a full tab bar would out-weigh what sits
 * beside it (a control strip already holding filter / sort chips, or a sheet
 * header). Two users so far: the projects list's view toggle
 * (`project/projects-screen.tsx`) and the add-resource sheet's kind chooser.
 *
 * Generic over the value type so the caller's union survives — the projects
 * toggle hands back a `ProjectViewMode`, the resource sheet a resource type,
 * with no cast at either call site.
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  /** Visible label — short enough to sit in a strip. */
  label: string;
  /** Longer form for screen readers and UI-dump anchoring. Falls back to
   *  `label` when omitted. */
  a11yLabel?: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View
      className={cn(
        "flex-row rounded-md border border-border bg-secondary/50 p-0.5",
        className,
      )}
      accessibilityRole="tablist"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.a11yLabel ?? option.label}
            className={cn(
              "flex-1 flex-row items-center justify-center gap-1 rounded px-2.5 py-1 active:opacity-70",
              active ? "bg-background" : "bg-transparent",
            )}
          >
            {option.icon ? (
              <Ionicons
                name={option.icon}
                size={13}
                color={active ? theme.brand : theme.mutedForeground}
              />
            ) : null}
            <Text
              className={cn(
                "text-xs",
                active ? "text-foreground font-medium" : "text-muted-foreground",
              )}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
