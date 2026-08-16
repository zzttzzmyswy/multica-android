/**
 * New-skill route. Renders the shared create form — name (required) +
 * optional description. SUBMIT POSTs /api/skills and pops back to the list,
 * which refreshes on the create invalidate. The native header title comes
 * from the workspace Stack registration (more/skills/new).
 */
import { KeyboardAvoidingView, ScrollView } from "react-native";
import { SkillForm } from "@/components/skill/skill-form";
import { keyboardBehavior } from "@/lib/keyboard";

export default function NewSkillPage() {
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={keyboardBehavior}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-10"
        keyboardShouldPersistTaps="handled"
      >
        <SkillForm />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}