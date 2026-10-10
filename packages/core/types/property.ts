/**
 * Custom issue properties — workspace-defined, typed fields on issues
 * (MUL-4463). Definitions live in a workspace catalog (managed by owner/admin
 * only); values live on each issue in a bag keyed by definition id, so
 * renames never touch issue rows.
 *
 * Values are typed per definition: select stores an option id, multi_select
 * an array of option ids (config order), date a "YYYY-MM-DD" string, checkbox
 * a boolean, number a number, text/url strings, actor/multi_actor member
 * reference strings ("member:<user_id>").
 */
export type IssuePropertyType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "url"
  | "actor"
  | "multi_actor";

export const ISSUE_PROPERTY_TYPES: IssuePropertyType[] = [
  "text",
  "number",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "url",
  "actor",
  "multi_actor",
];

export function isKnownPropertyType(type: string): type is IssuePropertyType {
  return (ISSUE_PROPERTY_TYPES as string[]).includes(type);
}

/**
 * Actor properties reference a workspace member (MUL-6286). The assignee pair
 * also accepts agents and squads; actor properties deliberately do not — an
 * agent reference would drag in agent-visibility rules, and a squad is a
 * routing target rather than a person.
 *
 * The stored form is "<kind>:<uuid>", so widening this union later needs no
 * migration and no new property type.
 */
export type IssuePropertyActorKind = "member";

export const ISSUE_PROPERTY_ACTOR_KINDS: IssuePropertyActorKind[] = ["member"];

/** Upper bound on one multi_actor value; mirrors the server cap
 *  (`server/internal/issueproperty/value.go` MaxActorValues). */
export const MAX_ISSUE_PROPERTY_ACTOR_VALUES = 20;

export interface IssuePropertyActorRef {
  kind: IssuePropertyActorKind;
  /** Members are referenced by `user_id`, matching the issue assignee pair. */
  id: string;
}

export function isActorPropertyType(type: string): boolean {
  return type === "actor" || type === "multi_actor";
}

/** Single-valued scalar properties: text / number / date / url. */
export type ScalarIssuePropertyType = Extract<IssuePropertyType, "text" | "number" | "date" | "url">;

export function isScalarPropertyType(type: string): type is ScalarIssuePropertyType {
  return type === "text" || type === "url" || type === "number" || type === "date";
}

/**
 * Types the issue filter menu exposes for value + "No value" filtering.
 * Kept as an explicit enumeration (rather than delegating to
 * isKnownPropertyType) so a future property type must opt into filtering —
 * it should never become filterable by default.
 *
 * Mirrors upstream `packages/core/types/property.ts`. Note this is the
 * CLIENT's list of what the filter menu may offer: a deployed server decides
 * independently which of these it can actually match, and this fork's server
 * accepts all eight (verified against the live deployment — see
 * `apps/mobile/lib/filter-issues.ts` for the matcher's matching semantics).
 */
export function isFilterablePropertyType(type: string): boolean {
  return (
    type === "select" ||
    type === "multi_select" ||
    type === "checkbox" ||
    isScalarPropertyType(type) ||
    isActorPropertyType(type)
  );
}

/**
 * The filter value that means "this property is unset" rather than a literal
 * string. Mirrors the server's `noPropertyValue` constant
 * (`server/internal/handler/property.go`), which compiles it to a key-absence
 * predicate.
 *
 * Load-bearing on the client too: a text property whose stored value happens
 * to be the literal `__none__` is matched as a *value*, because the server's
 * key-absence predicate excludes it from a No-value filter. The client matcher
 * must agree with that rather than treating the sentinel as a wildcard.
 */
export const NO_PROPERTY_VALUE = "__none__";

export function formatActorRef(kind: IssuePropertyActorKind, id: string): string {
  return `${kind}:${id}`;
}

/** Returns null for anything that isn't a well-formed reference. */
export function parseActorRef(raw: unknown): IssuePropertyActorRef | null {
  if (typeof raw !== "string") return null;
  const separator = raw.indexOf(":");
  if (separator <= 0) return null;
  const kind = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (!id) return null;
  if (!(ISSUE_PROPERTY_ACTOR_KINDS as string[]).includes(kind)) return null;
  return { kind: kind as IssuePropertyActorKind, id };
}

/**
 * Raw reference strings in stored order, INCLUDING kinds this build does not
 * know about.
 *
 * Editors must round-trip through this rather than through
 * `actorRefsFromValue`: a client talking to a newer backend would otherwise
 * drop every unknown-kind entry the moment the user toggles one it does
 * understand — silent data loss the user never sees.
 */
export function actorRefValuesFromValue(value: IssuePropertyValue | undefined): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

/**
 * Reads an actor property value as a list of refs this build can render.
 * Unknown kinds are dropped rather than thrown on — see
 * `actorRefValuesFromValue` for the edit path, which must keep them.
 */
export function actorRefsFromValue(value: IssuePropertyValue | undefined): IssuePropertyActorRef[] {
  if (typeof value === "string") {
    const ref = parseActorRef(value);
    return ref ? [ref] : [];
  }
  if (Array.isArray(value)) {
    return value.map(parseActorRef).filter((ref): ref is IssuePropertyActorRef => ref !== null);
  }
  return [];
}

/**
 * True when an actor value holds at least one reference this build cannot
 * parse — i.e. a newer backend has widened the accepted kinds.
 *
 * Editors must consult this before offering a normal edit. For `multi_actor`
 * the toggle already round-trips unknown entries, but for single `actor` an
 * unresolvable value renders as empty, and letting the user "fill in the empty
 * field" would overwrite a value they were never shown (MUL-6286 review).
 */
export function hasUnknownActorRef(value: IssuePropertyValue | undefined): boolean {
  return actorRefValuesFromValue(value).length !== actorRefsFromValue(value).length;
}

export interface IssuePropertyOption {
  id: string;
  name: string;
  /** Normalized lowercase hex color, e.g. `#3b82f6`. */
  color: string;
}

export interface IssuePropertyConfig {
  options?: IssuePropertyOption[];
}

export interface IssueProperty {
  id: string;
  workspace_id: string;
  name: string;
  /** Lenient string: newer servers may ship types this client doesn't know. */
  type: string;
  description?: string;
  /** Optional catalog icon key; absent on backends predating icon support. */
  icon?: string;
  config: IssuePropertyConfig;
  position: number;
  archived: boolean;
  archived_at?: string | null;
  usage_count?: number;
  created_at: string;
  updated_at: string;
}

export type IssuePropertyValue = string | number | boolean | string[];
export type IssuePropertyValues = Record<string, IssuePropertyValue>;

export interface CreatePropertyRequest {
  name: string;
  type: IssuePropertyType;
  description?: string;
  icon?: string;
  config?: IssuePropertyConfig;
}

export interface UpdatePropertyRequest {
  name?: string;
  description?: string;
  /** Empty string clears the icon. */
  icon?: string;
  config?: IssuePropertyConfig;
  archived?: boolean;
}

export interface ListPropertiesResponse {
  properties: IssueProperty[];
  total: number;
}

/** Response of PUT/DELETE /api/issues/{id}/properties/{propertyId}: the full post-mutation bag. */
export interface IssuePropertiesResponse {
  properties: IssuePropertyValues;
}
