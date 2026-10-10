/**
 * Assignee picker route for an existing issue.
 *
 * Search lives in the iOS native nav header when the sheet keeps its header
 * (registered in `../_layout.tsx` with `headerShown: true` + title), and in
 * the body everywhere else — Android never renders the native search bar.
 * `usePickerSearch` makes that choice; `PickerBodyShell` renders it.
 *
 * ## Agent/squad assignment stops at a confirmation (web `RunConfirmModal`)
 *
 * This route is the ONE write path behind both assign entry points on the
 * phone — the detail page's assignee chip (`attribute-row.tsx`) and the
 * sub-issue header's inline avatar (`issue-children-section.tsx`), which
 * `openIssuePicker` routes here. Members and clearing the assignee apply
 * directly; so does an agent/squad assignment on a backlog issue, whose
 * parking-lot semantics mean the server starts no run either way.
 *
 * Everything else opens `AssignConfirmDialog` first, because assigning an
 * agent or a squad to a non-backlog issue is an irreversible side effect: the
 * server enqueues a run at write time, and the dialog is the user's only
 * chance to attach a handoff note to it or to hold it back (`suppress_run`).
 * Before this, the phone started the run on tap while web asked first — and
 * the phone's own batch toolbar already asked, so the two surfaces disagreed
 * with each other as well as with web.
 *
 * The dialog is hosted HERE rather than on the detail page so both entry
 * points get it without lifting state through the router; the route stays
 * pushed while it is up, and both footer buttons write and then pop.
 */
import { useState } from "react";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AssigneePickerBody } from "@/components/issue/pickers/assignee-picker-body";
import { AssignConfirmDialog } from "@/components/issue/assign-confirm-dialog";
import { PickerBodyShell } from "@/components/pickers/picker-body-shell";
import { issueDetailOptions } from "@/data/queries/issues";
import { agentListOptions } from "@/data/queries/agents";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { squadListOptions } from "@/data/queries/squads";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { usePickerSearch } from "@/lib/use-picker-search";
import {
  assignConfirmPayload,
  handoffNoteDisabled,
  handoffVerdict,
  singleAssignNeedsRunConfirm,
  type AssignTarget,
} from "@/lib/run-confirm";
import { useTranslation } from "@/lib/i18n/react";

export default function IssueAssigneePickerRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);
  const { getName } = useActorLookup();
  const search = usePickerSearch(t("picker.searchPeople"), {
    autoFocus: true,
    nativeHeader: true,
  });
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const [note, setNote] = useState("");

  // Handoff gate, resolved from the warm caches so the note box settles on the
  // first frame (no round-trip — the dialog must fire no request on open).
  // `null` = cannot tell → box stays usable; only `false` grays it.
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const { data: squads = [] } = useQuery(squadListOptions(wsId));
  const noteDisabled = handoffNoteDisabled(
    handoffVerdict({
      assigneeType: assignTarget?.type,
      assigneeId: assignTarget?.id,
      agents,
      runtimes,
      squads,
    }),
  );

  const value =
    issue?.assignee_type && issue?.assignee_id
      ? { type: issue.assignee_type, id: issue.assignee_id }
      : null;

  const applyAndClose = (patch: Parameters<typeof updateIssue.mutate>[0]) => {
    updateIssue.mutate(patch);
    router.back();
  };

  return (
    <>
      <PickerBodyShell search={search} title={t("screen.assignee")}>
        <AssigneePickerBody
          value={value}
          query={search.query}
          onChange={(next) => {
            if (next === null) {
              applyAndClose({ assignee_type: null, assignee_id: null });
              return;
            }
            if (next.type === "member") {
              applyAndClose({
                assignee_type: next.type,
                assignee_id: next.id,
              });
              return;
            }
            // Agent/squad. Backlog never starts a run on assign, so an issue
            // in the parking lot applies directly — the same short-circuit the
            // batch toolbar makes for an all-backlog selection, read through
            // the same shared predicate rather than a second copy of the rule.
            if (!singleAssignNeedsRunConfirm(issue, next.type)) {
              applyAndClose({
                assignee_type: next.type,
                assignee_id: next.id,
              });
              return;
            }
            setAssignTarget({ type: next.type, id: next.id });
          }}
        />
      </PickerBodyShell>
      <AssignConfirmDialog
        visible={assignTarget !== null}
        name={getName(assignTarget?.type, assignTarget?.id)}
        // One issue, so the singular sentence — the batch toolbar passes its
        // selection size through the same dialog.
        count={1}
        note={note}
        onNoteChange={setNote}
        busy={updateIssue.isPending}
        noteDisabled={noteDisabled}
        onConfirm={() => {
          if (!assignTarget) return;
          applyAndClose(assignConfirmPayload(assignTarget, false, note, noteDisabled));
        }}
        onDontStart={() => {
          if (!assignTarget) return;
          applyAndClose(assignConfirmPayload(assignTarget, true, note, noteDisabled));
        }}
        onClose={() => {
          if (updateIssue.isPending) return;
          setNote("");
          setAssignTarget(null);
        }}
      />
    </>
  );
}
