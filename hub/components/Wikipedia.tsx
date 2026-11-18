"use client";

// Wikipedia offline nello stile dell'hub: ricerca con suggerimenti, risultati impaginati come l'hub e voci
// mostrate in un riquadro a cui si applicano tema (giorno/notte) e caratteri del progetto.
// I dati arrivano da kiwix-serve attraverso Caddy (/wiki/...): stessa origine, quindi l'hub può
// ritoccare lo stile delle voci (Kiwix le serve con "allow-same-origin").

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { House, Search, Shuffle, X } from "lucide-react";
import { BASE, useHub } from "@/lib/hub";
import { useTema } from "@/lib/tema";

const LIBRO = "wikipedia_it";
const CONTENUTO = `/wiki/content/${LIBRO}/`;
const PER_PAGINA = 20;

type Vista = { tipo: "voce"; percorso: string } | { tipo: "cerca"; domanda: string; da: number };

interface Suggerimento {
  value: string;
  kind: "path" | "pattern";
  path?: string;
}

interface Risultato {
  titolo: string;
  percorso: string;
  estratto: ReactNode[];
  parole: number | null;
}

/** La vista corrente sta nell'indirizzo: #voce=Roma oppure #cerca=garibaldi&da=20 */
function leggiVista(): Vista {
  const parametri = new URLSearchParams(window.location.hash.slice(1));
  const domanda = parametri.get("cerca");
  if (domanda) return { tipo: "cerca", domanda, da: Math.max(0, Number(parametri.get("da")) || 0) };
  return { tipo: "voce", percorso: parametri.get("voce") ?? "" };
}

function scriviVista(vista: Vista, sostituisci = false) {
  const parametri = new URLSearchParams();
  if (vista.tipo === "cerca") {
    parametri.set("cerca", vista.domanda);
    if (vista.da) parametri.set("da", String(vista.da));
  } else if (vista.percorso) {
    parametri.set("voce", vista.percorso);
  }
  const hash = parametri.toString() ? `#${parametri}` : window.location.pathname;
  if (sostituisci) window.history.replaceState(null, "", hash);
  else window.history.pushState(null, "", hash);
}

function indirizzoVoce(percorso: string): string {
  return BASE + CONTENUTO + percorso.split("/").map(encodeURIComponent).join("/");
}

/** Le regole @font-face di IBM Plex dell'hub, con indirizzi assoluti, da ripetere dentro la voce. */
function caratteriDelProgetto(): string {
  const regole: string[] = [];
  for (const foglio of Array.from(document.styleSheets)) {
    let elenco: CSSRuleList;
    try {
      elenco = foglio.cssRules;
    } catch {
      continue;
    }
    for (const regola of Array.from(elenco)) {
      if (regola instanceof CSSFontFaceRule && /IBM Plex/i.test(regola.style.getPropertyValue("font-family"))) {
        const base = foglio.href ?? window.location.href;
        regole.push(regola.cssText.replace(/url\(["']?([^"')]+)["']?\)/g, (_, u: string) => `url("${new URL(u, base).href}")`));
      }
    }
  }
  return regole.join("\n");
}

/**
 * Lo stile dell'hub dentro la voce: colori "Codex" di Wikipedia sostituiti con quelli del progetto,
 * fondo trasparente (sotto c'e' il pannello smerigliato dell'hub), IBM Plex e titoli come nel resto dell'hub.
 * La voce non scorre da sola: la cornice prende l'altezza del contenuto e scorre la pagina intera.
 */
function stileVoce(scuro: boolean, caratteri: string, principale: boolean): string {
  const c = scuro
    ? { testo: "#f3f5f1", testo2: "#a9b5ac", tenue: "rgba(243,245,241,0.06)", forte: "rgba(243,245,241,0.1)",
        bordo: "rgba(243,245,241,0.16)", link: "#d9a941", visitato: "#c79a3a", segno: "rgba(217,169,65,0.35)", fuoco: "#d9a941" }
    : { testo: "#16201a", testo2: "#4f5b54", tenue: "rgba(255,255,255,0.55)", forte: "rgba(122,86,16,0.07)",
        bordo: "rgba(22,32,26,0.14)", link: "#7a5610", visitato: "#5e4210", segno: "rgba(154,111,28,0.25)", fuoco: "#1f4d2b" };
  return `${caratteri}
:root { color-scheme: ${scuro ? "dark" : "light"}; }
html.skin-theme-clientpref-day, html.skin-theme-clientpref-night {
  --background-color-base: transparent !important;
  --background-color-neutral-subtle: ${c.tenue} !important;
  --background-color-neutral: ${c.forte} !important;
  --background-color-interactive-subtle: ${c.tenue} !important;
  --background-color-interactive: ${c.forte} !important;
  --color-base: ${c.testo} !important;
  --color-emphasized: ${c.testo} !important;
  --color-subtle: ${c.testo2} !important;
  --color-progressive: ${c.link} !important;
  --color-progressive--hover: ${c.link} !important;
  --color-progressive--active: ${c.link} !important;
  --color-visited: ${c.visitato} !important;
  --border-color-base: ${c.bordo} !important;
  --border-color-subtle: ${c.bordo} !important;
  --border-color-muted: ${c.bordo} !important;
}
html, body { height: auto !important; min-height: 0 !important; overflow: hidden !important; }
html, body, .mw-page-container, .mw-page-container-inner, .mw-content-container, .mw-body, .vector-body {
  background: transparent !important;
}
body { color: ${c.testo}; }
.mw-page-container { min-height: 0 !important; padding: 0 clamp(16px, 4vw, 40px) !important; }
.mw-body { padding-bottom: 8px !important; }
body, .mw-body, .mw-parser-output, .mw-body h1, .mw-body h2, .mw-body h3, .mw-body h4, .firstHeading, .mw-heading,
.mw-heading2 h2, .vector-body, .mw-body-content, input, button {
  font-family: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif !important;
}
.vector-body, .mw-body-content { font-size: 1rem; line-height: 1.65; }
.mw-body h1.firstHeading, .mw-first-heading {
  font-size: clamp(1.75rem, 1.4rem + 1.6vw, 2.5rem) !important; font-weight: 600 !important;
  line-height: 1.12 !important; letter-spacing: -0.02em; border-bottom: 0 !important; margin-bottom: 0.4em !important;
}
.mw-body-content h2, .mw-heading2, .mw-heading2 h2 { font-weight: 600 !important; letter-spacing: -0.01em; border-bottom-color: ${c.bordo} !important; }
.mw-body-content h2, .mw-heading2 h2 { font-size: 1.5rem !important; }
.mw-body-content h3, .mw-heading3 h3 { font-size: 1.2rem !important; font-weight: 600 !important; }
.mw-body-content h4, .mw-heading4 h4 { font-size: 1.05rem !important; font-weight: 600 !important; }
a, a:not([href]):not([class]) { color: var(--color-progressive); text-underline-offset: 3px; }
a:visited { color: var(--color-visited); }
.infobox, .sinottico, table.wikitable, .navbox { border-radius: 10px; }
.sinottico, .infobox { overflow: hidden; }
figure img, .thumbimage, .mw-file-element { border-radius: 8px; }
:focus-visible { outline: 2px solid ${c.fuoco}; outline-offset: 2px; }
::selection { background: ${c.segno}; }
${principale ? ".vector-page-titlebar, .mw-body-header, h1.firstHeading { display: none !important; }" : ""}
`;
}

/** Applica tema e caratteri alla voce mostrata nel riquadro. */
function applicaTema(cornice: HTMLIFrameElement | null, scuro: boolean, principale = false) {
  const doc = cornice?.contentDocument;
  if (!doc?.documentElement) return;
  const html = doc.documentElement;
  html.classList.remove("skin-theme-clientpref-os", "skin-theme-clientpref-day", "skin-theme-clientpref-night");
  html.classList.add(scuro ? "skin-theme-clientpref-night" : "skin-theme-clientpref-day");
  let stile = doc.getElementById("hub-tema");
  if (!stile) {
    stile = doc.createElement("style");
    stile.id = "hub-tema";
    (doc.head ?? html).appendChild(stile);
  }
  stile.textContent = stileVoce(scuro, caratteriDelProgetto(), principale);
}

/** Kiwix scrive i numeri con il separatore delle migliaia ("11,661"). */
function numero(testo: string | null | undefined): number {
  return Number((testo ?? "").replace(/[^\d]/g, "")) || 0;
}

/** L'estratto della ricerca con le parole cercate evidenziate (Kiwix lo manda come testo semplice). */
function estratto(testo: string, domanda: string): ReactNode[] {
  const parole = domanda
    .split(/\s+/)
    .filter((p) => p.length >= 2)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!parole.length) return [testo];
  const trova = new RegExp(`(${parole.join("|")})`, "giu");
  return testo.split(trova).map((pezzo, i) => (i % 2 ? <mark key={i}>{pezzo}</mark> : pezzo));
}

function Ricerca({ alVoce, alCerca, iniziale }: { alVoce: (p: string) => void; alCerca: (q: string) => void; iniziale: string }) {
  const [testo, setTesto] = useState(iniziale);
  const [suggerimenti, setSuggerimenti] = useState<Suggerimento[]>([]);
  const [aperta, setAperta] = useState(false);
  const [attivo, setAttivo] = useState(-1);
  const [cercando, setCercando] = useState(false);
  const idLista = useId();

  useEffect(() => setTesto(iniziale), [iniziale]);

  useEffect(() => {
    const termine = testo.trim();
    if (termine.length < 2) {
      setSuggerimenti([]);
      setCercando(false);
      return;
    }
    const interruzione = new AbortController();
    setCercando(true);
    const timer = setTimeout(async () => {
      try {
        const parametri = new URLSearchParams({ content: LIBRO, term: termine, count: "8" });
        const risposta = await fetch(`${BASE}/wiki/suggest?${parametri}`, { signal: interruzione.signal });
        if (!risposta.ok) return;
        const dati = (await risposta.json()) as Suggerimento[];
        setSuggerimenti(dati.filter((s) => s.kind === "path"));
        setAttivo(-1);
        setCercando(false);
      } catch {
        // la ricerca completa resta disponibile con Invio
        if (!interruzione.signal.aborted) setCercando(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      interruzione.abort();
    };
  }, [testo]);

  function scegli(indice: number) {
    const voce = suggerimenti[indice];
    setAperta(false);
    if (voce?.path) {
      setTesto(voce.value);
      alVoce(voce.path);
    } else if (testo.trim()) {
      alCerca(testo.trim());
    }
  }

  function tasto(evento: KeyboardEvent<HTMLInputElement>) {
    const quanti = suggerimenti.length;
    if (evento.key === "ArrowDown" && quanti) {
      evento.preventDefault();
      setAperta(true);
      setAttivo((attivo + 1) % quanti);
    } else if (evento.key === "ArrowUp" && quanti) {
      evento.preventDefault();
      setAttivo((attivo - 1 + quanti) % quanti);
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      scegli(aperta ? attivo : -1);
    } else if (evento.key === "Escape" && mostra) {
      // il primo Esc chiude solo i suggerimenti (da solo il campo di ricerca cancellerebbe anche il testo)
      evento.preventDefault();
      setAperta(false);
    }
  }

  const mostra = aperta && testo.trim().length >= 2;
  return (
    <div className="ricerca wiki-ricerca">
      <div className="ricerca-campo">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          role="combobox"
          aria-label="Cerca in Wikipedia"
          aria-expanded={mostra}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={mostra && attivo >= 0 ? `${idLista}-${attivo}` : undefined}
          placeholder="Cerca una voce, per esempio Giuseppe Garibaldi"
          autoComplete="off"
          spellCheck={false}
          value={testo}
          onChange={(e) => {
            setTesto(e.target.value);
            setAperta(true);
          }}
          onFocus={() => setAperta(true)}
          onBlur={() => setTimeout(() => setAperta(false), 150)}
          onKeyDown={tasto}
        />
        {testo && (
          <button type="button" className="bottone-icona" aria-label="Cancella la ricerca" onClick={() => setTesto("")}>
            <X size={17} aria-hidden="true" />
          </button>
        )}
      </div>
      {mostra && (
        <div className="ricerca-esito">
          <ul id={idLista} role="listbox" aria-label="Suggerimenti">
            {suggerimenti.map((s, i) => (
              <li key={`${s.path}-${i}`} id={`${idLista}-${i}`} role="option" aria-selected={i === attivo}
                onPointerDown={(e) => e.preventDefault()} onClick={() => scegli(i)} onPointerEnter={() => setAttivo(i)}>
                <span className="esito-nome">{s.value}</span>
              </li>
            ))}
            {cercando && suggerimenti.length === 0 && (
              <li className="ricerca-nota" role="presentation">Cerco tra i titoli…</li>
            )}
            <li id={`${idLista}-tutte`} role="option" aria-selected={false} className="esito-tutte"
              onPointerDown={(e) => e.preventDefault()} onClick={() => scegli(-1)}>
              <span className="esito-dettaglio">Cerca «{testo.trim()}» in tutte le voci</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

function Risultati({ domanda, da, alVoce, alPagina }: { domanda: string; da: number; alVoce: (p: string) => void; alPagina: (da: number) => void }) {
  const [stato, setStato] = useState<{ totale: number; elenco: Risultato[] } | "carico" | "errore">("carico");

  useEffect(() => {
    let annullato = false;
    setStato("carico");
    (async () => {
      try {
        const parametri = new URLSearchParams({
          "books.name": LIBRO, pattern: domanda, format: "xml", start: String(da + 1), pageLength: String(PER_PAGINA),
        });
        const risposta = await fetch(`${BASE}/wiki/search?${parametri}`);
        if (!risposta.ok) throw new Error(String(risposta.status));
        const xml = new DOMParser().parseFromString(await risposta.text(), "text/xml");
        const totale = numero(xml.getElementsByTagName("opensearch:totalResults")[0]?.textContent);
        const elenco = Array.from(xml.getElementsByTagName("item")).map((item) => {
          const link = item.getElementsByTagName("link")[0]?.textContent ?? "";
          return {
            titolo: item.getElementsByTagName("title")[0]?.textContent ?? "",
            percorso: decodeURIComponent(link.slice(link.indexOf(CONTENUTO) + CONTENUTO.length)),
            estratto: estratto(item.getElementsByTagName("description")[0]?.textContent ?? "", domanda),
            parole: numero(item.getElementsByTagName("wordCount")[0]?.textContent) || null,
          };
        });
        if (!annullato) setStato({ totale, elenco });
      } catch {
        if (!annullato) setStato("errore");
      }
    })();
    return () => {
      annullato = true;
    };
  }, [domanda, da]);

  if (stato === "carico") return <p className="wiki-nota" role="status">Cerco «{domanda}»…</p>;
  if (stato === "errore") return <p className="wiki-nota" role="alert">La ricerca non risponde. Riprova tra qualche secondo.</p>;
  if (stato.elenco.length === 0) {
    return <p className="wiki-nota" role="status">Nessuna voce contiene «{domanda}». Prova con meno parole o un sinonimo.</p>;
  }
  const fine = Math.min(stato.totale, da + stato.elenco.length);
  return (
    <section className="wiki-risultati" aria-label={`Risultati per ${domanda}`}>
      <p className="wiki-conteggio">
        {stato.totale > fine || da > 0
          ? `Risultati ${da + 1}-${fine} di ${stato.totale.toLocaleString("it-IT")}`
          : `${stato.totale.toLocaleString("it-IT")} ${stato.totale === 1 ? "risultato" : "risultati"}`}{" "}
        per «{domanda}»
      </p>
      <ol>
        {stato.elenco.map((r) => (
          <li key={r.percorso}>
            <button type="button" className="wiki-titolo" onClick={() => alVoce(r.percorso)}>{r.titolo}</button>
            <p className="wiki-estratto">{r.estratto}</p>
            {r.parole && <p className="wiki-parole">{r.parole.toLocaleString("it-IT")} parole</p>}
          </li>
        ))}
      </ol>
      <div className="wiki-pagine">
        {da > 0 && (
          <button type="button" className="bottone" onClick={() => alPagina(Math.max(0, da - PER_PAGINA))}>Risultati precedenti</button>
        )}
        {fine < stato.totale && (
          <button type="button" className="bottone" onClick={() => alPagina(da + PER_PAGINA)}>Altri risultati</button>
        )}
      </div>
    </section>
  );
}

export default function Wikipedia() {
  const { stati } = useHub();
  const { scuro } = useTema();
  const [vista, setVista] = useState<Vista | null>(null);
  const [sorgente, setSorgente] = useState<string | null>(null);
  const [carico, setCarico] = useState(false);
  const cornice = useRef<HTMLIFrameElement>(null);
  const scuroAttuale = useRef(scuro);
  /** il percorso della pagina principale, saputo la prima volta che la si apre */
  const principale = useRef<string | null>(null);
  const cercoPrincipale = useRef(false);
  const percorsoAttuale = useRef("");
  const osservatore = useRef<ResizeObserver | null>(null);

  // La vista iniziale e i tasti avanti/indietro del browser
  useEffect(() => {
    const aggiorna = () => {
      const nuova = leggiVista();
      setVista(nuova);
      if (nuova.tipo === "voce") {
        if (!nuova.percorso) cercoPrincipale.current = true;
        setSorgente(indirizzoVoce(nuova.percorso));
      }
    };
    aggiorna();
    window.addEventListener("popstate", aggiorna);
    return () => window.removeEventListener("popstate", aggiorna);
  }, []);

  // La barra di ricerca resta sotto la testata mentre si legge: serve l'altezza della testata
  useEffect(() => {
    const testata = document.querySelector<HTMLElement>(".testata");
    if (!testata) return;
    const misura = () => document.documentElement.style.setProperty("--testata-alta", `${testata.offsetHeight}px`);
    misura();
    const os = new ResizeObserver(misura);
    os.observe(testata);
    return () => os.disconnect();
  }, []);

  useEffect(() => {
    scuroAttuale.current = scuro;
    applicaTema(cornice.current, scuro, percorsoAttuale.current === principale.current);
  }, [scuro]);

  useEffect(() => () => osservatore.current?.disconnect(), []);

  const apriVoce = useCallback((percorso: string) => {
    const nuova: Vista = { tipo: "voce", percorso };
    if (!percorso) cercoPrincipale.current = true;
    scriviVista(nuova);
    setVista(nuova);
    setSorgente(indirizzoVoce(percorso));
    setCarico(true);
  }, []);

  const cerca = useCallback((domanda: string, da = 0) => {
    const nuova: Vista = { tipo: "cerca", domanda, da };
    scriviVista(nuova);
    setVista(nuova);
    window.scrollTo({ top: 0 });
  }, []);

  const voceACaso = useCallback(() => {
    setVista({ tipo: "voce", percorso: "" });
    setSorgente(`${BASE}/wiki/random?content=${LIBRO}&volta=${Date.now()}`);
    setCarico(true);
  }, []);

  /** Ogni volta che la voce cambia (anche seguendo un collegamento interno): tema, altezza, titolo, indirizzo. */
  const alCaricamento = useCallback(() => {
    const elemento = cornice.current;
    const finestra = elemento?.contentWindow;
    const doc = elemento?.contentDocument;
    setCarico(false);
    try {
      const percorso = finestra?.location.pathname ?? "";
      const inizio = percorso.indexOf(CONTENUTO);
      const voce = inizio >= 0 ? decodeURIComponent(percorso.slice(inizio + CONTENUTO.length)) : "";
      if (cercoPrincipale.current && voce) {
        principale.current = voce;
        cercoPrincipale.current = false;
      }
      percorsoAttuale.current = voce;
      applicaTema(elemento, scuroAttuale.current, voce === principale.current);
      // se nel frattempo si e' passati ai risultati di una ricerca, l'indirizzo resta quello della ricerca
      if (voce && leggiVista().tipo === "voce") {
        scriviVista({ tipo: "voce", percorso: voce }, true);
        setVista((prima) => (prima?.tipo === "voce" ? { tipo: "voce", percorso: voce } : prima));
      }
      document.title = doc?.title && voce !== principale.current ? `${doc.title}, Wikipedia, raspberry` : "Wikipedia, raspberry";

      // la cornice e' alta quanto la voce: scorre la pagina intera, non un riquadro dentro la pagina
      osservatore.current?.disconnect();
      if (elemento && doc && finestra) {
        const adatta = () => {
          const alta = Math.ceil(doc.documentElement.getBoundingClientRect().height);
          if (alta > 0 && Math.abs(alta - elemento.offsetHeight) > 1) elemento.style.height = `${alta}px`;
        };
        adatta();
        const Osservatore = (finestra as Window & typeof globalThis).ResizeObserver ?? ResizeObserver;
        osservatore.current = new Osservatore(adatta);
        osservatore.current.observe(doc.documentElement);
        // un collegamento a un'altra voce: si mostra il caricamento fino al nuovo "load"
        doc.addEventListener("click", (evento) => {
          const a = (evento.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
          if (!a || evento.defaultPrevented || a.target === "_blank") return;
          const dove = new URL(a.href, finestra.location.href);
          if (dove.origin === finestra.location.origin && dove.pathname !== finestra.location.pathname) setCarico(true);
        });
        // nuova voce: si riparte dall'inizio (i rimandi interni alla stessa voce non passano di qui)
        if (window.scrollY > 0) window.scrollTo({ top: 0 });
      }
    } catch {
      // una pagina di un'altra origine (non dovrebbe capitare): si lascia com'è
    }
  }, []);

  const stato = stati?.wikipedia?.stato;
  const disponibile = stati === null || stato === "acceso";
  return (
    <>
      <div className="wiki-barra-zona">
      <div className="wiki-barra">
        <Ricerca alVoce={apriVoce} alCerca={(q) => cerca(q)} iniziale={vista?.tipo === "cerca" ? vista.domanda : ""} />
        <div className="wiki-azioni">
          <button type="button" className="bottone" onClick={() => apriVoce("")} disabled={!disponibile}>
            <House size={17} aria-hidden="true" />
            <span>Pagina principale</span>
          </button>
          <button type="button" className="bottone" onClick={voceACaso} disabled={!disponibile}>
            <Shuffle size={17} aria-hidden="true" />
            <span>Voce a caso</span>
          </button>
        </div>
      </div>
      </div>

      <main className="pagina pagina-wiki">
      {!disponibile ? (
        <div className="wiki-spenta" role="status">
          <h2>{stato === "mancante" ? "Wikipedia non è ancora stata scaricata" : "Wikipedia è spenta"}</h2>
          <p>
            {stato === "mancante"
              ? "Il Raspberry la scarica da solo: l'hub mostra quando è pronta."
              : "Accendila dall'hub con l'interruttore accanto a Wikipedia, poi torna qui."}
          </p>
          <Link href="/" className="bottone pieno">Torna all&apos;hub</Link>
        </div>
      ) : (
        <>
          {vista?.tipo === "cerca" && (
            <Risultati domanda={vista.domanda} da={vista.da} alVoce={apriVoce} alPagina={(da) => cerca(vista.domanda, da)} />
          )}
          {/* la voce resta caricata anche mentre si guardano i risultati: tornando indietro e' gia' li' */}
          {sorgente && (
            <div className="wiki-foglio" hidden={vista?.tipo === "cerca"} aria-busy={carico}>
              <iframe ref={cornice} className="wiki-voce" src={sorgente} title="Voce di Wikipedia" onLoad={alCaricamento} />
            </div>
          )}
        </>
      )}
      </main>
    </>
  );
}
