/**
 * Pure helpers for the workspace property icon catalog (MYS-675). No React /
 * RN rendering — unit-tested under vitest's node environment.
 *
 * Mirrors web's `PROPERTY_ICON_OPTIONS` / `PropertyIconGlyph` in
 * packages/views/common/property-icon.tsx: the stable Lucide keys there are
 * authoritative (the server persists these strings, not SVG data or component
 * names), mapped here to visually equivalent Ionicons glyphs for React Native.
 * Keep the key set in lockstep with web — see property-icons.test.ts.
 */
import type { ComponentProps } from "react";
import type Ionicons from "@expo/vector-icons/Ionicons";

/** Ionicons glyph name accepted by the <Ionicons name="…" /> prop. */
export type IoniconGlyph = ComponentProps<typeof Ionicons>["name"];

export interface PropertyIconOption {
  value: string;
  label: string;
  glyph: IoniconGlyph;
}

/** Unknown/missing icon fallback (same neutral cube as property types). */
export const PROPERTY_ICON_FALLBACK = "cube-outline" as const;

export const PROPERTY_ICON_OPTIONS = [
  { value: "circle-dot", label: "Status", glyph: "ellipse" },
  { value: "signal-high", label: "Priority", glyph: "cellular" },
  { value: "user-round", label: "Assignee", glyph: "person" },
  { value: "folder-kanban", label: "Project", glyph: "folder" },
  { value: "calendar-days", label: "Date", glyph: "calendar" },
  { value: "tag", label: "Label", glyph: "pricetag" },
  { value: "milestone", label: "Milestone", glyph: "trail-sign" },
  { value: "flag", label: "Flag", glyph: "flag" },
  { value: "bookmark", label: "Bookmark", glyph: "bookmark" },
  { value: "star", label: "Star", glyph: "star" },
  { value: "target", label: "Target", glyph: "locate" },
  { value: "shield", label: "Shield", glyph: "shield-checkmark" },
  { value: "bug", label: "Bug", glyph: "bug" },
  { value: "zap", label: "Lightning", glyph: "flash" },
  { value: "rocket", label: "Rocket", glyph: "rocket" },
  { value: "sparkles", label: "Sparkles", glyph: "sparkles" },
  { value: "lightbulb", label: "Idea", glyph: "bulb" },
  { value: "globe-2", label: "Globe", glyph: "globe" },
  { value: "link", label: "Link", glyph: "link" },
  { value: "hash", label: "Number", glyph: "calculator" },
  { value: "list-checks", label: "Checklist", glyph: "list" },
  { value: "circle-check", label: "Complete", glyph: "checkmark-circle" },
  { value: "clock-3", label: "Time", glyph: "time" },
  { value: "briefcase-business", label: "Work", glyph: "briefcase" },
  { value: "layers-3", label: "Layers", glyph: "layers" },
  { value: "gauge", label: "Gauge", glyph: "speedometer" },
  { value: "database", label: "Database", glyph: "server" },
  { value: "code-2", label: "Code", glyph: "code-slash" },
  { value: "palette", label: "Design", glyph: "color-palette" },
  { value: "megaphone", label: "Announcement", glyph: "megaphone" },
  { value: "map-pin", label: "Location", glyph: "location" },
  { value: "package", label: "Package", glyph: "cube" },
  { value: "wrench", label: "Tools", glyph: "construct" },
  { value: "heart", label: "Favorite", glyph: "heart" },
  { value: "circle-alert", label: "Alert", glyph: "alert-circle" },
  { value: "lock-keyhole", label: "Private", glyph: "lock-closed" },
] as const satisfies readonly PropertyIconOption[];

export function findPropertyIcon(
  value: string | undefined,
): PropertyIconOption | undefined {
  return PROPERTY_ICON_OPTIONS.find((option) => option.value === value);
}

/**
 * Ionicons glyph for a property icon key. Unknown or missing keys fall back to
 * the neutral cube so the UI never renders a blank glyph (web falls back to a
 * similar neutral shape).
 */
export function propertyIconGlyph(value: string | undefined): IoniconGlyph {
  return findPropertyIcon(value)?.glyph ?? PROPERTY_ICON_FALLBACK;
}

/** Semantic English label for a known icon key (undefined for unknown). */
export function propertyIconLabel(value: string | undefined): string | undefined {
  return findPropertyIcon(value)?.label;
}