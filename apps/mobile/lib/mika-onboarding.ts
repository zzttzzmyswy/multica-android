/**
 * Mika's onboarding payload — mobile port of
 * `packages/views/onboarding/templates/mika.ts` + `pickContentLang`
 * (`packages/views/onboarding/templates/index.ts:29-35`).
 *
 * Mika's name, description, avatar, permissions, and system instructions are
 * NOT here — they are server constants delivered by `POST /api/agents/mika`.
 * Keeping them out of the client is what lets Multica update Mika's prompt by
 * deploying, and stops a client from minting an agent that claims Mika's
 * identity.
 *
 * The chat title stays client-side: it names a session this member is opening,
 * in the language they are currently using.
 */
import type { MikaOnboardingLanguage } from "@multica/core/onboarding";
import type { AppLocale } from "./i18n";

export type MikaContentLang = MikaOnboardingLanguage;

export interface MikaOnboardingDefinition {
  title: string;
  language: MikaContentLang;
}

/**
 * The app ships two locales, both of which are valid Mika content languages,
 * so this is the identity function — spelled out rather than inlined because
 * it is the seam web's `pickContentLang` sits at, and because the app-locale
 * union (zh/en) is deliberately narrower than the content-language union
 * (en/zh/ko/ja). A third app locale must extend this, not silently send a
 * language the server has no opening text for.
 */
export function pickMikaContentLang(locale: AppLocale): MikaContentLang {
  return locale;
}

const MIKA_CHAT_TITLE: Record<MikaContentLang, string> = {
  en: "Getting started with Mika",
  zh: "和 Mika 开始",
  ko: "Mika와 시작하기",
  ja: "Mika と始める",
};

export function getMikaOnboarding(
  lang: MikaContentLang,
): MikaOnboardingDefinition {
  return { title: MIKA_CHAT_TITLE[lang], language: lang };
}
