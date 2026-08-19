/**
 * Pure timezone helpers for the settings preferences picker. Mirrors web's
 * packages/views/common/timezone-select.tsx (list construction + fallback) and
 * use-viewing-timezone.ts (resolve semantics), plus the DST-aware GMT-offset
 * labels from packages/views/autopilots/components/pickers/timezone-picker.tsx.
 */
import {
  COMMON_TIMEZONES,
  browserTimezone as detectBrowserTimezone,
} from "@/lib/autopilot-trigger-form";

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

/** The runtime's own zone (e.g. device zone in the app), or null. */
export function browserTimezone(): string | null {
  return detectBrowserTimezone();
}

/** IANA id → trailing city label, "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function cityLabel(tz: string): string {
  if (tz === "UTC") return "UTC";
  const city = tz.split("/").pop();
  return city ? city.replace(/_/g, " ") : tz;
}

/** GMT offset of a zone right now, DST-aware ("GMT+8", "GMT-7"); "" when unknown. */
export function tzOffset(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** "GMT+8 Asia/Shanghai"; "UTC"; the bare id when the offset cannot be computed. */
export function timezoneLabel(tz: string): string {
  if (!tz) return tz;
  if (tz === "UTC") return "UTC";
  const offset = tzOffset(tz);
  if (!offset) return tz;
  return `${offset} ${tz}`;
}

function supportedTimezones(): string[] {
  try {
    const supported = (Intl as IntlWithSupportedValues).supportedValuesOf?.(
      "timeZone",
    );
    return supported && supported.length > 0 ? [...supported] : [...COMMON_TIMEZONES];
  } catch {
    return [...COMMON_TIMEZONES];
  }
}

/**
 * Full selectable list: the current value and the device zone pinned first,
 * then the curated common zones, then the whole IANA list. Deduped, preserving
 * that order (web timezoneOptions semantics). Falls back to the curated list
 * when the runtime lacks Intl.supportedValuesOf.
 */
export function timezoneOptions(preferred?: string | null): string[] {
  const effective =
    preferred && preferred.trim().length > 0 ? preferred.trim() : null;
  const device = browserTimezone();
  return Array.from(
    new Set([
      ...(effective ? [effective] : []),
      ...(device ? [device] : []),
      ...COMMON_TIMEZONES,
      ...supportedTimezones(),
    ]),
  ).filter((z): z is string => typeof z === "string" && z.length > 0);
}

/** Effective viewing zone: the stored preference wins, else the device zone. */
export function resolveViewingTimezone(
  user: { timezone?: string | null } | null | undefined,
): string {
  const stored = user?.timezone;
  if (stored && stored.trim() !== "") return stored.trim();
  return browserTimezone() ?? "UTC";
}