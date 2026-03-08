import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enCommon from "./locales/en/common.json";
import enIdentity from "./locales/en/identity.json";
import enGame from "./locales/en/game.json";
import enAbout from "./locales/en/about.json";

import esCommon from "./locales/es/common.json";
import esIdentity from "./locales/es/identity.json";
import esGame from "./locales/es/game.json";
import esAbout from "./locales/es/about.json";

/** Languages supported by the app. */
export const supportedLanguages = {
  en: "English",
  es: "Español",
} as const;

export type SupportedLanguage = keyof typeof supportedLanguages;

const resources = {
  en: { common: enCommon, identity: enIdentity, game: enGame, about: enAbout },
  es: { common: esCommon, identity: esIdentity, game: esGame, about: esAbout },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: Object.keys(supportedLanguages),
    defaultNS: "common",
    ns: ["common", "identity", "game", "about"],
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      // Order matters: localStorage first (manual override), then browser prefs
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: "acars-language",
      caches: ["localStorage"],
    },
    react: {
      useSuspense: false,
    },
  });

/**
 * Keep the <html lang> attribute in sync with the current language.
 * This is necessary for accessibility (screen readers use it to determine
 * pronunciation rules) and for CSS :lang() selectors.
 */
function syncHtmlLang(lng: string) {
  const lang = lng.split("-")[0]; // "en-US" → "en"
  document.documentElement.lang = lang;
}

syncHtmlLang(i18n.language);
i18n.on("languageChanged", syncHtmlLang);

export default i18n;
