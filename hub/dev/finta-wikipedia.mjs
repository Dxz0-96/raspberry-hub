// Una Wikipedia finta che risponde come kiwix-serve sotto /wiki: poche voci inventate, suggerimenti,
// ricerca nel testo (formato RSS/OpenSearch, con i numeri scritti "11,661" come fa Kiwix) e voce a caso.
// La usano il finto Raspberry (dev/mock-server.mjs) e i test Playwright.

const LIBRO = "wikipedia_it";
const CONTENUTO = `/wiki/content/${LIBRO}/`;
const PRINCIPALE = "Pagina_principale";

/** Le voci: percorso -> titolo e paragrafi (i collegamenti sono nomi di altre voci, come nell'archivio vero). */
const VOCI = {
  [PRINCIPALE]: {
    titolo: "Pagina principale",
    paragrafi: [
      'Benvenuti su Wikipedia, l\'enciclopedia libera. Da qui si arriva a <a href="Giuseppe_Garibaldi">Giuseppe Garibaldi</a>, a <a href="Roma">Roma</a> e a <a href="Galileo_Galilei">Galileo Galilei</a>.',
    ],
  },
  Giuseppe_Garibaldi: {
    titolo: "Giuseppe Garibaldi",
    paragrafi: [
      '<b>Giuseppe Garibaldi</b> (<a href="Nizza">Nizza</a>, 4 luglio 1807 – <a href="Caprera">Caprera</a>, 2 giugno 1882) è stato un generale e patriota italiano.',
      "È noto anche con l'appellativo di «Eroe dei due mondi» per le imprese militari compiute in Europa e in America meridionale.",
    ],
    lunga: true,
  },
  "Garibaldi_(disambigua)": {
    titolo: "Garibaldi (disambigua)",
    paragrafi: ['Il nome Garibaldi può riferirsi a <a href="Giuseppe_Garibaldi">Giuseppe Garibaldi</a> o a una via di <a href="Roma">Roma</a>.'],
  },
  Nizza: { titolo: "Nizza", paragrafi: ['Nizza è una città della Francia, dove nacque <a href="Giuseppe_Garibaldi">Giuseppe Garibaldi</a>.'] },
  Caprera: { titolo: "Caprera", paragrafi: ["Caprera è un'isola dell'arcipelago di La Maddalena."] },
  Roma: { titolo: "Roma", paragrafi: ["<b>Roma</b> è la capitale d'Italia.", 'Vi si trova una statua di <a href="Giuseppe_Garibaldi">Giuseppe Garibaldi</a> sul Gianicolo.'], lunga: true },
  Galileo_Galilei: { titolo: "Galileo Galilei", paragrafi: ["<b>Galileo Galilei</b> è stato un fisico, astronomo e filosofo italiano."] },
};

/** Un po' del CSS di Wikipedia: colori "Codex" con i temi giorno e notte, che l'hub deve sostituire. */
const CSS = `
html.skin-theme-clientpref-day { --background-color-base: #ffffff; --color-base: #202122; --color-progressive: #36c; }
html.skin-theme-clientpref-night { --background-color-base: #101418; --color-base: #eaecf0; --color-progressive: #88a3e8; }
html, body { margin: 0; background: var(--background-color-base); color: var(--color-base); font-family: serif; }
.mw-page-container { min-height: 100%; padding: 0 24px; }
a { color: var(--color-progressive); }
`;

function pagina(percorso) {
  const voce = VOCI[percorso] ?? { titolo: percorso.replaceAll("_", " "), paragrafi: [`Voce di prova «${percorso.replaceAll("_", " ")}».`] };
  // le voci "lunghe" superano di molto l'altezza della finestra: servono a provare che la cornice si allunga
  const testo = voce.lunga ? [...voce.paragrafi, ...Array.from({ length: 60 }, (_, i) => `Paragrafo di riempimento numero ${i + 1}.`)] : voce.paragrafi;
  return `<!DOCTYPE html>
<html class="client-nojs vector-feature-limited-width-clientpref-1 skin-theme-clientpref-day" lang="it">
<head><meta charset="utf-8"><title>${voce.titolo}</title><style>${CSS}</style></head>
<body class="skin-vector skin-vector-2022 mediawiki">
<div class="mw-page-container"><div class="mw-page-container-inner"><div class="mw-content-container">
<main class="mw-body">
<header class="mw-body-header vector-page-titlebar"><h1 id="firstHeading" class="firstHeading mw-first-heading">${voce.titolo}</h1></header>
<div class="vector-body"><div id="mw-content-text" class="mw-body-content"><div class="mw-parser-output">
${testo.map((p) => `<p>${p}</p>`).join("\n")}
</div></div></div>
</main></div></div></div>
</body></html>`;
}

const xml = (t) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const migliaia = (n) => n.toLocaleString("en-US"); // Kiwix: "11,661"

/** Risultati della ricerca nel testo: le voci che contengono le parole, poi (per "garibaldi") molte voci generate. */
function cerca(domanda) {
  const parole = domanda.toLowerCase().split(/\s+/).filter(Boolean);
  const trovate = Object.entries(VOCI)
    .filter(([, v]) => parole.every((p) => `${v.titolo} ${v.paragrafi.join(" ")}`.toLowerCase().includes(p)))
    .map(([percorso, v]) => ({ percorso, titolo: v.titolo, estratto: v.paragrafi.join(" ").replace(/<[^>]+>/g, ""), parole: 1067 }));
  if (parole.includes("garibaldi")) {
    for (let i = trovate.length; i < 11661; i++) {
      trovate.push({ percorso: `Garibaldi_${i}`, titolo: `Garibaldi ${i}`, estratto: `Una voce che cita Garibaldi, numero ${i}.`, parole: 120 + i });
    }
  }
  return trovate;
}

function rispondi(res, codice, tipo, corpo, extra = {}) {
  const dati = Buffer.from(corpo);
  res.writeHead(codice, { "Content-Type": tipo, "Content-Length": dati.length, ...extra });
  res.end(dati);
}

/** Risponde alle richieste /wiki/... come kiwix-serve; restituisce false se la richiesta non e' sua. */
export function wikipediaFinta(req, res, url) {
  const p = url.pathname;
  if (p === "/wiki/suggest") {
    const termine = (url.searchParams.get("term") ?? "").toLowerCase();
    const quanti = Number(url.searchParams.get("count") ?? 10);
    const voci = Object.entries(VOCI)
      .filter(([, v]) => v.titolo.toLowerCase().split(/[\s()]+/).some((parola) => parola.startsWith(termine)))
      .slice(0, quanti)
      .map(([percorso, v]) => ({ value: v.titolo, label: v.titolo, kind: "path", path: percorso }));
    voci.push({ value: `${termine} `, label: `contenenti '${termine}'...`, kind: "pattern" });
    rispondi(res, 200, "application/json; charset=utf-8", JSON.stringify(voci));
    return true;
  }
  if (p === "/wiki/search") {
    const domanda = url.searchParams.get("pattern") ?? "";
    const inizio = Math.max(1, Number(url.searchParams.get("start") ?? 1));
    const quanti = Number(url.searchParams.get("pageLength") ?? 25);
    const tutte = cerca(domanda);
    const pagina = tutte.slice(inizio - 1, inizio - 1 + quanti);
    const corpo = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Search: ${xml(domanda)}</title>
    <opensearch:totalResults>${migliaia(tutte.length)}</opensearch:totalResults>
    <opensearch:startIndex>${inizio}</opensearch:startIndex>
    <opensearch:itemsPerPage>${quanti}</opensearch:itemsPerPage>
${pagina
  .map(
    (r) => `    <item>
      <title>${xml(r.titolo)}</title>
      <link>${CONTENUTO}${encodeURIComponent(r.percorso)}</link>
      <description>...${xml(r.estratto)}...</description>
      <book><title>Wikipedia</title></book>
      <wordCount>${migliaia(r.parole)}</wordCount>
    </item>`,
  )
  .join("\n")}
  </channel>
</rss>`;
    rispondi(res, 200, "application/rss+xml; charset=utf-8", corpo);
    return true;
  }
  if (p === "/wiki/random") {
    rispondi(res, 302, "text/plain", "", { Location: `${CONTENUTO}Roma` });
    return true;
  }
  if (p === CONTENUTO || p === CONTENUTO.slice(0, -1)) {
    rispondi(res, 302, "text/plain", "", { Location: `${CONTENUTO}${PRINCIPALE}` });
    return true;
  }
  if (p.startsWith(CONTENUTO)) {
    const percorso = decodeURIComponent(p.slice(CONTENUTO.length));
    rispondi(res, 200, "text/html; charset=utf-8", pagina(percorso));
    return true;
  }
  return false;
}
