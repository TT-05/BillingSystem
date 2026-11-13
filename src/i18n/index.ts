import i18n from 'i18next';
import type { TOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
export const LANGUAGE_KEY = 'settle-language';
export function initialLanguage(storage?: Pick<Storage, 'getItem'>): 'zh-CN' | 'en' {
  try {
    return storage?.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}
function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, 'zh-CN': { translation: zhCN } },
  lng: initialLanguage(storage()),
  fallbackLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en'],
  keySeparator: false,
  nsSeparator: false,
  initAsync: false,
  interpolation: { escapeValue: false },
});
function applyLanguage(language: string) {
  try {
    storage()?.setItem(LANGUAGE_KEY, language);
  } catch {
    /* In-memory switching still works. */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
    document.title =
      language === 'en' ? 'settle — Shared expenses, sorted.' : 'settle — 共享账本，轻松结算';
  }
}
i18n.on('languageChanged', applyLanguage);
applyLanguage(i18n.language);
export function t(key: string, options?: TOptions): string {
  return i18n.t(key, options ?? {});
}
export function locale(): string {
  return i18n.language === 'en' ? 'en-CA' : 'zh-CN';
}
export default i18n;
