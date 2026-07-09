import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import ptBR from "./locales/pt-BR.json";

const STORAGE_KEY = "schedule-sentinel-language";

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "pt-BR", name: "Português (Brasil)" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE: SupportedLanguage = "pt-BR";

export function getStoredLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LANGUAGES.some((l) => l.code === stored)) {
    return stored as SupportedLanguage;
  }
  return DEFAULT_LANGUAGE;
}

export function setStoredLanguage(lang: SupportedLanguage): void {
  localStorage.setItem(STORAGE_KEY, lang);
}

export function initI18n() {
  const stored = getStoredLanguage();

  return i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: en },
        "pt-BR": { translation: ptBR },
      },
      lng: stored,
      fallbackLng: "pt-BR",
      supportedLngs: ["en", "pt-BR"],
      interpolation: {
        escapeValue: false,
      },
      detection: {
        order: ["localStorage", "navigator"],
        caches: ["localStorage"],
        lookupLocalStorage: STORAGE_KEY,
      },
    });
}
