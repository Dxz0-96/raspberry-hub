// Numbers and dates written the way a person reads them, in the language of the page.
// The board drawing always uses "en": its labels are a silkscreen, and silkscreens are in English.

import type { Locale } from "./i18n";

const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: Locale, digits: number): Intl.NumberFormat {
  const key = `${locale}-${digits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    numberFormats.set(key, format);
  }
  return format;
}

/** 0.42 -> "0.4" in English, "0,4" in Italian; 11661 -> "11,661" / "11.661" with digits = 0 */
export function decimal(n: number, locale: Locale, digits = 1): string {
  return numberFormat(locale, digits).format(n);
}

/** 47244640256 -> { value: "44", unit: "GB" } */
export function bytes(count: number, locale: Locale): { value: string; unit: string } {
  const gb = count / 1024 ** 3;
  if (gb >= 10) return { value: decimal(gb, locale, 0), unit: "GB" };
  if (gb >= 1) return { value: decimal(gb, locale, 1), unit: "GB" };
  return { value: decimal(Math.round(count / 1024 ** 2), locale, 0), unit: "MB" };
}

export function bytesText(count: number, locale: Locale): string {
  const b = bytes(count, locale);
  return `${b.value} ${b.unit}`;
}

/** 166738 seconds -> "1 d 22 h" in English, "1 g 22 h" in Italian */
export function duration(seconds: number, locale: Locale): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} ${locale === "it" ? "g" : "d"} ${hours % 24} h`;
  if (hours > 0) return `${hours} h ${minutes % 60} min`;
  return `${Math.max(1, minutes)} min`;
}

/** "2026-08" -> "August 2026" / "agosto 2026" */
export function monthYear(edition: string | null | undefined, locale: Locale): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(edition ?? "");
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return date.toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "20261116" or "2026-11-16" -> "November 16" / "16 novembre" (and "1° novembre" for the first) */
export function dayMonth(text: string | null | undefined, locale: Locale): string | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(text ?? "");
  if (!m) return null;
  const day = Number(m[3]);
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, day));
  const written = date.toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: "UTC" });
  return locale === "it" && day === 1 ? written.replace(/^1\b/, "1°") : written;
}

/** Seconds since the epoch -> "19:05" (24-hour clock in both languages) */
export function clock(seconds: number, locale: Locale): string {
  return new Date(seconds * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** Seconds since the epoch -> "Nov 16" / "16 nov", in the browser's time zone like clock() */
export function shortDay(seconds: number, locale: Locale): string {
  return new Date(seconds * 1000).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/** A build date for the footer: "November 18, 2026" / "18 novembre 2026" */
export function longDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" });
}
