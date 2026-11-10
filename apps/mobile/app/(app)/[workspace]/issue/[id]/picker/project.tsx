/**
 * Project picker route for an existing issue. The sheet inherits
 * `SHEET_OPTIONS` (`headerShown: false`), so the native search bar would not
 * mount on either platform — search is body-rendered.
 *
 * ## The handoff gate (MUL-7420, MYS-2743)
 *
 * Moving an issue into a project whose workflow hands off the column it lands
 * on is not administrative: it reassigns the issue and can start a run. Web
 * confirms it through the same `WorkflowHandoffConfirmDialog` a status change
 * uses (`IssueProjectPicker`), sending `enter_workflow_step: true` with the
 * move. The phone sent a bare `project_id` — so a move into a handoff workflow
 * reassigned silently, and the previous agent kept running.
 *
 * Here the sheet closes as usual, and either the move applies (no handoff
 * possible) or the handoff sheet asks first.
 */
import { useMemo } from "react";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ProjectPickerBody } from "@/components/issue/pickers/project-picker-body";
import { PickerBodyShell } from "@/components/pickers/picker-body-shell";
import { HandoffConfirmDialog } from "@/components/issue/workflow-handoff-dialog";
import { issueDetailOptions } from "@/data/queries/issues";
import { findProject, projectListOptions } from "@/data/queries/projects";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useHandoffGate, type HandoffControl } from "@/data/use-handoff-gate";
import { useWorkspaceStore } from "@/data/workspace-store";
import { usePickerSearch } from "@/lib/use-picker-search";
import { useTranslation } from "@/lib/i18n/react";

export default function IssueProjectPickerRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const updateIssue = useUpdateIssue(id);
  // Closes this formSheet route only AFTER a write is issued — see the note in
  // `picker/status.tsx`: closing eagerly unmounted the dialog and cancelled the
  // write with it.
  const handoff = useHandoffGate(issue, { onWritten: () => router.back() });
  const search = usePickerSearch(t("picker.searchProjects"), {
    autoFocus: true,
  });

  const project = useMemo(
    () => findProject(projects, issue?.project_id ?? null),
    [projects, issue?.project_id],
  );

  return (
    <>
      <PickerBodyShell search={search} title={t("attr.project")}>
        <ProjectPickerBody
          value={project ?? null}
          query={search.query}
          onChange={(next) => {
            // Unchanged selection writes nothing — a no-op save must not spend
            // a preview round-trip or a write. Close here since nothing will.
            if ((next?.id ?? null) === (issue?.project_id ?? null)) {
              router.back();
              return;
            }
            const projectId = next?.id ?? null;
            if (!projectId) {
              // Moving an issue OUT of a project hands off nothing (there is no
              // destination workflow), so it stays a plain administrative move.
              updateIssue.mutate({ project_id: null });
              router.back();
              return;
            }
            handoff.gate(
              { kind: "project", projectId, projectTitle: next?.title ?? "" },
              (control: HandoffControl) => {
                updateIssue.mutate({
                  project_id: projectId,
                  // Upstream sends this with a confirmed project move: it makes
                  // the move ENTER the destination's column, which is exactly
                  // what the handoff preview described. Without it the move is
                  // administrative and the handoff never happens, so the
                  // confirmation above would have described a write that did
                  // not occur. Sent on the `apply` path too — a destination with
                  // no handoff step still lands in its column.
                  enter_workflow_step: true,
                  ...control,
                });
              },
              // No `onAbandon`: this route holds nothing of its own. It stays
              // mounted showing the picker until a write issues, so a cancelled
              // or unverifiable move leaves the user exactly where they were —
              // on the picker, with the issue's project unchanged. Closing it
              // here would be a second, unexplained reaction to the same cancel
              // the handoff sheet has already reported.
            );
          }}
        />
      </PickerBodyShell>
      <HandoffConfirmDialog
        // Gated on `pending` — see the note in `picker/status.tsx`: passing the
        // issue unconditionally opens the sheet before any target is chosen.
        issue={handoff.pending && issue ? { id: issue.id, identifier: issue.identifier } : null}
        target={handoff.pending ?? { kind: "status", status: "" }}
        preview={handoff.preview ?? null}
        readState={handoff.readState}
        onRetry={handoff.retry}
        onCancel={handoff.cancel}
        onConfirm={handoff.confirm}
      />
    </>
  );
}
