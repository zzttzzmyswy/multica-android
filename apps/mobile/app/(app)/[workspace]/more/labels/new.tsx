/**
 * New-label route. Renders the shared create/edit form in create mode —
 * the header title and save button flip to "new" copy per the form's own
 * Stack.Screen options. SUBMIT POSTs /api/labels and pops back to the
 * list, which refreshes on the create invalidate.
 */
import { LabelForm } from "@/components/label/label-form";

export default function NewLabelPage() {
  return <LabelForm />;
}