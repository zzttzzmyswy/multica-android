/**
 * Pure helpers for workspace custom issue properties (MYS-334). No React /
 * RN imports — unit-tested under vitest's node environment.
 *
 * Mirrors web's semantics in packages/views/issues/components/pickers/
 * custom-property-picker.tsx (CustomPropertyValueDisplay) and
 * packages/views/settings/components/properties-tab.tsx: option ids resolve
 * to named, colored chips; unknown ids (option deleted from the definition)
 * drop out instead of rendering raw UUIDs; `type` stays a lenient string so
 * newer server types degrade to a plain-text value rather than crashing.
 */
import type {
  IssueProperty,
  IssuePropertyOption,
  IssuePropertyType,
  IssuePropertyValue,
} from "@multica/core/types";
import {
  ISSUE_PROPERTY_TYPES,
  MAX_ISSUE_PROPERTY_ACTOR_VALUES,
  actorRefValuesFromValue,
  actorRefsFromValue,
  type IssuePropertyActorRef,
} from "@multica/core/types";
import { formatIssueDate } from "./format-date";

export const PROPERTY_TYPE_ICONS = {
  text: "text",
  number: "calculator-outline",
  select: "chevron-down-circle",
  multi_select: "checkbox",
  date: "calendar",
  checkbox: "checkbox-outline",
  url: "link",
  // Both actor types hold workspace members; the person glyph keeps them
  // distinguishable from `url`'s link and the unknown-type cube.
  actor: "person-outline",
  multi_actor: "people-outline",
} as const satisfies Record<IssuePropertyType, string>;

/** Unknown-type fallback glyph (newer server types). */
export const UNKNOWN_PROPERTY_TYPE_ICON = "cube-outline" as const;

export type PropertyTypeGlyph =
  | (typeof PROPERTY_TYPE_ICONS)[IssuePropertyType]
  | typeof UNKNOWN_PROPERTY_TYPE_ICON;

export function isKnownPropertyType(type: string | undefined): type is IssuePropertyType {
  return !!type && (ISSUE_PROPERTY_TYPES as string[]).includes(type);
}

/** select / multi_select carry a config.options list; everything else doesn't. */
export function propertyTypeHasOptions(type: string | undefined): boolean {
  return type === "select" || type === "multi_select";
}

/**
 * Ionicons glyph name for a property type. Unknown types (or missing type)
 * fall back to a neutral cube so the UI never renders a blank icon.
 */
export function propertyTypeIcon(type: string | undefined): PropertyTypeGlyph {
  if (isKnownPropertyType(type)) return PROPERTY_TYPE_ICONS[type];
  return UNKNOWN_PROPERTY_TYPE_ICON;
}

function typeLabelKeyInternal(type: string): string {
  if (isKnownPropertyType(type)) return `properties.type.${type}`;
  return "properties.type.unknown";
}

/**
 * i18n key for a property type's display name. The property management page
 * calls translate() with the result; unknown types resolve to a generic key
 * so forward-compatible reads stay readable.
 */
export function propertyTypeLabelKey(type: string | undefined): string {
  return typeLabelKeyInternal(type ?? "");
}

export function propertyOptions(property: IssueProperty): IssuePropertyOption[] {
  return property.config?.options ?? [];
}

export function findSelectOption(
  property: IssueProperty,
  optionId: IssuePropertyValue | undefined,
): IssuePropertyOption | undefined {
  if (typeof optionId !== "string") return undefined;
  return propertyOptions(property).find((o) => o.id === optionId);
}

/** multi_select bag (array of option ids) resolved to known option rows. */
export function resolveMultiSelectOptions(
  property: IssueProperty,
  value: IssuePropertyValue | undefined,
): IssuePropertyOption[] {
  if (!Array.isArray(value)) return [];
  return propertyOptions(property).filter((o) => value.includes(o.id));
}

export type PropertyValueDisplay =
  | { kind: "option"; option: IssuePropertyOption }
  | { kind: "options"; options: IssuePropertyOption[] }
  | { kind: "checkbox"; value: boolean }
  | { kind: "date"; text: string }
  | { kind: "actors"; refs: IssuePropertyActorRef[] }
  | { kind: "unknownActors" }
  | { kind: "plain"; text: string };

/**
 * Format a raw stored value into a display shape the UI can render precisely
 * per type (colored dot for select, chips for multi_select, checked text for
 * checkbox, formatted day for date, avatar rows for actor/multi_actor).
 * Returns null when there is nothing worth showing: unset value,
 * select/multi_select id that no longer exists (its option was deleted), or a
 * date that doesn't parse.
 *
 * `unknownActors` is NOT null on purpose. A value whose every reference this
 * build cannot parse (a newer backend widening `actorPropertyKinds`) must
 * render as unavailable rather than empty: rendering it as empty invites the
 * user to fill in a field that already holds a value they cannot see, and for
 * the single-valued `actor` type that overwrite is silent data loss.
 * `hasUnknownActorRef` names the same condition for edit gating.
 */
export function formatPropertyValue(
  property: IssueProperty,
  value: IssuePropertyValue | undefined,
): PropertyValueDisplay | null {
  if (value === undefined) return null;
  switch (property.type) {
    case "select": {
      const option = findSelectOption(property, value);
      return option ? { kind: "option", option } : null;
    }
    case "multi_select": {
      const options = resolveMultiSelectOptions(property, value);
      return options.length > 0 ? { kind: "options", options } : null;
    }
    case "actor":
    case "multi_actor": {
      const refs = actorRefsFromValue(value);
      if (refs.length === 0) {
        // Nothing parsed. Only distinguish "unreadable" from "unset" when a
        // raw string is actually present.
        return actorRefValuesFromValue(value).length > 0
          ? { kind: "unknownActors" }
          : null;
      }
      return { kind: "actors", refs };
    }
    case "checkbox":
      return { kind: "checkbox", value: value === true };
    case "date": {
      if (typeof value !== "string") return null;
      const text = formatIssueDate(value);
      return text ? { kind: "date", text } : null;
    }
    default:
      return { kind: "plain", text: String(value) };
  }
}

/**
 * Toggles one member reference inside a `multi_actor` value and returns the
 * next value (`undefined` clears the property). Mirrors web's
 * `toggleActorRefValue` (`packages/views/issues/components/pickers/
 * actor-property-picker.tsx:36-50`).
 *
 * `current` must be the RAW stored list (`actorRefValuesFromValue`), not the
 * parsed refs: an entry whose kind this build cannot resolve has to survive
 * the toggle. Passing parsed refs would delete it, and the user would never
 * see the loss. Insertion order also survives — the server does not
 * canonicalize actor lists, so the order here is the order that persists.
 *
 * At the cap a further tick is a no-op rather than a silent eviction: dropping
 * the oldest entry would look like the picker ate a value the user chose.
 */
export function toggleActorRefValue(
  current: string[],
  key: string,
): string[] | undefined {
  if (current.includes(key)) {
    const next = current.filter((existing) => existing !== key);
    return next.length === 0 ? undefined : next;
  }
  if (current.length >= MAX_ISSUE_PROPERTY_ACTOR_VALUES) return current;
  return [...current, key];
}

/** Tailwind bg-* swatch palette for select/multi_select option colors. */
export const PROPERTY_OPTION_COLOR_PRESETS = [
  "#6b7280",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
] as const;

export const DEFAULT_PROPERTY_OPTION_COLOR = PROPERTY_OPTION_COLOR_PRESETS[6];