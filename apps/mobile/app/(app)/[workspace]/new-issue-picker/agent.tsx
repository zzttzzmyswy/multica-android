/**
 * Agent/squad picker route for the agent-mode quick-create draft. Reuses
 * `AssigneePickerBody` (members + agents + squads single-select) filtered
 * to agents + squads only — the actor that will process the natural-
 * language prompt. Reads/writes `agentActor` on the same draft store so
 * the quick-create panel rehydrates when this formSheet dismisses.
 */
import { router } from "expo-router";
import { AssigneePickerBody } from "@/components/issue/pickers/assignee-picker-body";
import type { ActorKind } from "@/components/issue/pickers/assignee-picker-body";
import type { AgentActorValue } from "@/data/stores/new-issue-draft-store";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useNativeSearchBar } from "@/lib/use-native-search-bar";
import { useTranslation } from "@/lib/i18n/react";

/** Stable filter array — module-level so AssigneePickerBody's `rows`
 *  useMemo keeps its `kinds` dep identity predictable across renders. */
const AGENT_KINDS: ActorKind[] = ["agent", "squad"];

export default function NewIssueAgentPickerRoute() {
  const { t } = useTranslation();
  const actor = useNewIssueDraftStore((s) => s.agentActor);
  const setActor = useNewIssueDraftStore((s) => s.setAgentActor);
  const query = useNativeSearchBar(t("picker.searchPeople"), {
    autoFocus: true,
  });

  return (
    <AssigneePickerBody
      value={actor}
      query={query}
      kinds={AGENT_KINDS}
      showUnassigned={false}
      onChange={(next) => {
        setActor(next as AgentActorValue);
        router.back();
      }}
    />
  );
}