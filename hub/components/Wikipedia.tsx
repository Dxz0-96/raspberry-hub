"use client";

// Offline Wikipedia in the style of the hub: search with suggestions, results laid out like the hub and
// articles shown in a frame that gets the theme (day/night) and the fonts of the project.
// The data comes from kiwix-serve through Caddy (/wiki/...): same origin, so the hub can restyle the
// articles (Kiwix serves them with "allow-same-origin").

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { House, Search, Shuffle, X } from "lucide-react";
import { BASE, DEMO, useHub } from "@/lib/hub";
import { decimal } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

const BOOK = "wikipedia_it";
const CONTENT = `/wiki/content/${BOOK}/`;
const PAGE_SIZE = 20;

type View = { kind: "article"; path: string } | { kind: "search"; query: string; from: number };

interface Suggestion {
  value: string;
  kind: "path" | "pattern";
  path?: string;
}

interface Result {
  title: string;
  path: string;
  snippet: ReactNode[];
  words: number | null;
}

/** The current view lives in the address: #article=Roma or #search=garibaldi&from=20 */
function readView(): View {
  const params = new URLSearchParams(window.location.hash.slice(1));
  // bookmarks from version 1.x: #voce=, #cerca= and &da=
  const query = params.get("search") ?? params.get("cerca");
  if (query) return { kind: "search", query, from: Math.max(0, Number(params.get("from") ?? params.get("da")) || 0) };
  return { kind: "article", path: params.get("article") ?? params.get("voce") ?? "" };
}

function writeView(view: View, replace = false) {
  const params = new URLSearchParams();
  if (view.kind === "search") {
    params.set("search", view.query);
    if (view.from) params.set("from", String(view.from));
  } else if (view.path) {
    params.set("article", view.path);
  }
  const hash = params.toString() ? `#${params}` : window.location.pathname;
  if (replace) window.history.replaceState(null, "", hash);
  else window.history.pushState(null, "", hash);
}

function articleUrl(path: string): string {
  return BASE + CONTENT + path.split("/").map(encodeURIComponent).join("/");
}

/** The IBM Plex @font-face rules of the hub, with absolute addresses, to repeat inside the article. */
function projectFonts(): string {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSFontFaceRule && /IBM Plex/i.test(rule.style.getPropertyValue("font-family"))) {
        const base = sheet.href ?? window.location.href;
        rules.push(rule.cssText.replace(/url\(["']?([^"')]+)["']?\)/g, (_, u: string) => `url("${new URL(u, base).href}")`));
      }
    }
  }
  return rules.join("\n");
}

/**
 * The hub style inside the article: Wikipedia "Codex" colours replaced with those of the project,
 * transparent background (the frosted hub panel is underneath), IBM Plex and headings like the rest of the hub.
 * The article does not scroll by itself: the frame takes the height of the content and the whole page scrolls.
 */
function articleStyle(dark: boolean, fonts: string, mainPage: boolean): string {
  const c = dark
    ? { text: "#f3f5f1", text2: "#a9b5ac", subtle: "rgba(243,245,241,0.06)", strong: "rgba(243,245,241,0.1)",
        border: "rgba(243,245,241,0.16)", link: "#d9a941", visited: "#c79a3a", selection: "rgba(217,169,65,0.35)", focus: "#d9a941" }
    : { text: "#16201a", text2: "#4f5b54", subtle: "rgba(255,255,255,0.55)", strong: "rgba(122,86,16,0.07)",
        border: "rgba(22,32,26,0.14)", link: "#7a5610", visited: "#5e4210", selection: "rgba(154,111,28,0.25)", focus: "#1f4d2b" };
  return `${fonts}
:root { color-scheme: ${dark ? "dark" : "light"}; }
html.skin-theme-clientpref-day, html.skin-theme-clientpref-night {
  --background-color-base: transparent !important;
  --background-color-neutral-subtle: ${c.subtle} !important;
  --background-color-neutral: ${c.strong} !important;
  --background-color-interactive-subtle: ${c.subtle} !important;
  --background-color-interactive: ${c.strong} !important;
  --color-base: ${c.text} !important;
  --color-emphasized: ${c.text} !important;
  --color-subtle: ${c.text2} !important;
  --color-progressive: ${c.link} !important;
  --color-progressive--hover: ${c.link} !important;
  --color-progressive--active: ${c.link} !important;
  --color-visited: ${c.visited} !important;
  --border-color-base: ${c.border} !important;
  --border-color-subtle: ${c.border} !important;
  --border-color-muted: ${c.border} !important;
}
html, body { height: auto !important; min-height: 0 !important; overflow: hidden !important; }
html, body, .mw-page-container, .mw-page-container-inner, .mw-content-container, .mw-body, .vector-body {
  background: transparent !important;
}
body { color: ${c.text}; }
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
.mw-body-content h2, .mw-heading2, .mw-heading2 h2 { font-weight: 600 !important; letter-spacing: -0.01em; border-bottom-color: ${c.border} !important; }
.mw-body-content h2, .mw-heading2 h2 { font-size: 1.5rem !important; }
.mw-body-content h3, .mw-heading3 h3 { font-size: 1.2rem !important; font-weight: 600 !important; }
.mw-body-content h4, .mw-heading4 h4 { font-size: 1.05rem !important; font-weight: 600 !important; }
a, a:not([href]):not([class]) { color: var(--color-progressive); text-underline-offset: 3px; }
a:visited { color: var(--color-visited); }
.infobox, .sinottico, table.wikitable, .navbox { border-radius: 10px; }
.sinottico, .infobox { overflow: hidden; }
figure img, .thumbimage, .mw-file-element { border-radius: 8px; }
:focus-visible { outline: 2px solid ${c.focus}; outline-offset: 2px; }
::selection { background: ${c.selection}; }
${mainPage ? ".vector-page-titlebar, .mw-body-header, h1.firstHeading { display: none !important; }" : ""}
`;
}

/** Applies theme and fonts to the article shown in the frame. */
function applyTheme(frame: HTMLIFrameElement | null, dark: boolean, mainPage = false) {
  const doc = frame?.contentDocument;
  if (!doc?.documentElement) return;
  const html = doc.documentElement;
  html.classList.remove("skin-theme-clientpref-os", "skin-theme-clientpref-day", "skin-theme-clientpref-night");
  html.classList.add(dark ? "skin-theme-clientpref-night" : "skin-theme-clientpref-day");
  let style = doc.getElementById("hub-theme");
  if (!style) {
    style = doc.createElement("style");
    style.id = "hub-theme";
    (doc.head ?? html).appendChild(style);
  }
  style.textContent = articleStyle(dark, projectFonts(), mainPage);
}

/** Kiwix writes numbers with a thousands separator ("11,661"). */
function parseNumber(text: string | null | undefined): number {
  return Number((text ?? "").replace(/[^\d]/g, "")) || 0;
}

/** The search snippet with the searched words highlighted (Kiwix sends it as plain text). */
function snippet(text: string, query: string): ReactNode[] {
  const words = query
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return [text];
  const find = new RegExp(`(${words.join("|")})`, "giu");
  return text.split(find).map((piece, i) => (i % 2 ? <mark key={i}>{piece}</mark> : piece));
}

function ArticleSearch({ onArticle, onSearch, initial }: { onArticle: (p: string) => void; onSearch: (q: string) => void; initial: string }) {
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const listId = useId();

  useEffect(() => setText(initial), [initial]);

  useEffect(() => {
    const term = text.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    const abort = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ content: BOOK, term, count: "8" });
        const response = await fetch(`${BASE}/wiki/suggest?${params}`, { signal: abort.signal });
        if (!response.ok) return;
        const data = (await response.json()) as Suggestion[];
        setSuggestions(data.filter((s) => s.kind === "path"));
        setActive(-1);
        setSearching(false);
      } catch {
        // the full search is still available with Enter
        if (!abort.signal.aborted) setSearching(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [text]);

  function pick(index: number) {
    const suggestion = suggestions[index];
    setOpen(false);
    if (suggestion?.path) {
      setText(suggestion.value);
      onArticle(suggestion.path);
    } else if (text.trim()) {
      onSearch(text.trim());
    }
  }

  function key(event: KeyboardEvent<HTMLInputElement>) {
    const count = suggestions.length;
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      setOpen(true);
      setActive((active + 1) % count);
    } else if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      setActive((active - 1 + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(open ? active : -1);
    } else if (event.key === "Escape" && shown) {
      // the first Esc only closes the suggestions (on its own the search field would also clear the text)
      event.preventDefault();
      setOpen(false);
    }
  }

  const shown = open && text.trim().length >= 2;
  return (
    <div className="search wiki-search">
      <div className="search-field">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          role="combobox"
          aria-label={t.wikipedia.searchLabel}
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={t.wikipedia.placeholder}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={key}
        />
        {text && (
          <button type="button" className="icon-button" aria-label={t.wikipedia.clear} onClick={() => setText("")}>
            <X size={17} aria-hidden="true" />
          </button>
        )}
      </div>
      {shown && (
        <div className="search-results">
          <ul id={listId} role="listbox" aria-label={t.wikipedia.suggestions}>
            {suggestions.map((s, i) => (
              <li key={`${s.path}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                onPointerDown={(e) => e.preventDefault()} onClick={() => pick(i)} onPointerEnter={() => setActive(i)}>
                <span className="result-name">{s.value}</span>
              </li>
            ))}
            {searching && suggestions.length === 0 && (
              <li className="search-note" role="presentation">{t.wikipedia.searchingTitles}</li>
            )}
            <li id={`${listId}-all`} role="option" aria-selected={false} className="result-all"
              onPointerDown={(e) => e.preventDefault()} onClick={() => pick(-1)}>
              <span className="result-detail">{t.wikipedia.searchAll(text.trim())}</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

function Results({ query, from, onArticle, onPage }: { query: string; from: number; onArticle: (p: string) => void; onPage: (from: number) => void }) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ total: number; list: Result[] } | "loading" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const params = new URLSearchParams({
          "books.name": BOOK, pattern: query, format: "xml", start: String(from + 1), pageLength: String(PAGE_SIZE),
        });
        const response = await fetch(`${BASE}/wiki/search?${params}`);
        if (!response.ok) throw new Error(String(response.status));
        const xml = new DOMParser().parseFromString(await response.text(), "text/xml");
        const total = parseNumber(xml.getElementsByTagName("opensearch:totalResults")[0]?.textContent);
        const list = Array.from(xml.getElementsByTagName("item")).map((item) => {
          const link = item.getElementsByTagName("link")[0]?.textContent ?? "";
          return {
            title: item.getElementsByTagName("title")[0]?.textContent ?? "",
            path: decodeURIComponent(link.slice(link.indexOf(CONTENT) + CONTENT.length)),
            snippet: snippet(item.getElementsByTagName("description")[0]?.textContent ?? "", query),
            words: parseNumber(item.getElementsByTagName("wordCount")[0]?.textContent) || null,
          };
        });
        if (!cancelled) setState({ total, list });
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, from]);

  if (state === "loading") return <p className="wiki-note" role="status">{t.wikipedia.searching(query)}</p>;
  if (state === "error") return <p className="wiki-note" role="alert">{t.wikipedia.searchFailed}</p>;
  if (state.list.length === 0) {
    return <p className="wiki-note" role="status">{t.wikipedia.noResults(query)}</p>;
  }
  const to = Math.min(state.total, from + state.list.length);
  const total = decimal(state.total, locale, 0);
  return (
    <section className="wiki-results" aria-label={t.wikipedia.resultsLabel(query)}>
      <p className="wiki-count">
        {state.total > to || from > 0
          ? t.wikipedia.countRange(from + 1, to, total, query)
          : t.wikipedia.countAll(total, state.total, query)}
      </p>
      <ol>
        {state.list.map((r) => (
          <li key={r.path}>
            <button type="button" className="wiki-title" onClick={() => onArticle(r.path)}>{r.title}</button>
            <p className="wiki-snippet">{r.snippet}</p>
            {r.words && <p className="wiki-words">{t.wikipedia.words(decimal(r.words, locale, 0))}</p>}
          </li>
        ))}
      </ol>
      <div className="wiki-pages">
        {from > 0 && (
          <button type="button" className="button" onClick={() => onPage(Math.max(0, from - PAGE_SIZE))}>{t.wikipedia.previous}</button>
        )}
        {to < state.total && (
          <button type="button" className="button" onClick={() => onPage(from + PAGE_SIZE)}>{t.wikipedia.more}</button>
        )}
      </div>
    </section>
  );
}

export default function Wikipedia() {
  const { states } = useHub();
  const { t } = useI18n();
  const { dark } = useTheme();
  const [view, setView] = useState<View | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const darkNow = useRef(dark);
  /** the path of the main page, learnt the first time it is opened */
  const mainPage = useRef<string | null>(null);
  const lookingForMainPage = useRef(false);
  const currentPath = useRef("");
  const resize = useRef<ResizeObserver | null>(null);

  // The initial view and the browser back/forward buttons
  useEffect(() => {
    const update = () => {
      const next = readView();
      setView(next);
      if (next.kind === "article") {
        if (!next.path) lookingForMainPage.current = true;
        setSource(articleUrl(next.path));
      }
    };
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  // The search bar stays under the header while reading: it needs the height of the header
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".topbar");
    if (!header) return;
    const measure = () => document.documentElement.style.setProperty("--header-height", `${header.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    darkNow.current = dark;
    applyTheme(frame.current, dark, currentPath.current === mainPage.current);
  }, [dark]);

  useEffect(() => () => resize.current?.disconnect(), []);

  const openArticle = useCallback((path: string) => {
    const next: View = { kind: "article", path };
    if (!path) lookingForMainPage.current = true;
    writeView(next);
    setView(next);
    setSource(articleUrl(path));
    setLoading(true);
  }, []);

  const search = useCallback((query: string, from = 0) => {
    const next: View = { kind: "search", query, from };
    writeView(next);
    setView(next);
    window.scrollTo({ top: 0 });
  }, []);

  const randomArticle = useCallback(() => {
    setView({ kind: "article", path: "" });
    setSource(`${BASE}/wiki/random?content=${BOOK}&nocache=${Date.now()}`);
    setLoading(true);
  }, []);

  /** Every time the article changes (following an internal link too): theme, height, title, address. */
  const onLoad = useCallback(() => {
    const element = frame.current;
    const win = element?.contentWindow;
    const doc = element?.contentDocument;
    setLoading(false);
    try {
      const pathname = win?.location.pathname ?? "";
      const start = pathname.indexOf(CONTENT);
      const article = start >= 0 ? decodeURIComponent(pathname.slice(start + CONTENT.length)) : "";
      if (lookingForMainPage.current && article) {
        mainPage.current = article;
        lookingForMainPage.current = false;
      }
      currentPath.current = article;
      applyTheme(element, darkNow.current, article === mainPage.current);
      // if meanwhile the search results were opened, the address stays the one of the search
      if (article && readView().kind === "article") {
        writeView({ kind: "article", path: article }, true);
        setView((before) => (before?.kind === "article" ? { kind: "article", path: article } : before));
      }
      document.title = doc?.title && article !== mainPage.current ? `${doc.title}, Wikipedia, raspberry` : "Wikipedia, raspberry";

      // the frame is as tall as the article: the whole page scrolls, not a box inside the page
      resize.current?.disconnect();
      if (element && doc && win) {
        const fit = () => {
          const height = Math.ceil(doc.documentElement.getBoundingClientRect().height);
          if (height > 0 && Math.abs(height - element.offsetHeight) > 1) element.style.height = `${height}px`;
        };
        fit();
        const Observer = (win as Window & typeof globalThis).ResizeObserver ?? ResizeObserver;
        resize.current = new Observer(fit);
        resize.current.observe(doc.documentElement);
        // a link to another article: show the loading state until the new "load"
        doc.addEventListener("click", (event) => {
          const a = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
          if (!a || event.defaultPrevented || a.target === "_blank") return;
          const where = new URL(a.href, win.location.href);
          if (where.origin === win.location.origin && where.pathname !== win.location.pathname) setLoading(true);
        });
        // new article: start from the top (anchors inside the same article do not get here)
        if (window.scrollY > 0) window.scrollTo({ top: 0 });
      }
    } catch {
      // a page from another origin (should not happen): leave it as it is
    }
  }, []);

  const state = states?.wikipedia?.state;
  // the demo has no Wikipedia: never ask for its pages
  const available = !DEMO && (states === null || state === "on");
  return (
    <>
      <div className="wiki-bar-region">
        <div className="wiki-bar">
          <ArticleSearch onArticle={openArticle} onSearch={(q) => search(q)} initial={view?.kind === "search" ? view.query : ""} />
          <div className="wiki-actions">
            <button type="button" className="button" onClick={() => openArticle("")} disabled={!available}>
              <House size={17} aria-hidden="true" />
              <span>{t.wikipedia.mainPage}</span>
            </button>
            <button type="button" className="button" onClick={randomArticle} disabled={!available}>
              <Shuffle size={17} aria-hidden="true" />
              <span>{t.wikipedia.random}</span>
            </button>
          </div>
        </div>
      </div>

      <main className="page wiki-page">
        {!available ? (
          <div className="wiki-off" role="status">
            <h2>{state === "missing" ? t.wikipedia.notDownloadedTitle : t.wikipedia.offTitle}</h2>
            <p>{state === "missing" ? t.wikipedia.notDownloadedBody : t.wikipedia.offBody}</p>
            <Link href="/" className="button primary">{t.common.backToHub}</Link>
          </div>
        ) : (
          <>
            {view?.kind === "search" && (
              <Results query={view.query} from={view.from} onArticle={openArticle} onPage={(from) => search(view.query, from)} />
            )}
            {/* the article stays loaded while looking at the results: going back, it is already there */}
            {source && (
              <div className="wiki-sheet" hidden={view?.kind === "search"} aria-busy={loading}>
                <iframe ref={frame} className="wiki-article" src={source} title={t.wikipedia.frameTitle} onLoad={onLoad} />
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
