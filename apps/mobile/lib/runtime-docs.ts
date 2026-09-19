/**
 * Docs deep links for the runtime surfaces — mobile port of web
 * `packages/views/runtimes/components/runtime-docs.ts`. The docs site is
 * localized by path segment, so the app locale has to reach the URL or a zh
 * user lands on the English page.
 */
import type { AppLocale } from "./i18n";

function docsLocaleSegment(locale: AppLocale): string {
  return locale === "zh" ? "/zh" : "";
}

export function daemonRuntimesDocsHref(locale: AppLocale): string {
  return `https://multica.ai/docs${docsLocaleSegment(locale)}/daemon-runtimes`;
}
