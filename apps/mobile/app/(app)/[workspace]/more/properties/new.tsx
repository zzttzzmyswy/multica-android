/**
 * Property create route (MYS-668). Wires `PropertyForm` into the
 * /more/properties/new push route — the form ships its own header title,
 * keyboard-avoiding shell and Stack.Screen options, mirroring the labels
 * new/[id] convention.
 */
import { PropertyForm } from "@/components/property/property-form";

export default function NewPropertyPage() {
  return <PropertyForm />;
}