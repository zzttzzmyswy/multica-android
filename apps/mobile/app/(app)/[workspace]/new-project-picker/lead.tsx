/**
 * Lead picker route for the in-progress new-project draft. Mirrors
 * `new-issue-picker/status.tsx`.
 *
 * Reuses `ProjectLeadPickerBody` — the exact control the project DETAIL
 * screen's lead picker renders (`project/[id]/picker/lead.tsx`), so the
 * create-time and edit-time actor pickers cannot drift apart. The body already
 * groups members and agents and searches both; the only difference here is
 * that the value lands in the draft store instead of a `useUpdateProject`
 * mutation, because the project does not exist yet.
 *
 * The picked value is a `{type, id}` PAIR: writing the id alone leaves the
 * server unable to tell a member from an agent (see the draft store's
 * `ProjectLeadValue` doc).
 */
import { router } from "expo-router";
import { ProjectLeadPickerBody } from "@/components/project/pickers/project-lead-picker-body";
import { PickerBodyShell } from "@/components/pickers/picker-body-shell";
import { useNewProjectDraftStore } from "@/data/stores/new-project-draft-store";
import { usePickerSearch } from "@/lib/use-picker-search";
import { useTranslation } from "@/lib/i18n/react";

export default function NewProjectLeadPickerRoute() {
  const { t } = useTranslation();
  const lead = useNewProjectDraftStore((s) => s.lead);
  const setLead = useNewProjectDraftStore((s) => s.setLead);
  const search = usePickerSearch(t("picker.searchMembersOrAgents"), {
    autoFocus: true,
  });

  return (
    <PickerBodyShell search={search} title={t("picker.lead")}>
      <ProjectLeadPickerBody
        value={lead}
        query={search.query}
        onChange={(next) => {
          setLead(next);
          router.back();
        }}
      />
    </PickerBodyShell>
  );
}
