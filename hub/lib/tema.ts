"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** "browser" = segue il tema del browser; "chiaro" e "scuro" lo forzano su questo dispositivo. */
export type SceltaTema = "browser" | "chiaro" | "scuro";

const CHIAVE = "tema";
const ascoltatori = new Set<() => void>();

function leggiScelta(): SceltaTema {
  try {
    const salvata = localStorage.getItem(CHIAVE);
    return salvata === "chiaro" || salvata === "scuro" ? salvata : "browser";
  } catch {
    return "browser";
  }
}

function applica(scelta: SceltaTema) {
  const radice = document.documentElement;
  if (scelta === "browser") delete radice.dataset.tema;
  else radice.dataset.tema = scelta;
  try {
    if (scelta === "browser") localStorage.removeItem(CHIAVE);
    else localStorage.setItem(CHIAVE, scelta);
  } catch {
    // archivio non disponibile (navigazione privata): il tema vale solo per questa visita
  }
  ascoltatori.forEach((avvisa) => avvisa());
}

function iscrivi(avvisa: () => void) {
  ascoltatori.add(avvisa);
  return () => {
    ascoltatori.delete(avvisa);
  };
}

export function useTema() {
  const scelta = useSyncExternalStore<SceltaTema>(iscrivi, leggiScelta, () => "browser");
  const [browserScuro, setBrowserScuro] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const aggiorna = () => setBrowserScuro(media.matches);
    aggiorna();
    media.addEventListener("change", aggiorna);
    return () => media.removeEventListener("change", aggiorna);
  }, []);

  const imposta = useCallback((nuova: SceltaTema) => {
    const fermo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const documento = document as Document & { startViewTransition?: (azione: () => void) => unknown };
    if (!fermo && typeof documento.startViewTransition === "function") {
      documento.startViewTransition(() => applica(nuova));
    } else {
      applica(nuova);
    }
  }, []);

  const scuro = scelta === "scuro" || (scelta === "browser" && browserScuro);
  return { scelta, scuro, imposta };
}
