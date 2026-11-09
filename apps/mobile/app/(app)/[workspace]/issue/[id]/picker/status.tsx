/**
 * Status picker route for an existing issue — presented as a formSheet
 * (UISheetPresentationController) by the parent Stack.
 *
 * Self-contained: reads the issue from the TanStack Query detail cache,
 * calls `useUpdateIssue` directly on selection, then `router.back()`s. No
 * onChange callback to a parent.
 *
 * If the cache is cold (rare — the user reaches this screen by tapping
 * a chip on the issue-detail page that already populated it), the picker
 * still renders against the current value of `todo` and the optimistic
 * mutation patches the cache when the user picks.
 *
 * ## The handoff gate (MUL-7420, MYS-2743)
 *
 * Selecting a column that hands the issue off no longer writes straight away.
 * The picker closes, then either the write is applied (no handoff possible), or
 * the handoff sheet asks who it goes to, whether the previous agent is still
 * running, and what the new handler is told. See `data/use-handoff-gate.ts`.
 *
 * The sheet is rendered HERE rather than inside `StatusPickerBody`, because the
 * body is shared with the create form (`new-issue-picker/status.tsx`) and a
 * batch toolbar — neither of which moves an existing issue, so neither can hand
 * one off.
 */
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StatusPickerBody } from "@/components/issue/pickers/status-picker-body";
import { HandoffConfirmDialog } from "@/components/issue/workflow-handoff-dialog";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useHandoffGate, type HandoffControl } from "@/data/use-handoff-gate";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function IssueStatusPickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);
  // `onWritten` closes this formSheet route AFTER the write has been issued.
  // Closing it eagerly in `onChange` (the pre-iteration-290 behaviour) unmounted
  // the route that hosts this hook's state and the dialog, so a gated write was
  // cancelled along with it and the status silently never changed — caught on a
  // real device. With no handoff to ask about the sheet still closes at once,
  // because the gate writes synchronously on that path.
  const handoff = useHandoffGate(issue, {
    onWritten: () => router.back(),
  });

  return (
    <>
      <StatusPickerBody
        value={issue?.status ?? "todo"}
        // The issue's OWN project decides which statuses exist (MUL-7420). The
        // three-valued contract matters here: a cached issue with no project
        // yields `null`, which narrows to the Default workflow — the server's own
        // rule for a project-less issue — and must not become `undefined` ("this
        // surface spans projects"), which would offer the whole catalog and
        // restore the defect. Left `undefined` only while the issue itself is
        // unknown, where there is nothing truthful to narrow by.
        projectId={issue ? issue.project_id : undefined}
        onChange={(next) => {
          if (next === issue?.status) {
            // Nothing to write, so nothing will call `onWritten` — close here.
            router.back();
            return;
          }
          handoff.gate({ kind: "status", status: next }, (control: HandoffControl) => {
            updateIssue.mutate({ status: next, ...control });
          });
        }}
      />
      <HandoffConfirmDialog
        // Gated on `pending`, not merely on the issue existing: the sheet is
        // CLOSED until a column is chosen, and passing the issue unconditionally
        // opened it on mount with an empty target — a title reading
        // 「将 MYS-2746 移到""？」 over every status picker. Upstream's contract is
        // `issue={pending ? issue : null}` for exactly this reason.
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
