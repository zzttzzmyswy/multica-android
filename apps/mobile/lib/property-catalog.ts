/**
 * Pure helpers for the workspace property management page (MYS-668, aligns
 * web packages/views/settings/components/properties-tab.tsx). Kept DOM-free
 * so the filtering / chip math is unit-testable.
 */
import type {
  IssueProperty,
  IssuePropertyOption,
} from "@multica/core/types";

/** Web parity: creating a new property is disabled past 20 active ones. */
export const MAX_ACTIVE_PROPERTIES = 20;

/** Web parity: option chips cap at 6 per row, overflow becomes "+N". */
export const OPTION_CHIPS_LIMIT = 6;

export function propertyHasOptions(property: IssueProperty): boolean {
  return property.type === "select" || property.type === "multi_select";
}

/**
 * Definitions whose values have a total order, and can therefore back a sort
 * field (web `sortableProperties`, issues-header.tsx:1605-1608). Number and
 * date are the two web offers; a text/url property would sort
 * lexically-meaninglessly, and a select's option order is a grouping
 * concern, not an ordering one.
 */
export function isSortableProperty(property: IssueProperty): boolean {
  return property.type === "number" || property.type === "date";
}

/**
 * Definitions a board can turn into lanes (web `groupableProperties`,
 * issues-header.tsx:1609-1612). Only `select` — it is the single-valued type
 * whose value maps 1:1 onto a column; multi_select would need an issue in
 * several lanes at once.
 */
export function isGroupableProperty(property: IssueProperty): boolean {
  return property.type === "select";
}

export interface PropertyCatalogFilter {
  query: string;
  showArchived: boolean;
}

export interface PropertyCatalogResult {
  /** Rows after archived toggle + name query filtering. */
  visible: IssueProperty[];
  /** Non-archived definitions, for the create gate / limit hint. */
  activeCount: number;
}

export function filterPropertyCatalog(
  properties: IssueProperty[],
  { query, showArchived }: PropertyCatalogFilter,
): PropertyCatalogResult {
  const activeCount = properties.filter((p) => !p.archived).length;
  const normalized = query.trim().toLowerCase();
  const visible = properties
    .filter((p) => (showArchived ? true : !p.archived))
    .filter(
      (p) => !normalized || p.name.toLowerCase().includes(normalized),
    );
  return { visible, activeCount };
}

export interface PropertyChips {
  chips: IssuePropertyOption[];
  rest: number;
}

/** First OPTION_CHIPS_LIMIT options plus a count of the overflow. */
export function propertyOptionChips(property: IssueProperty): PropertyChips {
  const options = property.config?.options ?? [];
  return {
    chips: options.slice(0, OPTION_CHIPS_LIMIT),
    rest: Math.max(0, options.length - OPTION_CHIPS_LIMIT),
  };
}