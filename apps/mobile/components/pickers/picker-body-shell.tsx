/**
 * Body-rendered chrome for a picker route: an optional title and an optional
 * search field above the list.
 *
 * Both exist because a `formSheet` route on Android shows neither. These
 * sheets are registered with `headerShown: false` (`SHEET_OPTIONS` in
 * `app/(app)/[workspace]/_layout.tsx`), so nothing draws a title on Android,
 * and `headerSearchBarOptions` is not rendered there at all — a picker that
 * relies on the native header for its search box is unfilterable on Android.
 *
 * `children` is the scrollable picker body; it stays `flex-1` so the list
 * keeps its own scroll behaviour and keyboard handling.
 */
import { Pressable, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import type { PickerSearch } from "@/lib/use-picker-search";

export function PickerBodyShell({
  search,
  title,
  children,
}: {
  /** From `usePickerSearch`. Decides whether the body draws its own chrome. */
  search: PickerSearch;
  /** Sheet title. Omit on routes that already draw their own. */
  title?: string;
  children: React.ReactNode;
}) {
  // In native mode the iOS nav header draws both the title and the search
  // bar, so the body must add neither — the title would double.
  const bodyChrome = search.mode === "body";

  return (
    <View className="flex-1">
      {bodyChrome && title ? (
        <View className="px-4 pt-3 pb-1">
          <Text className="text-base font-semibold text-foreground">
            {title}
          </Text>
        </View>
      ) : null}
      {bodyChrome ? (
        <SearchField
          value={search.query}
          onChange={search.onQueryChange}
          placeholder={search.placeholder}
          autoFocus={search.autoFocus}
        />
      ) : null}
      {children}
    </View>
  );
}

/** Same chrome as the filter sheets' search row, with an explicit clear
 *  button: RN's `clearButtonMode` is iOS-only, so an Android user would
 *  otherwise have no way to clear the filter but deleting characters. */
function SearchField({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  return (
    <View className="px-4 pt-2 pb-1">
      <View className="flex-row items-center gap-2 rounded-xl px-3 py-2 border border-border bg-secondary/40">
        <Ionicons name="search" size={16} color={muted} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={muted}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={placeholder}
          className="flex-1 text-sm text-foreground py-0"
        />
        {value ? (
          <Pressable
            onPress={() => onChange("")}
            hitSlop={8}
            accessibilityLabel={placeholder}
          >
            <Ionicons name="close-circle" size={16} color={muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
