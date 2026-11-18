"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { ChevronLeft, Search, X } from "lucide-react";
import { BASE } from "@/lib/hub";
import { useTema } from "@/lib/tema";
import type { RisultatoRicerca } from "@/lib/tipi";

const ITALIA: [number, number] = [12.6, 42.4];
const CONFINI: [[number, number], [number, number]] = [[3.5, 33.5], [21.5, 49.0]];
const NOMI_TIPO: Record<RisultatoRicerca["tipo"], string> = { via: "Via", civico: "Civico", luogo: "Località", poi: "Luogo" };

let protocolloPronto = false;

function indirizzoMappa(): string {
  const scelto = process.env.NEXT_PUBLIC_TILES_URL;
  if (scelto) return scelto;
  return `${BASE || window.location.origin}/tiles/italia.pmtiles`;
}

function stile(scuro: boolean): maplibregl.StyleSpecification {
  const origine = window.location.origin;
  const tema = scuro ? "dark" : "light";
  return {
    version: 8,
    glyphs: `${origine}/map-assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origine}/map-assets/sprites/v4/${tema}`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${indirizzoMappa()}`,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://protomaps.com">Protomaps</a>',
      },
    },
    layers: layers("protomaps", namedFlavor(tema), { lang: "it" }) as maplibregl.LayerSpecification[],
  };
}

type Disponibilita = "verifica" | "pronta" | "spente" | "mancanti" | "irraggiungibile";

function Ricerca({ mappa, alRisultato }: { mappa: maplibregl.Map | null; alRisultato: (r: RisultatoRicerca) => void }) {
  const [testo, setTesto] = useState("");
  const [risultati, setRisultati] = useState<RisultatoRicerca[] | null>(null);
  const [attivo, setAttivo] = useState(-1);
  const [aperta, setAperta] = useState(false);
  const [nota, setNota] = useState<string | null>(null);
  const [cerco, setCerco] = useState(false);
  const idLista = useId();

  useEffect(() => {
    const domanda = testo.trim();
    if (domanda.length < 2) {
      setRisultati(null);
      setNota(null);
      return;
    }
    const interruzione = new AbortController();
    const timer = setTimeout(async () => {
      setCerco(true);
      try {
        const parametri = new URLSearchParams({ q: testo });
        const centro = mappa?.getCenter();
        if (centro && mappa) {
          parametri.set("lat", centro.lat.toFixed(4));
          parametri.set("lon", centro.lng.toFixed(4));
          parametri.set("zoom", mappa.getZoom().toFixed(1));     // da zoom 8 in su conta la vicinanza
        }
        const risposta = await fetch(`${BASE}/cerca?${parametri}`, { signal: interruzione.signal, cache: "no-store" });
        if (!risposta.ok) {
          setRisultati([]);
          setNota("La ricerca degli indirizzi non è disponibile: l'indice è in preparazione oppure le mappe sono spente.");
          return;
        }
        const dati = (await risposta.json()) as { risultati: RisultatoRicerca[]; troppo_generica?: boolean };
        setRisultati(dati.risultati);
        setAttivo(dati.risultati.length ? 0 : -1);
        setNota(
          dati.risultati.length
            ? null
            : dati.troppo_generica
              ? "Ricerca troppo generica. Aggiungi il nome del comune."
              : "Nessun risultato. Prova con il nome della via e il comune.",
        );
      } catch (problema) {
        if ((problema as Error).name !== "AbortError") {
          setRisultati([]);
          setNota("Il Raspberry non risponde. Controlla di essere collegato alla rete di casa.");
        }
      } finally {
        setCerco(false);
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      interruzione.abort();
    };
  }, [testo, mappa]);

  function scegli(r: RisultatoRicerca) {
    setTesto(r.nome);
    setAperta(false);
    alRisultato(r);
  }

  function tasto(evento: KeyboardEvent<HTMLInputElement>) {
    const quanti = risultati?.length ?? 0;
    if (evento.key === "ArrowDown" && quanti) {
      evento.preventDefault();
      setAperta(true);
      setAttivo((attivo + 1) % quanti);
    } else if (evento.key === "ArrowUp" && quanti) {
      evento.preventDefault();
      setAttivo((attivo - 1 + quanti) % quanti);
    } else if (evento.key === "Enter" && aperta && risultati?.[attivo]) {
      evento.preventDefault();
      scegli(risultati[attivo]);
    } else if (evento.key === "Escape" && mostra) {
      // il primo Esc chiude solo i risultati (da solo il campo di ricerca cancellerebbe anche il testo)
      evento.preventDefault();
      setAperta(false);
    }
  }

  const mostra = aperta && testo.trim().length >= 2 && (risultati !== null || cerco);
  return (
    <div className="ricerca">
      <div className="ricerca-campo">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          role="combobox"
          aria-label="Cerca un indirizzo o una località"
          aria-expanded={mostra}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={mostra && attivo >= 0 ? `${idLista}-${attivo}` : undefined}
          placeholder="Via Garibaldi 12, Milano"
          autoComplete="off"
          spellCheck={false}
          value={testo}
          onChange={(e) => {
            setTesto(e.target.value);
            setAperta(true);
          }}
          onFocus={() => setAperta(true)}
          onKeyDown={tasto}
        />
        {testo && (
          <button type="button" className="bottone-icona" aria-label="Cancella la ricerca"
            onClick={() => { setTesto(""); setRisultati(null); setNota(null); }}>
            <X size={17} aria-hidden="true" />
          </button>
        )}
      </div>
      {mostra && (
        <div className="ricerca-esito">
          <ul id={idLista} role="listbox" aria-label="Risultati">
            {(risultati ?? []).map((r, i) => (
              <li key={`${r.tipo}-${r.nome}-${r.lat}-${r.lon}`} id={`${idLista}-${i}`} role="option" aria-selected={i === attivo}
                onPointerDown={(e) => e.preventDefault()} onClick={() => scegli(r)} onPointerEnter={() => setAttivo(i)}>
                <span className="esito-nome">{r.nome}</span>
                <span className="esito-dettaglio">
                  {r.dettaglio || NOMI_TIPO[r.tipo]}
                  {r.civico_mancante ? `. Il civico ${r.civico_mancante} non è mappato: ti porto alla via.` : ""}
                </span>
              </li>
            ))}
          </ul>
          {nota && <p className="ricerca-nota" role="status">{nota}</p>}
          {cerco && !risultati && <p className="ricerca-nota">Cerco…</p>}
        </div>
      )}
    </div>
  );
}

/** La mappa offline dell'Italia: un file PMTiles letto a pezzi dal Raspberry, disegnato da MapLibre. */
export default function Mappa() {
  const contenitore = useRef<HTMLDivElement>(null);
  const segnaposto = useRef<maplibregl.Marker | null>(null);
  const [mappa, setMappa] = useState<maplibregl.Map | null>(null);
  const [disponibilita, setDisponibilita] = useState<Disponibilita>("verifica");
  const { scuro } = useTema();
  const scuroIniziale = useRef(scuro);
  /** Il tema con cui è disegnata la mappa: lo stile si ricarica solo quando cambia davvero. */
  const temaMappa = useRef<boolean | null>(null);

  useEffect(() => {
    scuroIniziale.current = scuro;
  }, [scuro]);

  useEffect(() => {
    let annullato = false;
    let creata: maplibregl.Map | null = null;
    (async () => {
      try {
        const prova = await fetch(indirizzoMappa(), { headers: { Range: "bytes=0-15" }, cache: "no-store" });
        if (annullato) return;
        if (prova.status === 503) return setDisponibilita("spente");
        if (!prova.ok) return setDisponibilita("mancanti");
      } catch {
        if (!annullato) setDisponibilita("irraggiungibile");
        return;
      }
      if (!contenitore.current) return;
      if (!protocolloPronto) {
        maplibregl.addProtocol("pmtiles", new Protocol().tile);
        protocolloPronto = true;
      }
      creata = new maplibregl.Map({
        container: contenitore.current,
        style: stile(scuroIniziale.current),
        center: ITALIA,
        zoom: 5.2,
        minZoom: 4,
        maxZoom: 19,
        maxBounds: CONFINI,
        // la posizione resta nell'indirizzo (#posizione=zoom/lat/lon): ricaricando la pagina non si perde
        hash: "posizione",
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        locale: {
          "NavigationControl.ZoomIn": "Avvicina",
          "NavigationControl.ZoomOut": "Allontana",
          "AttributionControl.ToggleAttribution": "Mostra o nascondi le fonti",
          "ScaleControl.Meters": "m",
          "ScaleControl.Kilometers": "km",
        },
      });
      temaMappa.current = scuroIniziale.current;
      // qualche icona citata dallo stile non è nel set offline: al suo posto un'immagine vuota, senza avvisi
      creata.on("styleimagemissing", (evento) => {
        if (creata && !creata.hasImage(evento.id)) {
          creata.addImage(evento.id, { width: 1, height: 1, data: new Uint8Array(4) });
        }
      });
      creata.touchZoomRotate.disableRotation();
      creata.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      creata.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      setDisponibilita("pronta");
      setMappa(creata);
    })();
    return () => {
      annullato = true;
      segnaposto.current = null;
      creata?.remove();
      setMappa(null);
    };
  }, []);

  useEffect(() => {
    if (!mappa || temaMappa.current === scuro) return;
    temaMappa.current = scuro;
    mappa.setStyle(stile(scuro));
  }, [mappa, scuro]);

  const vaiA = useCallback(
    (r: RisultatoRicerca) => {
      if (!mappa) return;
      segnaposto.current?.remove();
      segnaposto.current = new maplibregl.Marker({ color: scuro ? "#F0668C" : "#C2184B" })
        .setLngLat([r.lon, r.lat])
        .addTo(mappa);
      const fermo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const riquadro = r.riquadro;
      const esteso = riquadro && (riquadro[2] - riquadro[0] > 0.004 || riquadro[3] - riquadro[1] > 0.004);
      if (esteso && r.tipo !== "civico") {
        mappa.fitBounds([[riquadro[0], riquadro[1]], [riquadro[2], riquadro[3]]], { padding: 70, maxZoom: 16, animate: !fermo });
      } else {
        mappa.flyTo({ center: [r.lon, r.lat], zoom: r.tipo === "civico" ? 18 : 17, animate: !fermo });
      }
    },
    [mappa, scuro],
  );

  return (
    <div className="pagina-mappa">
      <div ref={contenitore} className="mappa" />
      <div className="mappa-pannello">
        <Link href="/" className="bottone mappa-indietro">
          <ChevronLeft size={18} aria-hidden="true" />
          Hub
        </Link>
        {disponibilita === "pronta" && <Ricerca mappa={mappa} alRisultato={vaiA} />}
      </div>
      {disponibilita !== "pronta" && (
        <div className="mappa-messaggio" role="status">
          {disponibilita === "verifica" && <p>Apro la mappa…</p>}
          {disponibilita === "spente" && (
            <>
              <h1>Le mappe sono spente</h1>
              <p>Accendile dall&apos;hub con l&apos;interruttore accanto a Mappe, poi torna qui.</p>
            </>
          )}
          {disponibilita === "mancanti" && (
            <>
              <h1>Le mappe non sono ancora state scaricate</h1>
              <p>Il Raspberry le scarica da solo: l&apos;hub mostra quando sono pronte.</p>
            </>
          )}
          {disponibilita === "irraggiungibile" && (
            <>
              <h1>Il Raspberry non risponde</h1>
              <p>Controlla di essere collegato alla rete di casa e ricarica la pagina.</p>
            </>
          )}
          {disponibilita !== "verifica" && (
            <Link href="/" className="bottone pieno">Torna all&apos;hub</Link>
          )}
        </div>
      )}
    </div>
  );
}
