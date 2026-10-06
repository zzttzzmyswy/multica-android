/**
 * Where a picker route's search input lives, and the one hook that wires it.
 *
 * Two mechanisms exist in this app, and only one of them works everywhere:
 *
 *   - `"native"` — an iOS `UISearchController` registered through
 *     `headerSearchBarOptions` on the route's Stack.Screen. It needs iOS
 *     *and* a visible nav header. Expo does not render
 *     `headerSearchBarOptions` on Android at all (the note in
 *     `components/issue/pickers/filter-picker-bodies.tsx` records this), and
 *     react-native-screens returns early from its header-config builder when
 *     the header is hidden (`RNSScreenStackHeaderConfig.mm`, the
 *     `shouldHide` branch), so a header-less sheet never mounts the
 *     controller on either platform.
 *   - `"body"` — a field rendered inside the body by `PickerSearchField`.
 *     Works on both platforms and needs no header.
 *
 * `usePickerSearch` derives the mode from the two facts that decide it —
 * platform and whether the route keeps its nav header — so a picker cannot
 * end up with a `query` prop that nothing can write to. That mismatch is
 * exactly what shipped before: ten routes took a query from the native bar,
 * Android rendered no bar, and every list was silently unfilterable.
 *
 * `PickerBodyShell` renders the body field for exactly the routes this hook
 * puts in `"body"` mode; the route passes `search` straight through.
 */
import { useLayoutEffect, useState } from "react";
import { Platform } from "react-native";
import { useNavigation } from "expo-router";
import type { NativeSyntheticEvent, TextInputFocusEventData } from "react-native";

export type PickerSearchMode = "native" | "body";

export interface PickerSearch {
  /** Drives `PickerBodyShell`. */
  mode: PickerSearchMode;
  /** Filter text. Always the value the body should filter on. */
  query: string;
  onQueryChange: (query: string) => void;
  /** Body-mode placeholder. Native mode reads the native bar's instead. */
  placeholder: string;
  autoFocus?: boolean;
}

/**
 * @param placeholder Body-mode placeholder (native mode has its own).
 * @param options.nativeHeader Whether this route's sheet keeps the nav header
 *   on iOS — the same fact `app/(app)/[workspace]/_layout.tsx` encodes as
 *   `headerShown: true`. Omit (or `false`) for the `SHEET_OPTIONS` default,
 *   where the native bar could never mount.
 */
export function usePickerSearch(
  placeholder: string,
  options?: { autoFocus?: boolean; nativeHeader?: boolean },
): PickerSearch {
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const autoFocus = options?.autoFocus;
  const nativeHeader = options?.nativeHeader ?? false;
  const mode: PickerSearchMode =
    Platform.OS === "ios" && nativeHeader ? "native" : "body";

  useLayoutEffect(() => {
    if (mode !== "native") return;
    navigation.setOptions({
      headerSearchBarOptions: {
        placeholder,
        autoCapitalize: "none",
        hideWhenScrolling: false,
        // Opt-in: pickers whose primary action is typing (assignee, label,
        // project, lead) set this so the keyboard appears on mount. Apple
        // HIG cautions against auto-keyboard for browse-first lists; pass
        // `autoFocus: true` only when the picker is search-first.
        autoFocus,
        onChangeText: (e: NativeSyntheticEvent<TextInputFocusEventData>) =>
          setQuery(e.nativeEvent.text),
        // Cancel clears the native text but does NOT fire `onChangeText`, so
        // the reset has to happen here or the list stays filtered.
        onCancelButtonPress: () => setQuery(""),
      },
    });
  }, [navigation, placeholder, autoFocus, mode]);

  return { mode, query, onQueryChange: setQuery, placeholder, autoFocus };
}
