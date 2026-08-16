/**
 * New-property route. Renders the shared create/edit form in create mode —
 * the save button flips to "Create" copy per the form's own Stack.Screen
 * options. SUBMIT POSTs /api/properties and pops back to the list, which
 * refreshes on the create invalidate.
 */
import { PropertyForm } from "@/components/property/property-form";

export default function NewPropertyPage() {
  return <PropertyForm />;
}