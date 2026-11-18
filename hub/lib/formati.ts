// Numeri e date scritti come li legge una persona.

const MESI = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

/** 47244640256 -> { valore: "44", unita: "GB" } */
export function peso(byte: number): { valore: string; unita: string } {
  const gb = byte / 1024 ** 3;
  if (gb >= 10) return { valore: gb.toFixed(0), unita: "GB" };
  if (gb >= 1) return { valore: gb.toFixed(1).replace(".", ","), unita: "GB" };
  return { valore: Math.round(byte / 1024 ** 2).toString(), unita: "MB" };
}

export function pesoTesto(byte: number): string {
  const p = peso(byte);
  return `${p.valore} ${p.unita}`;
}

/** Come sopra ma con il punto decimale: per le scritte in inglese sulla scheda. */
export function pesoInglese(byte: number): { valore: string; unita: string } {
  const p = peso(byte);
  return { valore: p.valore.replace(",", "."), unita: p.unita };
}

/** bit al secondo -> { valore: "1.2", unita: "Mbit/s" } */
export function velocita(bps: number, virgola = false): { valore: string; unita: string } {
  const formato = (n: number, cifre: number) => {
    const testo = n.toFixed(cifre);
    return virgola ? testo.replace(".", ",") : testo;
  };
  if (bps >= 1_000_000) return { valore: formato(bps / 1_000_000, bps >= 10_000_000 ? 0 : 1), unita: "Mbit/s" };
  if (bps >= 1_000) return { valore: formato(bps / 1_000, 0), unita: "kbit/s" };
  return { valore: "0", unita: "kbit/s" };
}

/** 166738 secondi -> "1 g 22 h" */
export function durata(secondi: number): string {
  const minuti = Math.floor(secondi / 60);
  const ore = Math.floor(minuti / 60);
  const giorni = Math.floor(ore / 24);
  if (giorni > 0) return `${giorni} g ${ore % 24} h`;
  if (ore > 0) return `${ore} h ${minuti % 60} min`;
  return `${Math.max(1, minuti)} min`;
}

/** Per la serigrafia della scheda: "1 d 22 h" */
export function durataInglese(secondi: number): string {
  const minuti = Math.floor(secondi / 60);
  const ore = Math.floor(minuti / 60);
  const giorni = Math.floor(ore / 24);
  if (giorni > 0) return `${giorni} d ${ore % 24} h`;
  if (ore > 0) return `${ore} h ${minuti % 60} min`;
  return `${Math.max(1, minuti)} min`;
}

/** "2026-08" -> "agosto 2026" */
export function meseAnno(edizione: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(edizione ?? "");
  if (!m) return null;
  return `${MESI[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** "20261116" oppure "2026-11-16" -> "16 novembre" */
export function giornoMese(data: string | null | undefined): string | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(data ?? "");
  if (!m) return null;
  const giorno = Number(m[3]);
  return `${giorno === 1 ? "1°" : giorno} ${MESI[Number(m[2]) - 1] ?? m[2]}`;
}

/** Secondi dall'epoca -> "19:05" */
export function ora(secondi: number): string {
  return new Date(secondi * 1000).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

export function percento(n: number): string {
  return `${Math.round(n)}%`;
}

/** 0.42 -> "0,42" */
export function decimale(n: number, cifre = 1): string {
  return n.toFixed(cifre).replace(".", ",");
}
