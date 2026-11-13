/**
 * Inline cell editor for the issue table (MYS-1149) — the mobile answer to
 * web's in-place table cell editors (`packages/views/issues/components/
 * table-view.tsx:1101-1218`).
 *
 * Web mounts a popover over the cell because a desktop table has room for
 * one. A phone column is ~90-140pt wide, so the editor is a bottom sheet
 * hosting the SAME picker bodies the detail page and the batch bar already
 * use — identical options, identical ordering, identical optimistic writes.
 *
 * Editable columns (mirroring web): status, priority, assignee, project,
 * labels, start_date, due_date, property:<id>. identifier / creator /
 * created_at / updated_at are read-only in web too; `title` is edited from
 * the pinned cell's rename dialog instead.
 *
 * Writes go through the same hooks as the rest of the app: `useUpdateIssue`
 * for scalar fields, `useAttachLabel`/`useDetachLabel` (+ `useCreateLabel`)
 * for labels, and the shared property editor's own mutations. They all patch
 * the list caches optimistically, so the cell flips on tap.
 *
 * ## The status cell is a handoff surface too (MYS-2743 follow-up)
 *
 * This sheet is permanently reachable from three screens (my-issues, the
 * all-issues page, a project's issue surface), so a status tap here is one of
 * the app's most likely ways to reassign an issue — and iteration 290's first
 * cut left it writing straight through `useUpdateIssue`, bypassing the gate
 * that the other four surfaces go through. Upstream keeps one dialog for every
 * surface (`packages/views/issues/components/table-view.tsx` renders the same
 * `StatusPicker` there); a half-wired app is worse than an unwired one because
 * the surfaces that DO ask make this one look trustworthy.
 *
 * Two details are load-bearing:
 *
 *   - The status list is narrowed by the issue's OWN project
 *     (`projectId={issue.project_id}`, which upstream passes here as well).
 *     Without it the body falls back to the unlimited catalog and offers
 *     columns the server refuses with `status_not_in_workflow`.
 *   - The picker sheet CLOSES before the confirmation opens, and the gated
 *     issue is held in `gateIssue` so the gate keeps a subject while `target`
 *     is null. Two stacked RN `Modal`s are not reliably layered on Android, and
 *     the hook's preview needs the issue id after the sheet is gone.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type {
  Issue,
  Label,
  Project,
  UpdateIssueRequest,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { PickerSheet } from "@/components/issue/pickers/picker-sheet";
import { SearchablePickerBody } from "@/components/pickers/searchable-picker-body";
import { StatusPickerBody } from "@/components/issue/pickers/status-picker-body";
import { PriorityPickerBody } from "@/components/issue/pickers/priority-picker-body";
import {
  AssigneePickerBody,
  type AssigneeValue,
} from "@/components/issue/pickers/assignee-picker-body";
import { ProjectPickerBody } from "@/components/issue/pickers/project-picker-body";
import { LabelPickerBody } from "@/components/issue/pickers/label-picker-body";
import {
  DueDatePickerBody,
  type DueDatePickerBodyHandle,
} from "@/components/issue/pickers/due-date-picker-body";
import { PropertyValueEditor } from "@/components/issue/pickers/property-value-editor";
import {
  useAttachLabel,
  useDetachLabel,
  useUpdateIssue,
} from "@/data/mutations/issues";
import { useCreateLabel } from "@/data/mutations/labels";
import { projectListOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useHandoffGate } from "@/data/use-handoff-gate";
import { handoffSubjectIssueId } from "@/lib/handoff-gate";
import { HandoffConfirmDialog } from "./workflow-handoff-dialog";
import {
  propertyIdFromTableColumn,
  type TableColumnKey,
} from "@/data/stores/issue-table-columns";
import { useTranslation } from "@/lib/i18n/react";

/** Columns whose cell opens an editor. Mirrors web's editable column set. */
export function isEditableTableColumn(column: TableColumnKey): boolean {
  if (column.startsWith("property:")) return true;
  return (
    column === "status" ||
    column === "priority" ||
    column === "assignee" ||
    column === "project" ||
    column === "labels" ||
    column === "start_date" ||
    column === "due_date"
  );
}

/** The open editor: a live row plus the column being edited. The caller
 *  re-derives `issue` from its row data on every render, so a write that
 *  lands while the sheet is open (a label toggle) is reflected immediately. */
export interface CellEditorTarget {
  issue: Issue;
  column: TableColumnKey;
}

interface Props {
  /** Null closes the sheet. */
  target: CellEditorTarget | null;
  onClose: () => void;
  /** Sheet heading — the caller's localized column label. */
  title: string;
}

export function IssueCellEditor({ target, onClose, title }: Props) {
  /**
   * The issue a pending handoff is about, remembered past the sheet's life.
   *
   * Two sources are needed, and the order matters:
   *
   *   - `target.issue` while the cell sheet is open — the gate must be given
   *     the issue on the SAME render the pick happens, because `gate` runs
   *     synchronously inside the tap handler and `setGateIssue` will not have
   *     been applied yet. Reading state alone here made the first tap look like
   *     "no issue" and refuse every ordinary status change.
   *   - this state after the sheet closes — the confirmation is a sibling
   *     modal, so the surface has to keep a subject once `target` is gone, both
   *     for the preview query and for the sentence the dialog renders.
   */
  const [gateIssue, setGateIssue] = useState<Issue | null>(null);

  /**
   * The issue the WRITE binds to — not the same value as the sheet's target.
   *
   * A gated pick closes the sheet before the write happens (`commitStatus`
   * below), so by the time the user confirms — or by the time the preview
   * answers "no handoff" — `target` is null again. `useUpdateIssue` closes over
   * this id in its `mutationFn`, and TanStack's `useMutation` refills its
   * observer from an effect after every render while `mutate` reads the
   * observer's CURRENT options at call time, so an id derived from `target`
   * alone collapses to `""` during exactly the deferral the gate introduces and
   * the confirmed write goes to `PUT /api/issues/` with no id at all.
   *
   * `target` also goes null for reasons other than the pick: the table derives
   * it from the current row list (`table-view.tsx`, `editorTarget`), so a
   * realtime refresh that drops the row does the same thing mid-confirmation.
   *
   * `handoffSubjectIssueId` is the shared rule — the dialog's subject and the
   * write's destination must be one decision.
   */
  const writeIssueId = handoffSubjectIssueId(target?.issue.id, gateIssue?.id);
  // The same per-issue hooks the detail page's picker routes use. Never called
  // while `target` is null (the sheet is unmounted then), but hooks must run
  // unconditionally.
  const updateIssue = useUpdateIssue(writeIssueId);
  // Label writes are only ever issued from the open sheet — they are never
  // deferred behind the gate — so they keep the target's own id.
  const issueId = target?.issue.id ?? "";
  const attachLabel = useAttachLabel(issueId);
  const detachLabel = useDetachLabel(issueId);
  const createLabel = useCreateLabel();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const [query, setQuery] = useState("");

  const handoff = useHandoffGate(target?.issue ?? gateIssue, {
    // The write itself carries the issue id in the closure handed to `gate`;
    // all that is left is forgetting the subject so a later, unrelated pick
    // cannot be gated against a stale issue.
    onWritten: () => setGateIssue(null),
  });

  /**
   * Dismissing the confirmation also forgets the subject.
   *
   * `handoff.cancel` abandons the held write (the tested decision), but this
   * component owns the issue the preview was about. Leaving it set would let a
   * later, unrelated re-render keep a dialog keyed on an old row — and the next
   * pick would gate against the stale issue rather than the tapped one.
   */
  const { cancel: cancelPendingHandoff } = handoff;
  const cancelHandoff = useCallback(() => {
    cancelPendingHandoff();
    setGateIssue(null);
  }, [cancelPendingHandoff]);

  useEffect(() => {
    // A search typed into one cell's sheet must not pre-filter the next one.
    setQuery("");
  }, [target?.issue.id, target?.column]);

  if (!target) {
    // The sheet is closed, but a confirmation may still be up — it is a
    // sibling modal, not a child of the sheet.
    return (
      <HandoffConfirmDialog
        issue={handoff.pending && gateIssue
          ? { id: gateIssue.id, identifier: gateIssue.identifier }
          : null}
        target={handoff.pending ?? { kind: "status", status: "" }}
        preview={handoff.preview ?? null}
        readState={handoff.readState}
        onRetry={handoff.retry}
        onCancel={cancelHandoff}
        onConfirm={handoff.confirm}
      />
    );
  }

  const commit = (patch: UpdateIssueRequest) => {
    onClose();
    updateIssue.mutate(patch);
  };

  /**
   * A status pick from the inline cell.
   *
   * The sheet closes FIRST and the gate decides: if the move can hand off, the
   * confirmation takes over; otherwise the write lands immediately (and the
   * cell flips on the optimistic patch). Closing first is not cosmetic — the
   * gate's own modal would otherwise sit under this one.
   */
  const commitStatus = (issue: Issue, status: string) => {
    if (status === issue.status) {
      onClose();
      return;
    }
    setGateIssue(issue);
    onClose();
    handoff.gate({ kind: "status", status }, (control) => {
      updateIssue.mutate({ status, ...control });
    });
  };

  const propertyId = propertyIdFromTableColumn(target.column);
  // Bodies whose root is a `flex-1` list need the sheet to supply a definite
  // height — see picker-sheet.tsx. Status/Priority (content-sized ScrollView)
  // and the date cells (native picker + header) stay content-sized.
  const fill =
    propertyId !== null ||
    target.column === "assignee" ||
    target.column === "project" ||
    target.column === "labels";

  return (
    <>
      <PickerSheet title={title} visible onClose={onClose} fill={fill}>
        {propertyId ? (
          <PropertyValueEditor
            issueId={target.issue.id}
            propertyId={propertyId}
            onClose={onClose}
          />
        ) : (
          <CellBody
            issue={target.issue}
            column={target.column}
            query={query}
            onQueryChange={setQuery}
            projects={projects}
            onCommit={commit}
            onCommitStatus={commitStatus}
            onAttachLabel={(label) => attachLabel.mutate({ label })}
            onDetachLabel={(labelId) => detachLabel.mutate({ labelId })}
            onCreateLabel={(name, color) =>
              createLabel.mutate(
                { name, color },
                { onSuccess: (label: Label) => attachLabel.mutate({ label }) },
              )
            }
          />
        )}
      </PickerSheet>
      <HandoffConfirmDialog
        issue={handoff.pending && gateIssue
          ? { id: gateIssue.id, identifier: gateIssue.identifier }
          : null}
        target={handoff.pending ?? { kind: "status", status: "" }}
        preview={handoff.preview ?? null}
        readState={handoff.readState}
        onRetry={handoff.retry}
        onCancel={cancelHandoff}
        onConfirm={handoff.confirm}
      />
    </>
  );
}

function CellBody({
  issue,
  column,
  query,
  onQueryChange,
  projects,
  onCommit,
  onCommitStatus,
  onAttachLabel,
  onDetachLabel,
  onCreateLabel,
}: {
  issue: Issue;
  column: TableColumnKey;
  query: string;
  onQueryChange: (query: string) => void;
  projects: Project[];
  onCommit: (patch: UpdateIssueRequest) => void;
  /** Status is gated (see `IssueCellEditor`), so it takes its own path. */
  onCommitStatus: (issue: Issue, status: string) => void;
  onAttachLabel: (label: Label) => void;
  onDetachLabel: (labelId: string) => void;
  onCreateLabel: (name: string, color: string) => void;
}) {
  const { t } = useTranslation();

  switch (column) {
    case "status":
      return (
        <StatusPickerBody
          value={issue.status}
          // The issue's OWN project decides which statuses exist. Passing
          // `undefined` here (as this cell used to) is not a neutral default:
          // it means "this surface spans projects", so the body offers the
          // whole catalog — including columns this issue's workflow does not
          // contain, which the server then refuses with
          // `status_not_in_workflow`. Upstream passes the same prop to the
          // table's `StatusPicker` (`table-view.tsx`, `case "status"`).
          projectId={issue.project_id}
          onChange={(status) => onCommitStatus(issue, status)}
        />
      );
    case "priority":
      return (
        <PriorityPickerBody
          value={issue.priority}
          onChange={(priority) => onCommit({ priority })}
        />
      );
    case "assignee": {
      const value: AssigneeValue =
        issue.assignee_type && issue.assignee_id
          ? { type: issue.assignee_type, id: issue.assignee_id }
          : null;
      return (
        <SearchablePickerBody
          query={query}
          onQueryChange={onQueryChange}
          placeholder={t("picker.searchPeople")}
        >
          <AssigneePickerBody
            value={value}
            query={query}
            onChange={(next) =>
              onCommit(
                next === null
                  ? { assignee_type: null, assignee_id: null }
                  : { assignee_type: next.type, assignee_id: next.id },
              )
            }
          />
        </SearchablePickerBody>
      );
    }
    case "project": {
      const value = projects.find((p) => p.id === issue.project_id) ?? null;
      return (
        <SearchablePickerBody
          query={query}
          onQueryChange={onQueryChange}
          placeholder={t("picker.searchProjects")}
        >
          <ProjectPickerBody
            value={value}
            query={query}
            onChange={(next) => onCommit({ project_id: next?.id ?? null })}
          />
        </SearchablePickerBody>
      );
    }
    case "labels":
      return (
        <SearchablePickerBody
          query={query}
          onQueryChange={onQueryChange}
          placeholder={t("picker.searchLabels")}
        >
          <LabelPickerBody
            attached={issue.labels ?? []}
            query={query}
            onAttach={onAttachLabel}
            onDetach={onDetachLabel}
            onCreate={onCreateLabel}
          />
        </SearchablePickerBody>
      );
    case "start_date":
      return (
        <DateCellBody
          value={issue.start_date}
          onDone={(iso) => onCommit({ start_date: iso })}
        />
      );
    case "due_date":
      return (
        <DateCellBody
          value={issue.due_date}
          onDone={(iso) => onCommit({ due_date: iso })}
        />
      );
    default:
      return null;
  }
}

/**
 * Date columns need an explicit commit: the native picker fires on every
 * spin, so Done (and Clear, when set) mirror
 * `issue/[id]/picker/due-date.tsx`.
 */
function DateCellBody({
  value,
  onDone,
}: {
  value: string | null;
  onDone: (iso: string | null) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<DueDatePickerBodyHandle>(null);

  return (
    <View>
      <View className="flex-row items-center justify-end gap-1 px-4 pb-1">
        {value ? (
          <Button variant="ghost" size="sm" onPress={() => onDone(null)}>
            <Text className="text-destructive">{t("common.clear")}</Text>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onPress={() => onDone(ref.current?.getIso() ?? null)}
        >
          <Text className="text-primary font-medium">{t("common.done")}</Text>
        </Button>
      </View>
      <DueDatePickerBody ref={ref} value={value} />
    </View>
  );
}