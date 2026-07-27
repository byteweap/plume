import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { catalogs, type Locale } from "./catalog";
import { I18nContext, type I18nContextValue } from "./I18nContext";

const STORAGE_KEY = "plume.locale";

function getInitialLocale(): Locale {
  const storedLocale = window.localStorage.getItem(STORAGE_KEY);
  if (storedLocale === "zh-CN" || storedLocale === "en-US") {
    return storedLocale;
  }

  return window.navigator.language.toLowerCase().startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((nextLocale: Locale) => {
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    updateLocale(nextLocale);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key) => catalogs[locale][key],
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
