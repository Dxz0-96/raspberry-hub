// A fake Wikipedia that answers like kiwix-serve under /wiki: a few made-up articles, suggestions,
// full-text search (RSS/OpenSearch format, with numbers written "11,661" as Kiwix does) and random article.
// Used by the mock Raspberry Pi (dev/mock-server.mjs) and by the Playwright tests. Every book wikipedia_<language>
// answers, with the same articles: kiwix-serve names the books after the links hub-update.sh makes.

const BOOK = /^\/wiki\/content\/(wikipedia_[a-z][a-z-]*)(\/.*)?$/;
const content = (book) => `/wiki/content/${book}/`;
const bookParam = (value) => (/^wikipedia_[a-z][a-z-]*$/.test(value ?? "") ? value : "wikipedia_it");
const MAIN_PAGE = "Main_Page";

/** The articles: path -> title and paragraphs (links are names of other articles, as in the real archive). */
const ARTICLES = {
  [MAIN_PAGE]: {
    title: "Main Page",
    paragraphs: [
      'Welcome to Wikipedia, the free encyclopedia. From here you can reach <a href="Giuseppe_Garibaldi">Giuseppe Garibaldi</a>, <a href="Rome">Rome</a> and <a href="Galileo_Galilei">Galileo Galilei</a>.',
    ],
  },
  Giuseppe_Garibaldi: {
    title: "Giuseppe Garibaldi",
    paragraphs: [
      '<b>Giuseppe Garibaldi</b> (<a href="Nice">Nice</a>, 4 July 1807 – <a href="Caprera">Caprera</a>, 2 June 1882) was an Italian general and patriot.',
      "He is also known as the “Hero of the Two Worlds” for his military campaigns in Europe and South America.",
    ],
    long: true,
  },
  "Garibaldi_(disambiguation)": {
    title: "Garibaldi (disambiguation)",
    paragraphs: ['Garibaldi may refer to <a href="Giuseppe_Garibaldi">Giuseppe Garibaldi</a> or to a street in <a href="Rome">Rome</a>.'],
  },
  Nice: { title: "Nice", paragraphs: ['Nice is a city in France, where <a href="Giuseppe_Garibaldi">Giuseppe Garibaldi</a> was born.'] },
  Caprera: { title: "Caprera", paragraphs: ["Caprera is an island of the La Maddalena archipelago."] },
  Rome: { title: "Rome", paragraphs: ["<b>Rome</b> is the capital of Italy.", 'A statue of <a href="Giuseppe_Garibaldi">Giuseppe Garibaldi</a> stands on the Janiculum.'], long: true },
  Galileo_Galilei: { title: "Galileo Galilei", paragraphs: ["<b>Galileo Galilei</b> was an Italian physicist, astronomer and philosopher."] },
};

/** A bit of the Wikipedia CSS: "Codex" colours with day and night themes, which the hub must replace. */
const CSS = `
html.skin-theme-clientpref-day { --background-color-base: #ffffff; --color-base: #202122; --color-progressive: #36c; }
html.skin-theme-clientpref-night { --background-color-base: #101418; --color-base: #eaecf0; --color-progressive: #88a3e8; }
html, body { margin: 0; background: var(--background-color-base); color: var(--color-base); font-family: serif; }
.mw-page-container { min-height: 100%; padding: 0 24px; }
a { color: var(--color-progressive); }
`;

function page(path) {
  const article = ARTICLES[path] ?? { title: path.replaceAll("_", " "), paragraphs: [`Test article “${path.replaceAll("_", " ")}”.`] };
  // "long" articles are much taller than the window: they check that the frame grows with the content
  const text = article.long ? [...article.paragraphs, ...Array.from({ length: 60 }, (_, i) => `Filler paragraph number ${i + 1}.`)] : article.paragraphs;
  return `<!DOCTYPE html>
<html class="client-nojs vector-feature-limited-width-clientpref-1 skin-theme-clientpref-day" lang="en">
<head><meta charset="utf-8"><title>${article.title}</title><style>${CSS}</style></head>
<body class="skin-vector skin-vector-2022 mediawiki">
<div class="mw-page-container"><div class="mw-page-container-inner"><div class="mw-content-container">
<main class="mw-body">
<header class="mw-body-header vector-page-titlebar"><h1 id="firstHeading" class="firstHeading mw-first-heading">${article.title}</h1></header>
<div class="vector-body"><div id="mw-content-text" class="mw-body-content"><div class="mw-parser-output">
${text.map((p) => `<p>${p}</p>`).join("\n")}
</div></div></div>
</main></div></div></div>
</body></html>`;
}

const xml = (t) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const thousands = (n) => n.toLocaleString("en-US"); // Kiwix: "11,661"

/** The text of a paragraph without its tags, as Kiwix sends the search snippets. */
function plainText(html) {
  let text = html;
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(/<[^<>]*>/g, "");
  }
  return text.replaceAll("<", "").replaceAll(">", "");
}

/** Full-text search results: the articles containing the words, then (for "garibaldi") many generated ones. */
function search(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = Object.entries(ARTICLES)
    .filter(([, a]) => words.every((w) => `${a.title} ${a.paragraphs.join(" ")}`.toLowerCase().includes(w)))
    .map(([path, a]) => ({ path, title: a.title, snippet: plainText(a.paragraphs.join(" ")), words: 1067 }));
  if (words.includes("garibaldi")) {
    for (let i = found.length; i < 11661; i++) {
      found.push({ path: `Garibaldi_${i}`, title: `Garibaldi ${i}`, snippet: `An article that mentions Garibaldi, number ${i}.`, words: 120 + i });
    }
  }
  return found;
}

function reply(res, status, type, body, extra = {}) {
  const data = Buffer.from(body);
  res.writeHead(status, { "Content-Type": type, "Content-Length": data.length, ...extra });
  res.end(data);
}

/** Answers /wiki/... requests like kiwix-serve; returns false if the request is not for it. */
export function fakeWikipedia(req, res, url) {
  const p = url.pathname;
  if (p === "/wiki/suggest") {
    const term = (url.searchParams.get("term") ?? "").toLowerCase();
    const count = Number(url.searchParams.get("count") ?? 10);
    const suggestions = Object.entries(ARTICLES)
      .filter(([, a]) => a.title.toLowerCase().split(/[\s()]+/).some((word) => word.startsWith(term)))
      .slice(0, count)
      .map(([path, a]) => ({ value: a.title, label: a.title, kind: "path", path }));
    suggestions.push({ value: `${term} `, label: `containing '${term}'...`, kind: "pattern" });
    reply(res, 200, "application/json; charset=utf-8", JSON.stringify(suggestions));
    return true;
  }
  if (p === "/wiki/search") {
    const query = url.searchParams.get("pattern") ?? "";
    const book = bookParam(url.searchParams.get("books.name"));
    const start = Math.max(1, Number(url.searchParams.get("start") ?? 1));
    const count = Number(url.searchParams.get("pageLength") ?? 25);
    const all = search(query);
    const slice = all.slice(start - 1, start - 1 + count);
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Search: ${xml(query)}</title>
    <opensearch:totalResults>${thousands(all.length)}</opensearch:totalResults>
    <opensearch:startIndex>${start}</opensearch:startIndex>
    <opensearch:itemsPerPage>${count}</opensearch:itemsPerPage>
${slice
  .map(
    (r) => `    <item>
      <title>${xml(r.title)}</title>
      <link>${content(book)}${encodeURIComponent(r.path)}</link>
      <description>...${xml(r.snippet)}...</description>
      <book><title>Wikipedia</title></book>
      <wordCount>${thousands(r.words)}</wordCount>
    </item>`,
  )
  .join("\n")}
  </channel>
</rss>`;
    reply(res, 200, "application/rss+xml; charset=utf-8", body);
    return true;
  }
  if (p === "/wiki/random") {
    reply(res, 302, "text/plain", "", { Location: `${content(bookParam(url.searchParams.get("content")))}Rome` });
    return true;
  }
  const book = BOOK.exec(p);
  if (book && (!book[2] || book[2] === "/")) {
    reply(res, 302, "text/plain", "", { Location: `${content(book[1])}${MAIN_PAGE}` });
    return true;
  }
  if (book) {
    const path = decodeURIComponent(book[2].slice(1));
    reply(res, 200, "text/html; charset=utf-8", page(path));
    return true;
  }
  return false;
}
