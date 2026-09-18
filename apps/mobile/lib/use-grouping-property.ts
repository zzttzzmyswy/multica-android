/**
 * Resolve the `select` definition backing a `property:<id>` board grouping
 * (iteration 129, MYS-1060). The board needs the definition itself — option
 * order, names and colors — not just the id, and all three board surfaces
 * would otherwise repeat the same catalog lookup (web does exactly this
 * inline at packages/views/issues/components/board-view.tsx:187-190).
 *
 * The query is gated on there BEING a property grouping: a status/assignee
 * board — the common case — must not pull the property catalog just to
 * render columns it will not use.
 *
 * A grouping whose definition is missing from the ACTIVE catalog (archived
 * or deleted) resolves to `null`, and `groupIssues` then falls back to
 * status lanes. The id itself stays in the store, so un-archiving the
 * definition brings the user's board back.
 */
import { useQuery } from "@tanstack/react-query";
import type { IssueProperty } from "@multica/core/types";
import { propertyActiveOptions } from "@/data/queries/properties";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  propertyIdFromViewKey,
  type IssueGrouping,
} from "@/data/stores/issue-filter-slice";
import { isGroupableProperty } from "@/lib/property-catalog";

export function useGroupingProperty(
  grouping: IssueGrouping,
): IssueProperty | null {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const propertyId = propertyIdFromViewKey(grouping);
  const { data: properties = [] } = useQuery({
    ...propertyActiveOptions(wsId),
    enabled: !!wsId && propertyId !== null,
  });
  if (!propertyId) return null;
  return (
    properties.find((p) => p.id === propertyId && isGroupableProperty(p)) ??
    null
  );
}
