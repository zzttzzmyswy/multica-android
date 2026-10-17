/**
 * Inline cell editor for the projects list (iteration 253, MYS-2202) — the
 * mobile answer to web's in-place status / priority / lead cells
 * (`packages/views/projects/components/projects-page.tsx:406-460,613-680`).
 *
 * Web mounts a `DropdownMenu` (status, priority) or a `Popover` (lead) over the
 * cell because a desktop row has room for one. A phone column is 80-140pt wide
 * and the card's chips share a single line, so the editor is a bottom sheet
 * hosting the SAME picker bodies the detail page's routes already use —
 * identical options, identical ordering, identical optimistic writes. That is
 * the shape `components/issue/table-cell-editor.tsx` gave the issue table in
 * MYS-1149, reused rather than reinvented.
 *
 * Editable columns are exactly the three web makes editable in both of its
 * views; `progress` / `issues` / `created` are read-only there and stay
 * read-only here. Writes go through the shared `useUpdateProject`, which
 * patches the list and detail caches optimistically and carries the failure
 * title the app-wide mutation-cache alert reads (`lib/write-failure.ts`), so a
 * rejected write says so instead of silently reverting.
 */
import { useEffect, useState } from "react";
import type { Project, UpdateProjectRequest } from "@multica/core/types";
import { PickerSheet } from "@/components/issue/pickers/picker-sheet";
import { ProjectStatusPickerBody } from "@/components/project/pickers/project-status-picker-body";
import { ProjectPriorityPickerBody } from "@/components/project/pickers/project-priority-picker-body";
import { ProjectLeadPickerBody } from "@/components/project/pickers/project-lead-picker-body";
import { SearchablePickerBody } from "@/components/pickers/searchable-picker-body";
import { useUpdateProject } from "@/data/mutations/projects";
import {
  leadUpdatePatch,
  leadValueOf,
  type ProjectCellColumn,
} from "@/lib/project-inline-edit";
import { useTranslation } from "@/lib/i18n/react";

/** The open editor: a live project plus the column being edited. The caller
 *  re-derives `project` from its list on every render, so a write that lands
 *  while the sheet is open is reflected immediately. */
export interface ProjectCellTarget {
  project: Project;
  column: ProjectCellColumn;
}

interface Props {
  /** Null closes the sheet. */
  target: ProjectCellTarget | null;
  onClose: () => void;
  /** Sheet heading — the caller's localized column label. */
  title: string;
}

export function ProjectCellEditor({ target, onClose, title }: Props) {
  const { t } = useTranslation();
  // The same hook the detail page's picker routes use. Bound to the open
  // target; never called while `target` is null (the sheet is unmounted then),
  // but hooks must run unconditionally.
  const projectId = target?.project.id ?? "";
  const updateProject = useUpdateProject(projectId);
  const [query, setQuery] = useState("");

  // A search typed into one cell's sheet must not pre-filter the next one.
  useEffect(() => {
    setQuery("");
  }, [target?.project.id, target?.column]);

  if (!target) return null;

  const commit = (patch: UpdateProjectRequest) => {
    onClose();
    updateProject.mutate(patch);
  };

  // The lead body's root is a `flex-1` FlatList, so the sheet has to supply a
  // definite height (see picker-sheet.tsx). Status and priority are
  // content-sized ScrollViews and stay content-sized, so a five-row list does
  // not float in a tall sheet — the same split the issue editor makes.
  const fill = target.column === "lead";

  return (
    <PickerSheet title={title} visible onClose={onClose} fill={fill}>
      {target.column === "status" ? (
        <ProjectStatusPickerBody
          value={target.project.status}
          onChange={(status) => commit({ status })}
        />
      ) : target.column === "priority" ? (
        <ProjectPriorityPickerBody
          value={target.project.priority}
          onChange={(priority) => commit({ priority })}
        />
      ) : (
        <SearchablePickerBody
          query={query}
          onQueryChange={setQuery}
          // The detail route's own placeholder
          // (`project/[id]/picker/lead.tsx`), so the same picker names its
          // search box the same way whichever sheet opened it.
          placeholder={t("picker.searchMembersOrAgents")}
        >
          <ProjectLeadPickerBody
            value={leadValueOf(target.project)}
            query={query}
            onChange={(next) => commit(leadUpdatePatch(next))}
          />
        </SearchablePickerBody>
      )}
    </PickerSheet>
  );
}
