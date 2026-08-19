/**
 * Pure, unit-testable helpers for the issue-workbench TABLE view's CSV
 * export (MYS-440). No RN / React imports — vitest node lane covers the
 * serialization + escaping safety invariants.
 *
 * Mirrors web's table-view export (`packages/views/issues/components/
 * table-view.tsx` table-model.ts / exportIssues) field-for-field so the
 * same visible table exports the same rows on either client:
 *
 *   - Column set = the CURRENT `tableColumns` config; property columns are
 *     resolved against the workspace catalog (a definition that no longer
 *     exists → its column drops out).
 *   - Header = system-column label (i18n) / property definition name.
 *   - Cell text: status/priority translate to localized labels; assignee /
 *     creator resolve via the actor catalog; labels join with ", "; project
 *     resolves via the project map; start/due dates stay raw "YYYY-MM-DD";
 *     created/updated stay raw ISO; property cells resolve their option
 *     ids to names (select → option name, multi_select → names joined with
 *     ", ", everything else → String(value)).
 *   - Escaping: strings that start with = + - @ \t \r get a leading `'`
 *     (formula-injection guard, real numbers preserved); cells containing
 *     `,` `"` `\n` `\r` are quoted with `"` doubling. CRLF line endings +
 *     UTF-8 BOM so Excel opens the file correctly.
 */
import type { Issue, IssueProperty } from "@multica/core/types";
import { propertyIdFromTableColumn, type TableColumnKey } from "@/data/stores/issue-table-columns";

/** Field-name vocabulary for one issue the export can read directly off the
 *  Issue schema without resolution. */
type RawIssueColumn = "title" | "identifier" | "start_date" | "due_date" | "created_at" | "updated_at";

/** Lookups the serialization needs — supplied by the component from the
 *  surface's catalogs + i18n, so this module stays pure and Node-testable. */
export interface IssueTableExportContext {
  /**
   * Status label keyed by status key. The component builds it from the
   * catalog-aware resolver: built-ins -> i18n, custom statuses -> their
   * catalog name, keys the catalog never saw -> the raw key. The fallback
   * below (`?? status`) is the same "never render blank" rule.
   */
  statusLabels: Record<string, string>;
  /** Localized priority label keyed by IssuePriority. */
  priorityLabels: Record<string, string>;
  /** Actor display-name resolver; returns "" for unknown actors. */
  actorName: (
    type: "member" | "agent" | "squad",
    id: string,
  ) => string;
  /** Project-title resolver; returns "" when id is null/unknown. */
  projectTitle: (id: string | null) => string;
  /** Workspace property catalog (archived definitions included so a column
   *  still resolves options for archived properties). */
  propertyDefinitions: IssueProperty[];
}

const RAW_COLUMNS: readonly RawIssueColumn[] = [
  "title",
  "identifier",
  "start_date",
  "due_date",
  "created_at",
  "updated_at",
];

/** Text for one column of one issue — the value shared by the CSV body and
 *  the table's plain-text interest. Returns "" when there is nothing to
 *  show (unset assignee/date, property definition missing, option id
 *  vanished). */
export function tableCellText(
  issue: Issue,
  column: TableColumnKey,
  ctx: IssueTableExportContext,
): string {
  if ((RAW_COLUMNS as readonly string[]).includes(column)) {
    const raw = issue[column as RawIssueColumn];
    return raw ?? "";
  }
  switch (column) {
    case "status":
      return ctx.statusLabels[issue.status] ?? issue.status;
    case "priority":
      return ctx.priorityLabels[issue.priority] ?? issue.priority;
    case "assignee":
      return issue.assignee_type && issue.assignee_id
        ? ctx.actorName(issue.assignee_type, issue.assignee_id)
        : "";
    case "creator":
      return ctx.actorName(issue.creator_type, issue.creator_id);
    case "labels":
      return (issue.labels ?? []).map((l) => l.name).join(", ");
    case "project":
      return ctx.projectTitle(issue.project_id);
    default: {
      const propertyId = propertyIdFromTableColumn(column);
      if (!propertyId) return "";
      return propertyCellText(issue, propertyId, ctx);
    }
  }
}

/** Custom-property cell value, mirroring web's propertyDisplayValue
 *  (table-view.tsx): select → option name, multi_select → names joined
 *  with ", ", checkbox → "true"/"false", date → raw day string, number →
 *  number string, unknown/no definition → "". */
function propertyCellText(
  issue: Issue,
  propertyId: string,
  ctx: IssueTableExportContext,
): string {
  const definition = ctx.propertyDefinitions.find((p) => p.id === propertyId);
  if (!definition) return "";
  const raw = (issue.properties ?? {})[propertyId];
  if (raw === undefined) return "";
  if (definition.type === "select") {
    if (typeof raw !== "string") return "";
    return (
      definition.config.options?.find((o) => o.id === raw)?.name ?? ""
    );
  }
  if (definition.type === "multi_select") {
    if (!Array.isArray(raw)) return "";
    const names = raw
      .map((id) => definition.config.options?.find((o) => o.id === id)?.name)
      .filter((n): n is string => !!n);
    return names.join(", ");
  }
  return String(raw);
}

/**
 * Escape one text cell for CSV. Formula-injection guard mirrors web
 * `escapeCsvCell`: cells that START with `=`, `+`, `-`, `@`, tab or CR get
 * a leading `'` (so spreadsheets never execute them); purely numeric cells
 * pass through untouched. Cells containing `,` `"` `\n` `\r` are quoted
 * with embedded quotes doubled.
 */
export function escapeCsvCell(value: string): string {
  let out = value;
  // A numeric string like "42" is preserved; anything else that starts with
  // a formula trigger gets defused.
  if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  if (/[,"\n\r]/.test(out)) {
    out = `"${out.replaceAll('"', '""')}"`;
  }
  return out;
}

/** Header labels for the exported column set — one per visible column.
 *  System columns use their catalog label; property columns their
 *  definition name. */
export function exportHeaderLabels(
  columns: readonly TableColumnKey[],
  columnLabel: (column: TableColumnKey) => string,
): string[] {
  return columns.map((column) => columnLabel(column));
}

/**
 * Assemble the CSV document for `issues` under `columns`.
 * `bodyCell` is `tableCellText` bound to the right context by the caller.
 * Returns the full escaped document with a UTF-8 BOM and CRLF line endings
 * (web's exact byte conventions).
 */
export function buildIssuesCsv(
  issues: readonly Issue[],
  columns: readonly TableColumnKey[],
  headerLabels: readonly string[],
  bodyCell: (issue: Issue, column: TableColumnKey) => string,
): string {
  const lines = [
    [...columns.map((_, i) => escapeCsvCell(headerLabels[i] ?? ""))],
    ...issues.map((issue) => columns.map((column) => escapeCsvCell(bodyCell(issue, column)))),
  ];
  return `\uFEFF${lines.map((row) => row.join(",")).join("\r\n")}`;
}

/** Export filename, mirroring web: `issues-YYYY-MM-DD.csv` for the full
 *  visible set, `issues-selected-YYYY-MM-DD.csv` for the selection. */
export function csvExportFileName(
  scope: "all" | "selected",
  dateOnly: string,
): string {
  return scope === "all"
    ? `issues-${dateOnly}.csv`
    : `issues-selected-${dateOnly}.csv`;
}