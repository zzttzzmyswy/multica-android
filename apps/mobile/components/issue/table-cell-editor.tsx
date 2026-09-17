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
 */
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type {
  Issue,
  Label,
  Project,
  UpdateIssueRequest,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { PickerSheet } from "@/components/issue/pickers/picker-sheet";
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
  const issueId = target?.issue.id ?? "";
  // The same per-issue hooks the detail page's picker routes use. Bound to
  // the open target; never called while `target` is null (the sheet is
  // unmounted then), but hooks must run unconditionally.
  const updateIssue = useUpdateIssue(issueId);
  const attachLabel = useAttachLabel(issueId);
  const detachLabel = useDetachLabel(issueId);
  const createLabel = useCreateLabel();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const [query, setQuery] = useState("");

  // A search typed into one cell's sheet must not pre-filter the next one.
  useEffect(() => {
    setQuery("");
  }, [target?.issue.id, target?.column]);

  if (!target) return null;

  const commit = (patch: UpdateIssueRequest) => {
    onClose();
    updateIssue.mutate(patch);
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
  );
}

function CellBody({
  issue,
  column,
  query,
  onQueryChange,
  projects,
  onCommit,
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
          onChange={(status) => onCommit({ status })}
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
        <SearchableBody
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
        </SearchableBody>
      );
    }
    case "project": {
      const value = projects.find((p) => p.id === issue.project_id) ?? null;
      return (
        <SearchableBody
          query={query}
          onQueryChange={onQueryChange}
          placeholder={t("picker.searchProjects")}
        >
          <ProjectPickerBody
            value={value}
            query={query}
            onChange={(next) => onCommit({ project_id: next?.id ?? null })}
          />
        </SearchableBody>
      );
    }
    case "labels":
      return (
        <SearchableBody
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
        </SearchableBody>
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

/** Search field above a picker body whose filtering is caller-driven. The
 *  detail-page routes wire the same bodies to the native search bar; a sheet
 *  has no header, so the field lives in the body. */
function SearchableBody({
  query,
  onQueryChange,
  placeholder,
  children,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-1">
      <View className="px-3 pt-2 pb-1">
        <TextField
          value={query}
          onChangeText={onQueryChange}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      {children}
    </View>
  );
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