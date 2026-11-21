"use client";

// The language of the hub, one of LOCALES (lib/messages/index.ts): the first of the browser's preferred
// languages that the hub speaks ("fr-CH" counts as "fr"), English if none. There is no switch in the hub: the
// language is chosen in the browser settings, and the page follows them when they change.
//
// The site is a static export rendered in English. An inline script in <head> (LANGUAGE_SCRIPT, run
// before the first paint) sets <html lang> and data-lang; for any language other than English the
// page stays hidden (globals.css) until React has switched the texts, so nobody sees English flash by.

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_LOCALE, LOCALE_CODES, isLocale, messagesFor, type Locale, type Messages } from "./messages";

export { LOCALES, type Locale } from "./messages";

/** Runs in <head> before the page is shown, and does what detect() below does. Versions up to 2.2 had EN / IT
 *  buttons that saved the choice under "language": it is removed, so the browser decides from now on. */
export const LANGUAGE_SCRIPT = `try{var d=document.documentElement,s=${JSON.stringify(LOCALE_CODES)},l="${DEFAULT_LOCALE}";
try{localStorage.removeItem("language")}catch(e){}
var n=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];
for(var i=0;i<n.length;i++){var c=String(n[i]||"").toLowerCase().split("-")[0];if(s.indexOf(c)>=0){l=c;break}}
d.lang=l;d.dataset.lang=l}catch(e){}`;

/** The first of the browser languages that the hub speaks, or the default. */
function detect(): Locale {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const language of languages) {
    const code = String(language || "").toLowerCase().split("-")[0];
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}

interface I18n {
  locale: Locale;
  t: Messages;
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
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  // Always from the browser, never from the attributes the head script set: when React reports a hydration
  // error it renders the page again and recreates <html> without them (it happens when the scripts of the page are
  // already cached, for example after the home page prefetched them).
  useIsomorphicLayoutEffect(() => {
    const wanted = detect();
    if (wanted !== locale) setLocale(wanted);
    // the languages were changed in the browser settings: follow them without a reload
    const changed = () => setLocale(detect());
    window.addEventListener("languagechange", changed);
    return () => window.removeEventListener("languagechange", changed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useIsomorphicLayoutEffect(() => {
    // the first render is the English of the static page: the page is ready once it shows the browser language
    if (locale !== detect()) return;
    const root = document.documentElement;
    root.lang = locale;
    root.dataset.lang = locale;
    root.dataset.i18n = "ready";
  }, [locale]);

  const value = useMemo<I18n>(() => ({ locale, t: messagesFor(locale) }), [locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The browser tab title in the page language: "Maps, raspberry", "Mappe, raspberry". React puts it in
 *  <head>; pages render it instead of a static metadata title, which would not follow the language. */
export function PageTitle({ page }: { page: keyof Messages["titles"] | null }) {
  const { t } = useI18n();
  return <title>{page ? `${t.titles[page]}, raspberry` : "raspberry"}</title>;
}
