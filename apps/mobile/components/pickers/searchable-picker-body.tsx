/**
 * A search field above a picker body whose filtering is caller-driven.
 *
 * A picker ROUTE owns its own header + search through `usePickerSearch` /
 * `PickerBodyShell` (`components/pickers/picker-body-shell.tsx`). A bottom
 * SHEET has no native header — `headerSearchBarOptions` does not render on
 * Android at all, and these sheets are registered `headerShown: false` — so a
 * sheet-hosted searchable picker has to draw the field inside its body.
 *
 * Extracted from `components/issue/table-cell-editor.tsx` (MYS-1149), where it
 * was local, when the projects list's inline cell editor (MYS-253, MYS-2202)
 * needed the same thing for its lead picker. Two copies of a shell is how the
 * same control comes to look like two different controls (the reason
 * `picker-sheet.tsx` was extracted from `batch-action-bar.tsx` in the first
 * place), so both surfaces share this one.
 *
 * `children` is the picker body, which keeps its own `flex-1` scroll container;
 * pair this with `PickerSheet`'s `fill` mode, since a `flex-1` child of a
 * content-sized parent resolves to zero height.
 */
import { View } from "react-native";
import { SearchField } from "@/components/ui/search-field";

export function SearchablePickerBody({
  query,
  onQueryChange,
  placeholder,
  children,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-1">
      <SearchField
        className="mx-3 mb-1 mt-2"
        value={query}
        onChange={onQueryChange}
        placeholder={placeholder}
      />
      {children}
    </View>
  );
}
