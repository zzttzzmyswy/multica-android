/**
 * Agent/squad picker route for the agent-mode quick-create draft. Reuses
 * `AssigneePickerBody` (members + agents + squads single-select) filtered
 * to agents + squads only — the actor that will process the natural-
 * language prompt. Reads/writes `agentActor` on the same draft store so
 * the quick-create panel rehydrates when this formSheet dismisses.
 *
 * Search lives in the iOS native nav header when the sheet keeps its header
 * (registered in `_layout.tsx` with `headerShown: true` + title), and in the
 * body everywhere else — Android never renders the native search bar.
 */
import { router } from "expo-router";
import { AssigneePickerBody } from "@/components/issue/pickers/assignee-picker-body";
import type { ActorKind } from "@/components/issue/pickers/assignee-picker-body";
import { PickerBodyShell } from "@/components/pickers/picker-body-shell";
import type { AgentActorValue } from "@/data/stores/new-issue-draft-store";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { usePickerSearch } from "@/lib/use-picker-search";
import { useTranslation } from "@/lib/i18n/react";

/** Stable filter array — module-level so AssigneePickerBody's `rows`
 *  useMemo keeps its `kinds` dep identity predictable across renders. */
const AGENT_KINDS: ActorKind[] = ["agent", "squad"];

export default function NewIssueAgentPickerRoute() {
  const { t } = useTranslation();
  const actor = useNewIssueDraftStore((s) => s.agentActor);
  const setActor = useNewIssueDraftStore((s) => s.setAgentActor);
  const search = usePickerSearch(t("picker.searchPeople"), {
    autoFocus: true,
    nativeHeader: true,
  });

  return (
    <PickerBodyShell search={search} title={t("newIssue.agentSelectAgent")}>
      <AssigneePickerBody
        value={actor}
        query={search.query}
        kinds={AGENT_KINDS}
        showUnassigned={false}
        onChange={(next) => {
          setActor(next as AgentActorValue);
          router.back();
        }}
      />
    </PickerBodyShell>
  );
}
