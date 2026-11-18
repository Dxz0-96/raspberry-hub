import type { Page } from "@playwright/test";

/** Fa credere all'hub che un servizio sia in un certo stato (spento, mancante...), senza toccare il finto Raspberry. */
export async function servizioIn(page: Page, id: string, stato: string) {
  await page.route("**/controllo/stato", async (route) => {
    const risposta = await route.fetch();
    const dati = await risposta.json();
    dati.servizi[id] = { ...dati.servizi[id], stato };
    await route.fulfill({ response: risposta, json: dati });
  });
}

/** La posizione della mappa scritta nell'indirizzo: #posizione=zoom/lat/lon */
export function posizione(url: string): { zoom: number; lat: number; lon: number } | null {
  const trovata = /posizione=([\d.]+)\/([\d.-]+)\/([\d.-]+)/.exec(decodeURIComponent(new URL(url).hash));
  return trovata ? { zoom: Number(trovata[1]), lat: Number(trovata[2]), lon: Number(trovata[3]) } : null;
}
