/**
 * i18n initialization (Phase: AODA French scaffolding).
 *
 * Bootstraps i18next + react-i18next with two locales (en, fr) and a browser-
 * language detector that persists the user's choice in localStorage. The
 * accessibility statement flagged French as a known limitation; this module
 * closes that gap with infrastructure that future copy can register against.
 *
 * Why imported at the top of main.tsx (not lazy-loaded):
 *   - The FIRST paint is the login screen, which is itself one of the
 *     translated surfaces. Lazy-loading i18n would force the first paint to
 *     render in default language and then flash to the user's chosen one.
 *   - The bundle cost (~10 KB gzip) is unavoidable for the feature.
 *
 * Bundle/perf notes:
 *   - Resources are bundled at compile-time, not fetched at runtime. Vite's
 *     tree-shaker keeps unused locales out if we ever code-split per locale;
 *     for now both ship together because the toggle is one-click and we want
 *     instant switching.
 *   - `react: { useSuspense: false }` is set so a missing key doesn't throw
 *     Suspense (would be confusing inside our existing Suspense boundaries).
 *
 * Strings model:
 *   - One namespace ('common') for the whole app right now — small surface
 *     and a single-file overview is easier to translate. Split per-feature
 *     once the file grows past ~100 keys.
 *   - Keys are dotted, mirror the source file's purpose
 *     (e.g. `login.submit.signin`, `accessibility.commitment.body`).
 */
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  fr: 'Français',
};

// localStorage key — namespaced with the app prefix so it doesn't collide
// with any other tenant on the domain.
const STORAGE_KEY = 'familyhq.language';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en },
      fr: { common: fr },
    },
    defaultNS: 'common',
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    // Reject any locale that isn't in our list — guards against `?lng=xx`
    // tampering, browser locales we haven't translated, etc.
    nonExplicitSupportedLngs: false,
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: STORAGE_KEY,
    },
    interpolation: {
      // React already escapes — disabling i18next's escape avoids double-
      // escaping HTML entities in plain-text strings.
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
