/**
 * The create form's "add property" sheet (iteration 259, MYS-2245) — the list of
 * workspace properties that still have no value on the draft.
 *
 * Web puts this list in the ⋯ overflow menu as a `custom_properties` group
 * (`packages/views/modals/create-issue.tsx:1159-1180`). Mobile's toolbar
 * overflow is an ActionSheet of standard fields, and a workspace's property set
 * is unbounded, so the group gets its own sheet instead of a menu that grows
 * with the workspace.
 *
 * Properties that ALREADY have a value are excluded: they are drawn as chips on
 * the row behind this sheet, and listing them here would offer a second entry
 * point to the same editor with no visible difference.
 */
import { View } from "react-native";
import { NewIssuePropertyPickerBody } from "@/components/issue/create-form-property-row";
import { PropertyCatalogStatus } from "@/components/property/property-catalog-status";
import { useActivePropertyCatalog } from "@/data/queries/properties";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function NewIssuePropertiesRoute() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const catalog = useActivePropertyCatalog(wsId);

  if (!catalog.isResolved) {
    return (
      <View className="flex-1 justify-center bg-background">
        <PropertyCatalogStatus
          state={catalog.state}
          onRetry={catalog.retry}
          layout="centered"
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background px-4 pt-3">
      <NewIssuePropertyPickerBody />
    </View>
  );
}
