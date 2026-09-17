/**
 * Custom-property value editor route for an existing issue (MYS-334) —
 * presented as a formSheet by the parent Stack. The editor itself lives in
 * `components/issue/pickers/property-value-editor.tsx` so the issue table's
 * inline cell editor can host the same UI (MYS-1149); this route only binds
 * it to the route params and back-navigation.
 */
import { useLocalSearchParams, router } from "expo-router";
import { PropertyValueEditor } from "@/components/issue/pickers/property-value-editor";

export default function IssuePropertyValueRoute() {
  const { id, propertyId } = useLocalSearchParams<{
    id: string;
    propertyId: string;
  }>();

  return (
    <PropertyValueEditor
      issueId={id}
      propertyId={propertyId}
      onClose={() => router.back()}
    />
  );
}
