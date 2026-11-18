// Scarica nel sito i caratteri e le icone che servono alla mappa, cosi' l'hub non chiede
// nulla a internet quando e' in uso. Va lanciato sul PC prima della build: npm run assets
//
// Origine: https://github.com/protomaps/basemaps-assets (gli stessi file usati dallo stile Protomaps).
// Intervalli di caratteri: latino, greco e cirillico per l'Italia e i paesi vicini; arabo e tifinagh per i
// nomi delle località sulla costa africana che rientrano nel riquadro delle mappe.
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ORIGINE = "https://protomaps.github.io/basemaps-assets";
const DESTINAZIONE = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "map-assets");
const CARATTERI = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
const INTERVALLI = [
  0, 256, 512, 768, 1024, 1280, 1536, 1792, 7680, 7936, 8192, 8448, 8704, 11520, 64256, 64512, 64768, 65024, 65280,
];
const TEMI = ["light", "dark"];

const file = [];
for (const carattere of CARATTERI) {
  for (const inizio of INTERVALLI) file.push(`fonts/${carattere}/${inizio}-${inizio + 255}.pbf`);
}
for (const tema of TEMI) {
  for (const suffisso of ["", "@2x"]) {
    file.push(`sprites/v4/${tema}${suffisso}.json`, `sprites/v4/${tema}${suffisso}.png`);
  }
}

async function esiste(percorso) {
  try {
    await access(percorso);
    return true;
  } catch {
    return false;
  }
}

let scaricati = 0;
let presenti = 0;
let peso = 0;
const mancanti = [];
async function scarica(relativo) {
  const destinazione = join(DESTINAZIONE, relativo);
  if (await esiste(destinazione)) {
    presenti++;
    return;
  }
  const risposta = await fetch(`${ORIGINE}/${relativo.split("/").map(encodeURIComponent).join("/")}`);
  if (risposta.status === 404 && relativo.startsWith("fonts/")) {
    mancanti.push(relativo);                 // il carattere non ha simboli in quell'intervallo
    return;
  }
  if (!risposta.ok) throw new Error(`${relativo}: risposta ${risposta.status}`);
  const dati = Buffer.from(await risposta.arrayBuffer());
  await mkdir(dirname(destinazione), { recursive: true });
  await writeFile(destinazione, dati);
  scaricati++;
  peso += dati.length;
}

const coda = [...file];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (coda.length) await scarica(coda.shift());
  }),
);
console.log(
  `Risorse della mappa: ${scaricati} scaricate (${(peso / 1048576).toFixed(1)} MB), ${presenti} gia' presenti, ` +
    `${mancanti.length} intervalli senza simboli, in public/map-assets`,
);
