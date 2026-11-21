// The languages of the hub. To add one: write its dictionary next to en.ts (same keys: TypeScript checks it),
// import it here and add one line to LOCALES. Everything else (the Locale type, the language detection before
// the first paint, the picker in the header, the map labels) follows this list.

import { de } from "./de";
import { en, type Messages } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { it } from "./it";

export type { Messages };

/** code: the primary language subtag (BCP 47, lower case), as browsers report it; name: in that language. */
export const LOCALES = [
  { code: "en", name: "English", messages: en },
  { code: "it", name: "Italiano", messages: it },
  { code: "es", name: "Español", messages: es },
  { code: "fr", name: "Français", messages: fr },
  { code: "de", name: "Deutsch", messages: de },
] as const satisfies readonly { code: string; name: string; messages: Messages }[];

export type Locale = (typeof LOCALES)[number]["code"];

/** The language the static pages are rendered in, and the one used when the browser asks for none of the above. */
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_CODES: readonly Locale[] = LOCALES.map((l) => l.code);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALE_CODES as readonly string[]).includes(value);
}

export function messagesFor(locale: Locale): Messages {
  return LOCALES.find((l) => l.code === locale)?.messages ?? en;
}
