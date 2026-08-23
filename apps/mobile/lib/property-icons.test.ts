/**
 * Tests for the property-icon catalog (MYS-675). Mirrors web's
 * PROPERTY_ICON_OPTIONS / PropertyIconGlyph in
 * packages/views/common/property-icon.tsx — the stable Lucide keys are
 * authoritative (server persists these strings), mapped here to Ionicons
 * glyphs. Unit-tested under vitest's node environment.
 */
import { describe, expect, it } from "vitest";
import {
  PROPERTY_ICON_FALLBACK,
  PROPERTY_ICON_OPTIONS,
  findPropertyIcon,
  propertyIconGlyph,
  propertyIconLabel,
} from "./property-icons";

// Copied verbatim from web's PROPERTY_ICON_OPTIONS values
// (packages/views/common/property-icon.tsx:59-96). The mobile catalog must
// match exactly — no extras, no omissions.
const WEB_PROPERTY_ICON_KEYS = [
  "circle-dot",
  "signal-high",
  "user-round",
  "folder-kanban",
  "calendar-days",
  "tag",
  "milestone",
  "flag",
  "bookmark",
  "star",
  "target",
  "shield",
  "bug",
  "zap",
  "rocket",
  "sparkles",
  "lightbulb",
  "globe-2",
  "link",
  "hash",
  "list-checks",
  "circle-check",
  "clock-3",
  "briefcase-business",
  "layers-3",
  "gauge",
  "database",
  "code-2",
  "palette",
  "megaphone",
  "map-pin",
  "package",
  "wrench",
  "heart",
  "circle-alert",
  "lock-keyhole",
] as const;

describe("property icon catalog", () => {
  it("exactly covers the web key set with no extras or omissions", () => {
    const values = PROPERTY_ICON_OPTIONS.map((o) => o.value);
    expect(new Set(values)).toEqual(new Set(WEB_PROPERTY_ICON_KEYS));
    expect(values.length).toBe(WEB_PROPERTY_ICON_KEYS.length);
  });

  it("every option has a label and a non-empty glyph", () => {
    for (const option of PROPERTY_ICON_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.glyph.length).toBeGreaterThan(0);
    }
  });

  it("option values are unique", () => {
    const values = PROPERTY_ICON_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("findPropertyIcon resolves known keys and misses unknown ones", () => {
    expect(findPropertyIcon("circle-dot")?.label).toBe("Status");
    expect(findPropertyIcon("lock-keyhole")?.label).toBe("Private");
    expect(findPropertyIcon("nope")).toBeUndefined();
    expect(findPropertyIcon(undefined)).toBeUndefined();
  });

  it("propertyIconGlyph maps known keys to the catalog glyph and falls back otherwise", () => {
    expect(propertyIconGlyph("circle-dot")).toBe(
      findPropertyIcon("circle-dot")?.glyph,
    );
    expect(propertyIconGlyph("lock-keyhole")).toBe(
      findPropertyIcon("lock-keyhole")?.glyph,
    );
    expect(propertyIconGlyph("unknown")).toBe(PROPERTY_ICON_FALLBACK);
    expect(propertyIconGlyph("")).toBe(PROPERTY_ICON_FALLBACK);
    expect(propertyIconGlyph(undefined)).toBe(PROPERTY_ICON_FALLBACK);
  });

  it("propertyIconLabel returns the semantic label for known keys only", () => {
    expect(propertyIconLabel("circle-dot")).toBe("Status");
    expect(propertyIconLabel("unknown")).toBeUndefined();
    expect(propertyIconLabel(undefined)).toBeUndefined();
    expect(propertyIconLabel("")).toBeUndefined();
  });
});