import { useCallback, useEffect, useState } from "react";
import {
  getCurrentLocale,
  getIntlLocale,
  initI18n,
  subscribeLocale,
  translate,
  type AppLocale,
} from "./index";

export interface UseTranslationResult {
  t: (id: string, params?: Record<string, string | number>) => string;
  locale: AppLocale;
}

/** Subscribes to the active app locale and returns it.
 *
 *  Cheaper than `useTranslation` for consumers that only need the locale (date
 *  formatting, number formatting) and render no translated string themselves.
 *  Switching the app language re-renders every mounted consumer.
 *
 *  Always re-read the store after `initI18n()` resolves instead of trusting its
 *  value: `initI18n` is memoized on first launch, so a screen mounting later —
 *  a formSheet route, say — gets the locale as it was at startup and would
 *  otherwise pin itself to a language the user has since changed. (`t()` is
 *  immune because it reads the store on every call; a hook that returns the
 *  locale is not.)
 */
export function useAppLocale(): AppLocale {
  const [locale, setLocale] = useState<AppLocale>(getCurrentLocale());

  useEffect(() => {
    let active = true;
    void initI18n().then(() => {
      if (active) setLocale(getCurrentLocale());
    });
    const unsubscribe = subscribeLocale(() => {
      setLocale(getCurrentLocale());
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return locale;
}

/** `useAppLocale` + the Intl tag mapping — for date/number formatters. */
export function useIntlLocale(): string {
  return getIntlLocale(useAppLocale());
}

/** React binding over the framework-agnostic i18n `translate` store.
 *
 *  - Subscribes to locale changes so switching the app language re-renders
 *    every mounted consumer (the hook forces an update by re-reading locale).
 *  - `initI18n()` ensures the device/persisted locale is loaded on the first
 *    render of a screen that opts in; it is idempotent and resolves to the
 *    effective locale.
 *  - `t(id, params)` returns the translated string or the raw id when the key
 *    is unknown, so missing keys degrade gracefully instead of crashing.
 */
export function useTranslation(): UseTranslationResult {
  const locale = useAppLocale();

  const t = useCallback(
    (id: string, params?: Record<string, string | number>) =>
      translate(id, params),
    // translate reads currentLocale which flows through the `locale` state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  return { t, locale };
}