import { getLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";

import zh from "./locales/zh.json";
import en from "./locales/en.json";

const LOCALE_KEY = "multica_locale";

export type AppLocale = "zh" | "en";

export const SUPPORTED_LOCALES: AppLocale[] = ["zh", "en"];

/** Persisted app-locale override, or null if the user has not chosen one. */
async function getSavedLocale(): Promise<AppLocale | null> {
  try {
    const saved = await SecureStore.getItemAsync(LOCALE_KEY);
    return saved === "zh" || saved === "en" ? saved : null;
  } catch {
    return null;
  }
}

/** Export a device Locale language code ("zh"/"en"), falling back to "en". */
function deviceLanguage(): AppLocale {
  try {
    const locales = getLocales();
    const lang = locales?.[0]?.languageCode?.toLowerCase();
    return lang === "zh" || lang === "zh-Hans" || (lang ?? "").startsWith("zh")
      ? "zh"
      : "en";
  } catch {
    return "en";
  }
}

let ready: Promise<AppLocale> | null = null;

/** Test-only: clear the memoized init so each test resolves independently. */
export function resetI18nForTests(): void {
  ready = null;
  currentLocale = "en";
  savedLocale = null;
}

/** Load the effective app locale (persisted override, else device language)
 *  and make it available to React via the exported `t`-based API.
 *
 *  The JSON dictionaries are bundled at build time, so this is synchronous in
 *  practice; the async structure mirrors how i18next loads remote resources so
 *  the shape doesn't change if we later split per-locale files.
 */
export function initI18n(): Promise<AppLocale> {
  if (!ready) {
    ready = (async () => {
      const saved = await getSavedLocale();
      savedLocale = saved;
      const locale = saved ?? deviceLanguage();
      currentLocale = locale;
      // Mark both bundled dictionaries as referenced so bundlers keep them.
      void ({ ...zh, ...en });
      return locale;
    })();
  }
  return ready;
}

/** Resolution entry: an (id, locale) lookup that returns the localized string.
 *  Kept framework-agnostic and unit-testable; React binding adds a subscription
 *  to re-render on locale change.
 */
const DICTIONARIES: Record<AppLocale, Record<string, string>> = {
  zh: zh as Record<string, string>,
  en: en as Record<string, string>,
};

let currentLocale: AppLocale = "en";

/** In-memory copy of the persisted override ("en"/"zh"), or null when the
 *  user follows the device language. Populated by initI18n at startup and
 *  kept accurate by setLocale/resetLocale, so settings can read which of the
 *  three options is selected without an extra SecureStore round-trip. */
let savedLocale: AppLocale | null = null;

/** Fetch the currently effective locale (device default until set). */
export function getCurrentLocale(): AppLocale {
  return currentLocale;
}

/** The persisted locale override, or null when following the device. */
export function getSavedLocaleOverride(): AppLocale | null {
  return savedLocale;
}

/** Switch locale at runtime and persist the user's choice. */
export function setLocale(locale: AppLocale): void {
  currentLocale = locale;
  savedLocale = locale;
  void SecureStore.setItemAsync(LOCALE_KEY, locale);
  notifyLocaleChange();
}

/** Replace the effective locale with the device one and clear the choice. */
export async function resetLocale(): Promise<void> {
  currentLocale = deviceLanguage();
  savedLocale = null;
  await SecureStore.deleteItemAsync(LOCALE_KEY);
  notifyLocaleChange();
}

export function translate(id: string, params?: Record<string, string | number>): string {
  const dict = DICTIONARIES[currentLocale] ?? DICTIONARIES.en;
  let out = dict[id] ?? DICTIONARIES.en[id] ?? id;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      out = out.replaceAll(`{{${key}}}`, String(value));
    }
  }
  return out;
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeLocale(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyLocaleChange(): void {
  for (const listener of listeners) listener();
}