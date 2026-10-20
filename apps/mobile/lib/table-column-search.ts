/**
 * Search over the table column picker's two sections — mobile half of web's
 * `TableColumnPicker` (`packages/views/issues/components/table-view.tsx:483-506`):
 *
 *   const query = search.trim().toLocaleLowerCase();
 *   const systemColumns = TABLE_SYSTEM_COLUMNS.filter((key) =>
 *     t(($) => $.table.columns[key]).toLocaleLowerCase().includes(query));
 *   const visibleProperties = properties.filter((property) =>
 *     property.name.toLocaleLowerCase().includes(query));
 *
 * Web runs one query against BOTH sections and lets each section disappear
 * independently (`:524`, `:541` are each `length > 0 &&`). Filtering only the
 * custom properties while leaving all system columns pinned would be a
 * half-port: the user typing "日期" expects the system date columns to match,
 * and the user typing a property name expects the system section to get out of
 * the way.
 *
 * Three rules this module owns:
 *
 * 1. **Empty query keeps everything.** `""` and whitespace-only both mean "no
 *    search", not "match nothing" — trimming before the emptiness check is why
 *    a stray space from a keyboard's autocomplete does not blank the picker.
 *
 * 2. **Case folding is `toLocaleLowerCase()`**, exactly as web. Not
 *    `toLowerCase()`: Turkish dotted/dotless i and a few other locales differ,
 *    and the labels being matched here are localized. Not `normalize()` either —
 *    web does not NFC-fold, and adding it would make a decomposed property name
 *    match on mobile but not on web.
 *
 * 3. **The label a row DISPLAYS is the label that gets matched.** The caller
 *    resolves system column labels through i18n and property rows through
 *    `property.name`; this module never guesses a label from a key. A picker
 *    whose search matches something other than what is on screen is worse than
 *    no search.
 */

/** A system column, reduced to the two things search needs. */
export interface SearchableColumn {
  key: string;
  /** The already-localized text the row renders. */
  label: string;
}

/** A custom-property column. */
export interface SearchableProperty {
  id: string;
  name: string;
}

export interface ColumnSearchResult<C extends SearchableColumn, P extends SearchableProperty> {
  /** System columns whose label matches. All of them when the query is empty. */
  columns: C[];
  /** Properties whose name matches. All of them when the query is empty. */
  properties: P[];
  /** True when the query selected nothing — the sheet shows its empty note
   *  instead of two absent sections with no explanation. */
  empty: boolean;
}

/** Web's normalization, in one place so both sections cannot drift. */
export function normalizeColumnQuery(search: string): string {
  return search.trim().toLocaleLowerCase();
}

export function searchTableColumns<
  C extends SearchableColumn,
  P extends SearchableProperty,
>(
  columns: readonly C[],
  properties: readonly P[],
  search: string,
): ColumnSearchResult<C, P> {
  const query = normalizeColumnQuery(search);
  if (query === "") {
    return {
      columns: [...columns],
      properties: [...properties],
      empty: columns.length === 0 && properties.length === 0,
    };
  }
  const matchedColumns = columns.filter((column) =>
    column.label.toLocaleLowerCase().includes(query),
  );
  const matchedProperties = properties.filter((property) =>
    property.name.toLocaleLowerCase().includes(query),
  );
  return {
    columns: matchedColumns,
    properties: matchedProperties,
    empty: matchedColumns.length === 0 && matchedProperties.length === 0,
  };
}
