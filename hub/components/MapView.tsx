"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { language_script_pairs, layers, namedFlavor } from "@protomaps/basemaps";
import { ChevronLeft, Search, X } from "lucide-react";
import { BASE, DEMO, PREFIX, searchAddresses } from "@/lib/hub";
import { useI18n, type Locale } from "@/lib/i18n";
import type { Messages } from "@/lib/messages/en";
import { useTheme } from "@/lib/theme";
import type { SearchResult } from "@/lib/types";

// The default content is a map of Italy (see MAP_BBOX in pi/hub.conf): start there and stay around it. The demo
// has only central Rome (tests/fixtures/rome.pmtiles).
const START: [number, number] = DEMO ? [12.4829, 41.8933] : [12.6, 42.4];
const START_ZOOM = DEMO ? 13 : 5.2;
const BOUNDS: [[number, number], [number, number]] = [[3.5, 33.5], [21.5, 49.0]];

let prepared = false;

/** Once per page: where the MapLibre worker is (the build emits it as a file of the site) and the pmtiles:// protocol. */
function prepare() {
  if (prepared) return;
  maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  prepared = true;
}

function tilesUrl(): string {
  const chosen = process.env.NEXT_PUBLIC_TILES_URL;
  if (chosen) return chosen;
  return `${BASE || window.location.origin + PREFIX}/tiles/basemap.pmtiles`;
}

/** The labels of the basemap in the hub language when Protomaps has it, otherwise in English. */
function labelLanguage(locale: Locale): string {
  return language_script_pairs.some((pair) => pair.lang === locale) ? locale : "en";
}

function mapStyle(dark: boolean, locale: Locale): maplibregl.StyleSpecification {
  const origin = window.location.origin + PREFIX;
  const theme = dark ? "dark" : "light";
  return {
    version: 8,
    glyphs: `${origin}/map-assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/map-assets/sprites/v4/${theme}`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${tilesUrl()}`,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://protomaps.com">Protomaps</a>',
      },
    },
    layers: layers("protomaps", namedFlavor(theme), { lang: labelLanguage(locale) }) as maplibregl.LayerSpecification[],
  };
}

/** The label of a result, in the page language: name and where it is. */
function describe(r: SearchResult, t: Messages): { name: string; detail: string } {
  if (r.type === "postcode") {
    return { name: t.maps.postcode(r.name), detail: [r.detail, t.maps.streets(r.streets ?? 0)].filter(Boolean).join(", ") };
  }
  const kind = r.class ? t.maps.classes[r.class] ?? t.maps.classes.place : null;
  const detail = [kind, r.detail].filter(Boolean).join(", ");
  return { name: r.name, detail: detail || t.maps.types[r.type] };
}

type Availability = "checking" | "ready" | "off" | "missing" | "unreachable" | "unsupported";

function AddressSearch({ map, onResult }: { map: maplibregl.Map | null; onResult: (r: SearchResult) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<"searchUnavailable" | "tooGeneric" | "noResults" | "unreachable" | null>(null);
  const [searching, setSearching] = useState(false);
  const listId = useId();

  useEffect(() => {
    const query = text.trim();
    if (query.length < 2) {
      setResults(null);
      setNote(null);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q: text });
        const centre = map?.getCenter();
        if (centre && map) {
          params.set("lat", centre.lat.toFixed(4));
          params.set("lon", centre.lng.toFixed(4));
          params.set("zoom", map.getZoom().toFixed(1));     // from zoom 8 up, closeness counts
        }
        const response = await searchAddresses(params, abort.signal);
        if (!response.ok) {
          setResults([]);
          setNote("searchUnavailable");
          return;
        }
        const data = (await response.json()) as { results: SearchResult[]; too_generic?: boolean };
        setResults(data.results);
        setActive(data.results.length ? 0 : -1);
        setNote(data.results.length ? null : data.too_generic ? "tooGeneric" : "noResults");
      } catch (problem) {
        if ((problem as Error).name !== "AbortError") {
          setResults([]);
          setNote("unreachable");
        }
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [text, map]);

  function pick(r: SearchResult) {
    setText(describe(r, t).name);
    setOpen(false);
    onResult(r);
  }

  function key(event: KeyboardEvent<HTMLInputElement>) {
    const count = results?.length ?? 0;
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      setOpen(true);
      setActive((active + 1) % count);
    } else if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      setActive((active - 1 + count) % count);
    } else if (event.key === "Enter" && open && results?.[active]) {
      event.preventDefault();
      pick(results[active]);
    } else if (event.key === "Escape" && shown) {
      // the first Esc only closes the results (on its own the search field would also clear the text)
      event.preventDefault();
      setOpen(false);
    }
  }

  const noteText = note === "unreachable" ? t.common.piUnreachable : note ? t.maps[note] : null;
  const shown = open && text.trim().length >= 2 && (results !== null || searching);
  return (
    <div className="search">
      <div className="search-field">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          role="combobox"
          aria-label={t.maps.searchLabel}
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={t.maps.placeholder}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={key}
        />
        {text && (
          <button type="button" className="icon-button" aria-label={t.maps.clear}
            onClick={() => { setText(""); setResults(null); setNote(null); }}>
            <X size={17} aria-hidden="true" />
          </button>
        )}
      </div>
      {shown && (
        <div className="search-results">
          <ul id={listId} role="listbox" aria-label={t.maps.results}>
            {(results ?? []).map((r, i) => {
              const { name, detail } = describe(r, t);
              return (
                <li key={`${r.type}-${r.name}-${r.lat}-${r.lon}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  onPointerDown={(e) => e.preventDefault()} onClick={() => pick(r)} onPointerEnter={() => setActive(i)}>
                  <span className="result-name">{name}</span>
                  <span className="result-detail">
                    {detail}
                    {r.missing_number ? t.maps.missingNumber(r.missing_number) : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          {noteText && <p className="search-note" role="status">{noteText}</p>}
          {searching && !results && <p className="search-note">{t.maps.searching}</p>}
        </div>
      )}
    </div>
  );
}

/** Bookmarks from version 1.x kept the position as #posizione=...: same format, new name. */
function upgradeLegacyHash() {
  if (window.location.hash.includes("posizione=")) {
    window.history.replaceState(null, "", window.location.hash.replace("posizione=", "position="));
  }
}

/** The offline map: one PMTiles file read in pieces from the Raspberry Pi, drawn by MapLibre. */
export default function MapView() {
  const { t, locale } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [availability, setAvailability] = useState<Availability>("checking");
  const { dark } = useTheme();
  const initial = useRef({ dark, locale, t });
  /** The theme and language the map is drawn with: the style reloads only when they really change. */
  const drawnWith = useRef<string | null>(null);

  useEffect(() => {
    initial.current = { dark, locale, t };
  }, [dark, locale, t]);

  useEffect(() => {
    let cancelled = false;
    let created: maplibregl.Map | null = null;
    (async () => {
      try {
        const probe = await fetch(tilesUrl(), { headers: { Range: "bytes=0-15" }, cache: "no-store" });
        if (cancelled) return;
        if (probe.status === 503) return setAvailability("off");
        if (!probe.ok) return setAvailability("missing");
      } catch {
        if (!cancelled) setAvailability("unreachable");
        return;
      }
      if (!container.current) return;
      prepare();
      upgradeLegacyHash();
      const { dark: startDark, locale: startLocale, t: texts } = initial.current;
      let view: maplibregl.Map;
      try {
        view = new maplibregl.Map({
          container: container.current,
          style: mapStyle(startDark, startLocale),
          center: START,
          zoom: START_ZOOM,
          minZoom: 4,
          maxZoom: 19,
          maxBounds: BOUNDS,
          // the position stays in the address (#position=zoom/lat/lon): reloading the page keeps it
          hash: "position",
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          locale: {
            "NavigationControl.ZoomIn": texts.maps.zoomIn,
            "NavigationControl.ZoomOut": texts.maps.zoomOut,
            "AttributionControl.ToggleAttribution": texts.maps.toggleAttribution,
            "ScaleControl.Meters": "m",
            "ScaleControl.Kilometers": "km",
          },
        });
      } catch (problem) {
        // MapLibre draws with WebGL 2: without it (old browser, graphics switched off) say so instead of waiting forever
        if (problem instanceof maplibregl.GPUInitializationError) return setAvailability("unsupported");
        throw problem;
      }
      created = view;
      drawnWith.current = `${startDark}-${startLocale}`;
      // a few icons named by the style are not in the offline set: an empty image instead, without warnings
      view.setMissingStyleImageResolver((id) => {
        if (!view.hasImage(id)) view.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
      });
      view.touchZoomRotate.disableRotation();
      view.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      view.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      setAvailability("ready");
      setMap(view);
    })();
    return () => {
      cancelled = true;
      marker.current = null;
      created?.remove();
      setMap(null);
    };
  }, []);

  useEffect(() => {
    const look = `${dark}-${locale}`;
    if (!map || drawnWith.current === look) return;
    drawnWith.current = look;
    map.setStyle(mapStyle(dark, locale));
  }, [map, dark, locale]);

  const goTo = useCallback(
    (r: SearchResult) => {
      if (!map) return;
      marker.current?.remove();
      marker.current = new maplibregl.Marker({ color: dark ? "#F0668C" : "#C2184B" })
        .setLngLat([r.lon, r.lat])
        .addTo(map);
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const box = r.bbox;
      const large = box && (box[2] - box[0] > 0.004 || box[3] - box[1] > 0.004);
      if (large && r.type !== "house_number") {
        map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 70, maxZoom: 16, animate: !still });
      } else {
        map.flyTo({ center: [r.lon, r.lat], zoom: r.type === "house_number" ? 18 : 17, animate: !still });
      }
    },
    [map, dark],
  );

  return (
    <div className="map-page">
      <div ref={container} className="map" />
      <div className="map-panel">
        <Link href="/" className="button map-back">
          <ChevronLeft size={18} aria-hidden="true" />
          {t.common.hub}
        </Link>
        {availability === "ready" && <AddressSearch map={map} onResult={goTo} />}
      </div>
      {availability !== "ready" && (
        <div className="map-message" role="status">
          {availability === "checking" && <p>{t.maps.opening}</p>}
          {availability === "off" && (
            <>
              <h1>{t.maps.offTitle}</h1>
              <p>{t.maps.offBody}</p>
            </>
          )}
          {availability === "missing" && (
            <>
              <h1>{t.maps.missingTitle}</h1>
              <p>{t.maps.missingBody}</p>
            </>
          )}
          {availability === "unreachable" && (
            <>
              <h1>{t.maps.unreachableTitle}</h1>
              <p>{t.maps.unreachableBody}</p>
            </>
          )}
          {availability === "unsupported" && (
            <>
              <h1>{t.maps.unsupportedTitle}</h1>
              <p>{t.maps.unsupportedBody}</p>
            </>
          )}
          {availability !== "checking" && (
            <Link href="/" className="button primary">{t.common.backToHub}</Link>
          )}
        </div>
      )}
    </div>
  );
}
