/**
 * Language-preference domain model for the settings page.
 *
 * Three user-facing options — follow device language ("system"), Simplified
 * Chinese, English — map to two concerns:
 *   - the persisted app-locale override (AppLocale | null) handled by lib/i18n
 *   - the server-facing `user.language` value ("zh-Hans" | "en" | null) sent
 *     via PATCH /api/me so the preference follows the account across devices.
 */
import type { AppLocale } from "./i18n";

export type LanguageOptionId = "system" | AppLocale;

export interface LanguageOption {
  id: LanguageOptionId;
  /** i18n key for the option label (translated in both locales). */
  labelKey: string;
  /** Value sent to PATCH /api/me; null means "follow client/device". */
  serverLanguage: string | null;
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { id: "system", labelKey: "settings.languageSystem", serverLanguage: null },
  { id: "zh", labelKey: "settings.languageZh", serverLanguage: "zh-Hans" },
  { id: "en", labelKey: "settings.languageEn", serverLanguage: "en" },
];

/** Map a preference to its PATCH /api/me language value. Unknown ids fall
 *  back to null so a stale/bogus id never reaches the server. */
export function serverLanguageFor(
  option: LanguageOptionId,
): string | null {
  return (
    LANGUAGE_OPTIONS.find((candidate) => candidate.id === option)
      ?.serverLanguage ?? null
  );
}

/** Map the persisted app-locale override back to the option to highlight:
 *  an explicit zh/en override selects that language, null (no override,
 *  after "follow system") selects the system option. */
export function languageOptionForSaved(
  saved: AppLocale | null,
): LanguageOptionId {
  return saved === "zh" || saved === "en" ? saved : "system";
}