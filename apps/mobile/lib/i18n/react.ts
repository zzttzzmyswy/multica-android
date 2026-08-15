import { useCallback, useEffect, useState } from "react";
import {
  getCurrentLocale,
  initI18n,
  subscribeLocale,
  translate,
  type AppLocale,
} from "./index";

export interface UseTranslationResult {
  t: (id: string, params?: Record<string, string | number>) => string;
  locale: AppLocale;
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
  const [locale, setLocale] = useState<AppLocale>(getCurrentLocale());

  useEffect(() => {
    let active = true;
    void initI18n().then((resolved) => {
      if (active) setLocale(resolved);
    });
    const unsubscribe = subscribeLocale(() => {
      setLocale(getCurrentLocale());
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const t = useCallback(
    (id: string, params?: Record<string, string | number>) =>
      translate(id, params),
    // translate reads currentLocale which flows through the `locale` state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  return { t, locale };
}