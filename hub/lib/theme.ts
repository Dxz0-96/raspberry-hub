"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** "browser" follows the browser theme; "light" and "dark" force it on this device. */
export type ThemeChoice = "browser" | "light" | "dark";

const KEY = "theme";
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "browser";
  } catch {
    return "browser";
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "browser") delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === "browser") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // storage not available (private browsing): the theme lasts only for this visit
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function useTheme() {
  const choice = useSyncExternalStore<ThemeChoice>(subscribe, readChoice, () => "browser");
  const [browserDark, setBrowserDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setBrowserDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const set = useCallback((next: ThemeChoice) => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
    if (!still && typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => apply(next));
    } else {
      apply(next);
    }
  }, []);

  const dark = choice === "dark" || (choice === "browser" && browserDark);
  return { choice, dark, set };
}
