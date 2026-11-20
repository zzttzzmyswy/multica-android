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
import { View } from "react-native";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
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
          <Text accessibilityRole="header" className="text-title font-semibold text-foreground">
            {title}
          </Text>
        </View>
      ) : null}
      {bodyChrome ? (
        <SearchField
          className="mx-4 mb-1 mt-2"
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
