"use client";

// The language of the hub: English or Italian. The choice is per device (like the theme): saved in
// localStorage when someone picks a language, otherwise taken from the browser languages.
//
// The site is a static export rendered in English. An inline script in <head> (LANGUAGE_SCRIPT, run
// before the first paint) sets <html lang> and data-lang; for any language other than English the
// page stays hidden (globals.css) until React has switched the texts, so nobody sees English flash by.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en, type Messages } from "./messages/en";
import { it } from "./messages/it";

export type Locale = "en" | "it";
export const LOCALES: { code: Locale; name: string }[] = [
  { code: "en", name: "English" },
  { code: "it", name: "Italiano" },
];
const MESSAGES: Record<Locale, Messages> = { en, it };
const KEY = "language";

/** Runs in <head> before the page is shown: stored choice, otherwise the first supported browser language. */
export const LANGUAGE_SCRIPT = `try{var d=document.documentElement,l=null;try{l=localStorage.getItem("${KEY}")}catch(e){}
if(l!=="en"&&l!=="it"){l="en";var n=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];
for(var i=0;i<n.length;i++){var c=String(n[i]||"").slice(0,2).toLowerCase();if(c==="en"||c==="it"){l=c;break}}}
d.lang=l;d.dataset.lang=l}catch(e){}`;

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "it";
}

interface I18n {
  locale: Locale;
  t: Messages;
  setLocale: (locale: Locale) => void;
}

const Context = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const i18n = useContext(Context);
  if (!i18n) throw new Error("useI18n must be used inside <I18nProvider>");
  return i18n;
}

// useLayoutEffect warns during the static build, where there is no document; useEffect is fine there.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function I18nProvider({ children }: { children: ReactNode }) {
  // Same as the static HTML for hydration; switched before the first paint by the effect below.
  const [locale, setLocaleState] = useState<Locale>("en");

  useIsomorphicLayoutEffect(() => {
    const detected = document.documentElement.dataset.lang;
    if (isLocale(detected) && detected !== locale) setLocaleState(detected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement;
    if (root.dataset.lang === locale || !isLocale(root.dataset.lang)) {
      root.lang = locale;
      root.dataset.lang = locale;
      root.dataset.i18n = "ready";
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // storage not available (private browsing): the language lasts only for this visit
    }
    document.documentElement.dataset.lang = next;
    setLocaleState(next);
  }, []);

  const value = useMemo<I18n>(() => ({ locale, t: MESSAGES[locale], setLocale }), [locale, setLocale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The browser tab title in the page language: "Maps, raspberry" / "Mappe, raspberry". React puts it in
 *  <head>; pages render it instead of a static metadata title, which would not follow the language. */
export function PageTitle({ page }: { page: keyof Messages["titles"] | null }) {
  const { t } = useI18n();
  return <title>{page ? `${t.titles[page]}, raspberry` : "raspberry"}</title>;
}
