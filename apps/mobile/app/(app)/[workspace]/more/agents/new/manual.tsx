/**
 * Manual agent-create route — one vertical scrolling form (mirrors
 * more/autopilots/new.tsx layout). Header title comes from the workspace
 * Stack registration (more/agents/new/manual).
 */
import { KeyboardAvoidingView, ScrollView } from "react-native";
import { ManualAgentForm } from "@/components/agent/manual-agent-form";
import { keyboardBehavior } from "@/lib/keyboard";

export default function NewManualAgentPage() {
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
        <ManualAgentForm />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}