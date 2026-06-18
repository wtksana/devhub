import { createContext, useMemo, type ReactNode } from "react";
import type { LanguageSetting } from "../features/settings/settingsTypes";
import { enUS } from "./locales/en-US";
import { zhCN } from "./locales/zh-CN";

export type TranslationKey = keyof typeof zhCN;
export type Dictionary = Record<TranslationKey, string>;

const dictionaries = {
  "zh-CN": zhCN,
  "en-US": enUS,
} as const;

export type Locale = keyof typeof dictionaries;

export interface I18nContextValue {
  locale: Locale;
  languageSetting: LanguageSetting;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  languageSetting: "system",
  t: (key, params) => interpolate(zhCN[key], params),
});

function resolveSystemLocale() {
  if (typeof navigator === "undefined") return "zh-CN";
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function resolveLocale(language: LanguageSetting | undefined): Locale {
  if (language === "system") return resolveSystemLocale();
  return language ?? resolveSystemLocale();
}

function interpolate(template: string, params: Record<string, string | number> = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) => String(params[key] ?? match));
}

export function I18nProvider({
  language,
  children,
}: {
  language?: LanguageSetting;
  children: ReactNode;
}) {
  const value = useMemo<I18nContextValue>(() => {
    const locale = resolveLocale(language);
    const dictionary = dictionaries[locale];

    return {
      locale,
      languageSetting: language ?? "system",
      t: (key, params) => interpolate(dictionary[key] ?? zhCN[key], params),
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
