// Finto Raspberry per provare l'hub sul PC: risponde come hub-control.py, hub-search.py e Caddy,
// e serve il sito compilato (cartella out/). Nessun dato vero: tutto resta in memoria.
//
//   npm run build && npm run mock        poi apri http://localhost:8790
//   credenziali di prova: admin / prova1234
//   MOCK_TILES=percorso/di/un/file.pmtiles npm run mock    per provare anche la mappa
//   MOCK_PI=https://127.0.0.1:8443 MOCK_PI_CA=ca-di-casa.crt npm run mock
//       mappa e ricerca vere: /tiles e /cerca passano al Raspberry (per esempio attraverso
//       "ssh -L 8443:127.0.0.1:443 utente@indirizzo-del-raspberry"), verificandone il certificato di casa
//   MOCK_CERCA=http://127.0.0.1:8082   la ricerca va a un hub-search.py lanciato sul PC con un indice di prova
//   MOCK_SPENTI=wikipedia,mappe        servizi che partono spenti (predefinito: wikipedia; "" = tutti accesi)
// Senza MOCK_PI, /wiki risponde con una Wikipedia finta (dev/finta-wikipedia.mjs).
import { createServer, request as richiestaHttp } from "node:http";
import { request as richiestaHttps } from "node:https";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { wikipediaFinta } from "./finta-wikipedia.mjs";

const QUI = dirname(fileURLToPath(import.meta.url));
const SITO = join(QUI, "..", "out");
const ICONE = join(QUI, "..", "..", "pi", "icone");
const PORTA = Number(process.env.PORT ?? 8790);
const TILES = process.env.MOCK_TILES;
const PI = process.env.MOCK_PI ? new URL(process.env.MOCK_PI) : null;
const PI_CA = process.env.MOCK_PI_CA ? readFileSync(process.env.MOCK_PI_CA) : undefined;

/** Passa la richiesta al Raspberry vero, come se arrivasse a https://raspberry. */
function alRaspberry(req, res) {
  const inoltro = richiestaHttps(
    {
      host: PI.hostname,
      port: PI.port || 443,
      path: req.url,
      method: "GET",
      servername: "raspberry",
      ca: PI_CA,
      headers: { Host: "raspberry", ...(req.headers.range ? { Range: req.headers.range } : {}) },
    },
    (risposta) => {
      const tenute = {};
      for (const nome of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "location"]) {
        if (risposta.headers[nome]) tenute[nome] = risposta.headers[nome];
      }
      res.writeHead(risposta.statusCode ?? 502, tenute);
      risposta.pipe(res);
    },
  );
  inoltro.on("error", (errore) => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Raspberry non raggiungibile: ${errore.message}`);
  });
  inoltro.end();
}
const TIPI = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
  ".woff": "font/woff", ".pbf": "application/x-protobuf", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon",
};

let servizi = JSON.parse(readFileSync(join(QUI, "..", "..", "pi", "servizi.json"), "utf8")).servizi;
servizi.push({ id: "u-nas", nome: "NAS", descrizione: "Foto e documenti di casa", url: "http://192.168.1.20/", tipo: "link", aggiunto: true });
const icone = new Map();
const spenti = new Set((process.env.MOCK_SPENTI ?? "wikipedia").split(",").filter(Boolean));
let bloccoAttivo = true;
let password = "prova1234";
let errori = 0;
const sessioni = new Set();
const avvio = Date.now();

const storico = { recente: [], giorno: [] };
function onda(t, base, ampiezza) {
  return base + ampiezza * (0.5 + 0.5 * Math.sin(t / 380)) + (Math.sin(t / 47) + Math.sin(t / 13)) * ampiezza * 0.12;
}
{
  const adesso = Math.floor(Date.now() / 1000);
  for (let t = adesso - 3600; t <= adesso; t += 5) {
    const picco = t > adesso - 1500 && t < adesso - 1100 ? 70 : 0;
    storico.recente.push([t, Math.round((onda(t, 8, 14) + picco) * 10) / 10, Math.round((onda(t, 44, 6) + picco / 6) * 10) / 10]);
  }
  for (let t = adesso - 86400; t <= adesso; t += 60) {
    const picco = (t > adesso - 30000 && t < adesso - 28800) || (t > adesso - 1500 && t < adesso - 1100) ? 70 : 0;
    storico.giorno.push([t, Math.round((onda(t, 8, 12) + picco) * 10) / 10, Math.round((onda(t, 43, 7) + picco / 6) * 10) / 10, 28, 0.4]);
  }
}

function sistema() {
  const t = Date.now() / 1000;
  const cpu = Math.max(1, onda(t, 8, 14));
  return {
    ora: Math.round(t), nome: "raspberry", modello: "Raspberry Pi 3 Model B Rev 1.2", ip: "192.168.1.10",
    cpu: { uso: Math.round(cpu * 10) / 10, core: [cpu * 1.3, cpu * 0.7, cpu * 1.1, cpu * 0.9].map((v) => Math.round(v * 10) / 10),
      carico: [0.42, 0.31, 0.2], mhz: 1200, n: 4 },
    temp: Math.round(onda(t, 44, 6) * 10) / 10,
    mem: { totale: 948879360, usata: 262144000 + Math.round(Math.sin(t / 60) * 6e6), swap_totale: 947908608, swap_usata: 1572864 },
    disco: { totale: 125229338624, usato: 47244640256, pieno: 38.6, attivita: Math.random() > 0.5 ? 40960 : 0,
      contenuti: { wikipedia: 31e9, mappe: 4.7e9, indirizzi: 1.1e9 } },
    rete: { interfaccia: "eth0", giu: Math.round(1.2e6 + Math.sin(t / 9) * 4e5), su: Math.round(3e5 + Math.cos(t / 7) * 1e5), collegata: true, mbit: 100 },
    alimentazione: { sottotensione: false, rallentato: false, sottotensione_passata: false, rallentato_passato: false },
    acceso_da: 166738 + Math.round((Date.now() - avvio) / 1000),
    processi: [{ nome: "pihole-FTL", cpu: 3.1 }, { nome: "kiwix-serve", cpu: 1.4 }, { nome: "caddy", cpu: 0.6 }, { nome: "unbound", cpu: 0.3 }, { nome: "python3", cpu: 0.1 }],
    avvisi: process.env.MOCK_AVVISI ? process.env.MOCK_AVVISI.split(",") : [],
  };
}

function stati() {
  const esito = {};
  for (const s of servizi) {
    if (s.tipo === "pihole") esito[s.id] = { stato: bloccoAttivo ? "acceso" : "pausa", dettaglio: bloccoAttivo ? "Blocco attivo" : "Blocco in pausa", interruttore: true };
    else if (s.tipo === "unita") esito[s.id] = spenti.has(s.id) ? { stato: "spento", dettaglio: "Spento dall'hub", interruttore: true } : { stato: "acceso", dettaglio: "", interruttore: true };
    else if (s.id === "u-nas") esito[s.id] = { stato: "irraggiungibile", dettaglio: "Non risponde da 192.168.1.20", interruttore: false };
    else esito[s.id] = { stato: "acceso", dettaglio: "", interruttore: false };
  }
  const t = Date.now() / 1000;
  const visite = { pihole: Math.round(280 + 120 * Math.sin(t / 40)), wikipedia: 35, mappe: Math.round(60 + 60 * Math.sin(t / 25)), netmon: 2 };
  for (const [id, valore] of Object.entries(visite)) if (esito[id]) esito[id].attivita = valore;
  return esito;
}

function dns() {
  return {
    al_minuto: Math.round(280 + 120 * Math.sin(Date.now() / 40000)), totale: 27844, bloccate: 13559,
    percentuale_bloccate: 48.7, dalla_cache: 9667, inoltrate: 2347, client: 9, domini_bloccati: 756319,
    a_monte: { nome: "Quad9", cifrato: true },
  };
}

const LUOGHI = [
  { tipo: "luogo", nome: "Milano", dettaglio: "Città, Milano, Lombardia", lat: 45.4642, lon: 9.19, riquadro: [9.04, 45.386, 9.278, 45.536] },
  { tipo: "via", nome: "Via Giuseppe Garibaldi", dettaglio: "20121 Milano", lat: 45.4762, lon: 9.1854, riquadro: [9.184, 45.472, 9.187, 45.481] },
  { tipo: "civico", nome: "Via Giuseppe Garibaldi 12", dettaglio: "20121 Milano", lat: 45.4738, lon: 9.1851, riquadro: null, civico_esatto: true },
  { tipo: "luogo", nome: "Roma", dettaglio: "Città, Roma, Lazio", lat: 41.8933, lon: 12.4829, riquadro: [12.234, 41.655, 12.856, 42.141] },
  { tipo: "via", nome: "Via Toledo", dettaglio: "80132 Napoli", lat: 40.839, lon: 14.2484, riquadro: [14.247, 40.835, 14.25, 40.846] },
  { tipo: "via", nome: "Via Roma", dettaglio: "10121 Torino", lat: 45.0667, lon: 7.682, riquadro: [7.68, 45.062, 7.685, 45.071], civico_mancante: undefined },
];

function json(res, codice, corpo, extra = {}) {
  const dati = Buffer.from(JSON.stringify(corpo));
  res.writeHead(codice, { "Content-Type": "application/json; charset=utf-8", "Content-Length": dati.length, "Cache-Control": "no-store", ...extra });
  res.end(dati);
}
function corpo(req) {
  return new Promise((ok) => {
    const pezzi = [];
    req.on("data", (p) => pezzi.push(p));
    req.on("end", () => {
      try { ok(JSON.parse(Buffer.concat(pezzi).toString() || "{}")); } catch { ok({}); }
    });
  });
}
function sessione(req) {
  const gettone = /hub_sessione=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  return gettone && sessioni.has(gettone) ? gettone : null;
}
function file(res, percorso, codice = 200, req) {
  const stat = statSync(percorso);
  const tipo = TIPI[extname(percorso)] ?? "application/octet-stream";
  const intervallo = /bytes=(\d+)-(\d*)/.exec(req?.headers.range ?? "");
  if (intervallo) {
    const inizio = Number(intervallo[1]);
    const fine = intervallo[2] ? Math.min(Number(intervallo[2]), stat.size - 1) : stat.size - 1;
    res.writeHead(206, { "Content-Type": tipo, "Content-Range": `bytes ${inizio}-${fine}/${stat.size}`, "Content-Length": fine - inizio + 1, "Accept-Ranges": "bytes", ETag: `"${stat.mtimeMs}-${stat.size}"` });
    return createReadStream(percorso, { start: inizio, end: fine }).pipe(res);
  }
  res.writeHead(codice, { "Content-Type": tipo, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
  createReadStream(percorso).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);
  if (req.headers.origin) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hub, Range");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, ETag");
  }
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if (p === "/servizi.json") return json(res, 200, { servizi });
  if (p === "/status.json") {
    return json(res, 200, {
      aggiornato: new Date().toISOString(),
      wikipedia: { edizione: "2026-08", byte: 31e9, esito: "ok", in_corso: false },
      mappe: { build: "20261116", byte: 4.7e9, esito: "ok", in_corso: false },
      indirizzi: { dati: "2026-11-08", byte: 1.1e9, esito: "ok", in_corso: false },
    });
  }
  if (p === "/controllo/stato") return json(res, 200, { ora: Math.round(Date.now() / 1000), autenticato: Boolean(sessione(req)), utente: sessione(req) ? "admin" : null, configurato: process.env.MOCK_SENZA_PASSWORD !== "1", servizi: stati(), dns: dns() });
  if (p === "/controllo/sistema") return json(res, 200, sistema());
  if (p === "/controllo/sistema/storico") return json(res, 200, { recente: { passo: 5, punti: storico.recente }, giorno: { passo: 60, punti: storico.giorno } });

  if (process.env.MOCK_CERCA && (p === "/cerca" || p.startsWith("/cerca/"))) {
    const destinazione = new URL(req.url, process.env.MOCK_CERCA);
    const inoltro = richiestaHttp(destinazione, (risposta) => {
      res.writeHead(risposta.statusCode ?? 502, { "Content-Type": risposta.headers["content-type"] ?? "application/json" });
      risposta.pipe(res);
    });
    inoltro.on("error", () => json(res, 502, { errore: "ricerca_spenta" }));
    return inoltro.end();
  }
  if (PI && (p.startsWith("/tiles/") || p === "/cerca" || p.startsWith("/cerca/") || p === "/wiki" || p.startsWith("/wiki/"))) {
    return alRaspberry(req, res);
  }
  if (p === "/wiki" || p.startsWith("/wiki/")) {
    if (spenti.has("wikipedia")) return res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }).end("Wikipedia spenta dall'hub");
    if (wikipediaFinta(req, res, url)) return;
  }
  if (p === "/cerca") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const parole = q.split(/\s+/).filter(Boolean);
    const risultati = LUOGHI.filter((l) => parole.every((w) => `${l.nome} ${l.dettaglio}`.toLowerCase().includes(w)));
    return json(res, 200, { q, risultati, ms: 3 });
  }

  if (p.startsWith("/controllo/") && (req.method === "POST" || req.method === "DELETE")) {
    if (req.headers["x-hub"] !== "1") return json(res, 403, { errore: "richiesta_esterna", messaggio: "Richiesta non accettata." });
    const dati = await corpo(req);
    if (p === "/controllo/accesso") {
      if (dati.utente === "admin" && dati.password === password) {
        errori = 0;
        const gettone = randomBytes(16).toString("hex");
        sessioni.add(gettone);
        return json(res, 200, { ok: true, utente: "admin" }, { "Set-Cookie": `hub_sessione=${gettone}; Path=/controllo; Max-Age=34560000; HttpOnly; SameSite=Strict` });
      }
      errori++;
      if (errori >= 5) { errori = 0; return json(res, 429, { errore: "bloccato", messaggio: "Troppi tentativi. Riprova più tardi.", secondi: 300 }); }
      return json(res, 401, { errore: "credenziali", messaggio: "Utente o password non corretti.", tentativi_rimasti: 5 - errori });
    }
    if (p === "/controllo/uscita") { sessioni.delete(sessione(req)); return json(res, 200, { ok: true }); }
    if (!sessione(req)) return json(res, 401, { errore: "accesso_richiesto", messaggio: "Accedi per continuare." });
    if (p === "/controllo/password") {
      if (dati.attuale !== password) return json(res, 403, { errore: "password_attuale", messaggio: "La password attuale non è corretta." });
      if (String(dati.nuova ?? "").length < 8) return json(res, 400, { errore: "password_corta", messaggio: "La nuova password deve avere almeno 8 caratteri." });
      password = dati.nuova;
      return json(res, 200, { ok: true });
    }
    const interruttore = /^\/controllo\/servizi\/([a-z0-9-]+)\/interruttore$/.exec(p);
    if (interruttore) {
      await new Promise((ok) => setTimeout(ok, 500));
      if (interruttore[1] === "pihole") bloccoAttivo = Boolean(dati.acceso);
      else if (dati.acceso) spenti.delete(interruttore[1]);
      else spenti.add(interruttore[1]);
      return json(res, 200, { ok: true, servizi: stati() });
    }
    const uno = /^\/controllo\/servizi(?:\/([a-z0-9-]+))?$/.exec(p);
    if (uno && req.method === "DELETE") { servizi = servizi.filter((s) => s.id !== uno[1]); return json(res, 200, { ok: true }); }
    if (uno) {
      if (!dati.nome) return json(res, 400, { errore: "campo", messaggio: "Scrivi un nome di al massimo 40 caratteri." });
      const esistente = servizi.find((s) => s.id === uno[1]);
      const servizio = { ...(esistente ?? { id: `u-${randomBytes(4).toString("hex")}` }), nome: dati.nome, descrizione: dati.descrizione ?? "", url: dati.url, tipo: "link", aggiunto: true };
      if (dati.icona?.dati) { const nome = `${randomBytes(8).toString("hex")}.png`; icone.set(nome, Buffer.from(dati.icona.dati, "base64")); servizio.icona = `/icone/${nome}`; }
      servizi = esistente ? servizi.map((s) => (s.id === servizio.id ? servizio : s)) : [...servizi, servizio];
      return json(res, 200, { ok: true, servizio });
    }
    return json(res, 404, { errore: "non_trovato", messaggio: "Pagina non trovata." });
  }

  if (p.startsWith("/icone/")) {
    const nome = p.slice(7);
    if (icone.has(nome)) return res.writeHead(200, { "Content-Type": "image/png" }).end(icone.get(nome));
    const percorso = join(ICONE, normalize(nome).replace(/^(\.\.[/\\])+/, ""));
    if (existsSync(percorso)) return file(res, percorso, 200, req);
    return res.writeHead(404).end();
  }
  if (p === "/tiles/italia.pmtiles") {
    if (spenti.has("mappe")) return res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }).end("Mappe spente dall'hub");
    if (TILES && existsSync(TILES)) return file(res, TILES, 200, req);
    return res.writeHead(404).end();
  }

  // il sito compilato, come lo serve Caddy
  const relativo = normalize(p).replace(/^(\.\.[/\\])+/, "");
  for (const candidato of [join(SITO, relativo), join(SITO, relativo, "index.html"), join(SITO, `${relativo}.html`)]) {
    if (existsSync(candidato) && statSync(candidato).isFile()) return file(res, candidato, 200, req);
  }
  if (existsSync(join(SITO, "404.html"))) return file(res, join(SITO, "404.html"), 404, req);
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Sito non compilato: lancia prima npm run build");
}).listen(PORTA, () => console.log(`Finto Raspberry su http://localhost:${PORTA} (accesso di prova: admin / prova1234)`));
