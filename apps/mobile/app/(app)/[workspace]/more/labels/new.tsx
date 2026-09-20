/**
 * New-label route. Renders the shared create/edit form in create mode —
 * the header title and save button flip to "new" copy per the form's own
 * Stack.Screen options. The `scope` search param carries the catalog the list
 * was showing (issue / skill) so the created label is filed there; an absent
 * or unknown value falls back to issue, the server's own default. SUBMIT POSTs
 * /api/labels and pops back to the list, which refreshes on the create
 * invalidate.
 */
import { useLocalSearchParams } from "expo-router";
import { LabelForm } from "@/components/label/label-form";
import { LABEL_SCOPES, type LabelScope } from "@/lib/labels-display";

function parseScope(raw: string | string[] | undefined): LabelScope {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return LABEL_SCOPES.find((scope) => scope === value) ?? "issue";
}

export default function NewLabelPage() {
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  return <LabelForm resourceType={parseScope(scope)} />;
}
