#!/usr/bin/env python3
"""Address search for raspberry-hub.

    GET /search?q=via+garibaldi+12+milano[&lat=45.46&lon=9.19&zoom=13][&limit=8]
    GET /search/status

Answers in JSON from the SQLite index built by build-search-index.py. Standard library only.
Listens on 127.0.0.1: Caddy publishes it as https://raspberry/search.

The query parser knows the street types ("via", "rue", "calle"...), their abbreviations and the articles and
prepositions of the languages of the address data: the index records them (build-search-index.py --languages,
from ADDRESS_LANGUAGES in /etc/hub.conf). They belong to the country, not to the language of the hub: Switzerland
has German, French and Italian street names. With no languages, the words are matched as they are. Each result
carries language-neutral data; the hub translates the labels.
"""
import json
import math
import os
import re
import sqlite3
import sys
import time
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DB = os.environ.get("HUB_SEARCH_DB", "/srv/hub/search/addresses.db")
PORT = int(os.environ.get("HUB_SEARCH_PORT", "8082"))
TIME_LIMIT = 2.5             # seconds: past this, the search is interrupted


class Rules:
    """The street names of some languages. street_types: words that come before the name ("via roma"); only the
    first word of a query can be one ("via del corso" looks for "corso"). abbreviations: (pattern on the lower
    case query, replacement). stopwords: articles and prepositions, optional when matching street names."""

    def __init__(self, street_types=(), abbreviations=(), stopwords=()):
        self.street_types = set(street_types)
        self.abbreviations = list(abbreviations)
        self.stopwords = set(stopwords)

    def __add__(self, other):
        return Rules(self.street_types | other.street_types, self.abbreviations + other.abbreviations,
                     self.stopwords | other.stopwords)


LANGUAGES = {
    "it": Rules(
        {"via", "viale", "vicolo", "vico", "piazza", "piazzale", "piazzetta", "corso", "largo", "strada", "stradone",
         "stradella", "contrada", "localita", "frazione", "borgo", "salita", "discesa", "lungomare", "lungotevere",
         "lungarno", "calle", "traversa", "rione", "rotonda", "galleria"},
        [(r"\bp\.?\s?zza\b", "piazza"), (r"\bp\.?\s?le\b", "piazzale"), (r"\bc\.?\s?so\b", "corso"),
         (r"\bv\.?\s?le\b", "viale"), (r"\bl\.?\s?go\b", "largo"), (r"\bv\.\s", "via "), (r"\bs\.\s?", "san "),
         (r"\bloc\.\s?", "localita "), (r"\bfraz\.\s?", "frazione ")],
        {"di", "del", "dello", "della", "dei", "degli", "delle", "da", "dal", "dallo", "dalla", "dai", "dagli",
         "dalle", "de", "d", "la", "il", "lo", "le", "i", "gli", "l", "al", "allo", "alla", "ai", "agli", "alle", "e",
         "ed", "in", "a"}),
    "fr": Rules(
        {"rue", "avenue", "boulevard", "place", "chemin", "impasse", "allee", "route", "quai", "cours", "square",
         "passage", "sentier", "voie", "promenade", "esplanade", "faubourg", "ruelle", "venelle", "parvis",
         "lotissement", "residence", "cite", "hameau"},
        [(r"\bav\.?\s", "avenue "), (r"\bbd\.?\s", "boulevard "), (r"\bbvd\.?\s", "boulevard "), (r"\bpl\.\s", "place "),
         (r"\bch\.\s", "chemin "), (r"\bimp\.?\s", "impasse "), (r"\brte\.?\s", "route "), (r"\bst[\.\s-]\s?", "saint "),
         (r"\bste[\.\s-]\s?", "sainte ")],
        {"de", "du", "des", "la", "le", "les", "l", "d", "a", "au", "aux", "et", "en", "sur", "sous"}),
    "es": Rules(
        {"calle", "avenida", "plaza", "paseo", "carretera", "camino", "ronda", "travesia", "glorieta", "pasaje",
         "callejon", "urbanizacion", "rambla", "via", "cuesta", "plazuela", "carrer", "placa", "avinguda", "passeig",
         "rua"},
        [(r"\bc/\s?", "calle "), (r"\bcl\.?\s", "calle "), (r"\bavda\.?\s", "avenida "), (r"\bav\.?\s", "avenida "),
         (r"\bpza\.?\s", "plaza "), (r"\bctra\.?\s", "carretera "), (r"\bpso\.?\s", "paseo ")],
        {"de", "del", "la", "las", "el", "los", "y", "a", "al", "en", "d", "l", "i", "dels"}),
    "pt": Rules(
        {"rua", "avenida", "praca", "largo", "travessa", "estrada", "alameda", "beco", "calcada", "rotunda",
         "praceta", "caminho", "bairro", "quinta"},
        [(r"\bav\.?\s", "avenida "), (r"\br\.\s", "rua "), (r"\btv\.?\s", "travessa "), (r"\bpc\.?\s", "praca "),
         (r"\blg\.?\s", "largo "), (r"\bestr\.?\s", "estrada ")],
        {"de", "do", "da", "dos", "das", "e", "a", "o", "os", "as"}),
    # German and Dutch street types are mostly the end of one word ("Hauptstraße", "Kerkstraat"): no prefixes
    "de": Rules(
        (),
        [(r"(\w)str\.(?=\s|,|$)", r"\1strasse"), (r"\bstr\.?(?=\s|,|$)", "strasse"), (r"(\w)pl\.(?=\s|,|$)", r"\1platz")],
        {"am", "an", "auf", "im", "in", "der", "die", "das", "den", "dem", "des", "zum", "zur", "von", "vom", "bei",
         "beim", "und"}),
    "nl": Rules(
        (),
        [(r"(\w)str\.(?=\s|,|$)", r"\1straat"), (r"\bstr\.?(?=\s|,|$)", "straat")],
        {"de", "het", "van", "der", "den", "op", "aan", "in", "en", "t"}),
    "en": Rules(
        (),
        [(r"\brd\b\.?", "road"), (r"\bave?\b\.?", "avenue"), (r"\bln\b\.?", "lane"), (r"\bdr\b\.?", "drive"),
         (r"\bsq\b\.?", "square"), (r"\bcres\b\.?", "crescent"), (r"\bgdns\b\.?", "gardens"), (r"\bct\b\.?", "court")],
        {"the", "of", "and", "on"}),
}
# OpenStreetMap tag (or administrative level) -> class code; the hub shows "City", "Lake", ...
CLASSES = {"place=city": "city", "place=town": "town", "place=village": "village", "place=hamlet": "hamlet",
           "place=suburb": "suburb", "place=quarter": "suburb", "place=neighbourhood": "neighbourhood",
           "place=locality": "locality", "place=isolated_dwelling": "locality", "place=island": "island",
           "place=state": "region", "place=county": "province", "place=municipality": "municipality",
           "level=state": "region", "level=county": "province", "level=city": "municipality",
           "level=district": "hamlet", "level=locality": "locality",
           "natural=peak": "peak", "natural=water": "lake", "water=lake": "lake", "railway=station": "station",
           "aeroway=aerodrome": "airport", "amenity=hospital": "hospital", "tourism=museum": "museum"}
HOUSE_NUMBER = re.compile(r"^\d{1,4}[a-z]?$")
# Letters that Unicode does not split into a base letter and an accent
FOLDED = str.maketrans({"ß": "ss", "æ": "ae", "ø": "o", "œ": "oe", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i"})


def norm(text, version=2):
    """Lower case, no accents, only letters and digits separated by one space. Version 1 (indexes built before
    2.2) kept only a-z and 0-9; version 2 also folds ß, ø, æ... and keeps letters of other scripts (Greek)."""
    if version >= 2:
        text = text.lower().translate(FOLDED)
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(re.sub(r"[\W_]+" if version >= 2 else r"[^a-z0-9]+", " ", text).split())


class Index:
    """What the index says about itself (meta table): the languages of its street names and its normalization.
    An index without them was built for Italy by an older version."""

    def __init__(self, meta):
        languages = meta.get("languages", "it")
        self.languages = [code for code in languages.split(",") if code in LANGUAGES]
        self.rules = sum((LANGUAGES[code] for code in self.languages), Rules())
        self.norm_version = int(meta.get("norm", "1")) if str(meta.get("norm", "1")).isdigit() else 1

    def norm(self, text):
        return norm(text, self.norm_version)


_index = {"key": None, "value": None}


def index_of(db):
    """The Index of the open database, read again only when the file changes (a rebuilt index)."""
    try:
        stat = os.stat(DB)
        key = (DB, stat.st_mtime_ns, stat.st_size)
    except OSError:
        key = None
    if _index["key"] != key or _index["value"] is None:
        _index["value"] = Index(dict(db.execute("SELECT key, value FROM meta")))
        _index["key"] = key
    return _index["value"]


def open_db():
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=2)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    db.execute("PRAGMA cache_size=-8000")
    deadline = time.monotonic() + TIME_LIMIT
    db.set_progress_handler(lambda: 1 if time.monotonic() > deadline else 0, 20000)
    return db


def distance_km(lat1, lon1, lat2, lon2):
    dx = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * 110.57
    return math.hypot(dx, dy)


def nearby_cells(lat, lon):
    """The nine half-degree cells around a point, written as build-search-index.py writes them."""
    row, column = int((lat + 90) * 2), int((lon + 180) * 2)
    return [f'"c{row + dr}x{column + dc}"' for dr in (-1, 0, 1) for dc in (-1, 0, 1)]


def candidates(db, words, terms, last_is_partial, near):
    """Entries containing all the searched words (the last one also as a word prefix).

    Entries are numbered by importance and FTS5 returns them in that order: taking the first ones,
    plus those close to the map position, avoids sorting every match.
    """
    if not terms:
        return {}
    tokens = [f'"{t}"' for t in terms]
    if last_is_partial and words and words[-1] == terms[-1] and len(terms[-1]) >= 2:
        tokens[-1] += "*"
    query = "{name place} : (" + " ".join(tokens) + ")"
    ids = [r[0] for r in db.execute("SELECT rowid FROM entries_fts WHERE entries_fts MATCH ? LIMIT 300", (query,))]
    if near:
        here = query + " AND cell : (" + " OR ".join(nearby_cells(*near)) + ")"
        ids += [r[0] for r in db.execute("SELECT rowid FROM entries_fts WHERE entries_fts MATCH ? LIMIT 150", (here,))]
    rows = {}
    for start in range(0, len(ids), 400):
        chunk = ids[start:start + 400]
        for row in db.execute(f"SELECT * FROM entries WHERE id IN ({','.join('?' * len(chunk))})", chunk):
            rows[row["id"]] = row
    # names that start exactly with the typed text: "Mil" finds Milano right away
    text = " ".join(words)
    if len(" ".join(terms)) >= 3:
        for row in db.execute("SELECT * FROM entries WHERE name_norm >= ? AND name_norm < ? ORDER BY id LIMIT 40",
                              (text, text + "￿")):
            rows.setdefault(row["id"], row)
    return rows


def parse(words, rules):
    """(street type typed first, words to search). Only the first word can be a street type
    ("via", "rue", ...): "via del corso" looks for "corso". Articles and prepositions are optional."""
    street_type = words[0] if len(words) > 1 and words[0] in rules.street_types else None
    rest = words[1:] if street_type else words
    terms = [w for w in rest if w not in rules.stopwords and (len(w) > 1 or w.isdigit())]
    return street_type, terms or [w for w in rest if len(w) > 1]


def score(row, words, street_type, terms, postcode, near, last_is_partial, index):
    rules = index.rules
    name_tokens = row["name_norm"].split()
    city_tokens = row["city_norm"].split()
    alternative = index.norm(row["alt"] or "")
    alt_tokens = alternative.split()
    points = 4.0 * row["importance"]
    for i, term in enumerate(terms):
        prefix = last_is_partial and i == len(terms) - 1
        in_name = any(t == term or (prefix and t.startswith(term)) for t in name_tokens)
        in_city = any(t == term or (prefix and t.startswith(term)) for t in city_tokens)
        if in_name:
            points += 3.0
        elif any(t == term or (prefix and t.startswith(term)) for t in alt_tokens):
            points += 2.5                          # found in the alternative name
        if in_city:
            points += 2.0 if in_name or row["type"] != "street" else 2.5
    # the name (without street type and prepositions) is all inside the query: "via del corso" -> "corso"
    essential = [t for t in name_tokens if t not in rules.stopwords]
    if essential[:1] and essential[0] in rules.street_types:
        essential = essential[1:]
    if essential and all(t in terms for t in essential):
        points += 2.0
    if street_type:
        points += 1.5 if name_tokens[:1] == [street_type] else -0.5
        if row["type"] != "street":
            points -= 1.5
    elif row["type"] == "place":
        points += 1.0
    text = " ".join(words)
    if row["name_norm"] == text or (alternative and text in (alternative, *alternative.split("  "))):
        points += 3.0
    elif row["name_norm"].startswith(text) or alternative.startswith(text):
        points += 1.5
    if row["city_norm"] and row["city_norm"] in text and row["type"] == "street":
        points += 1.5                              # the whole city name is in the query
    points -= 0.15 * max(0, len(name_tokens) - len(words))
    points += min(0.6, math.log10(max(1, row["segments"])) * 0.3)
    if postcode and row["postcode"] == postcode:
        points += 2.5
    if near:
        km = distance_km(near[0], near[1], row["lat"], row["lon"])
        points += 5.0 / (1.0 + km / 10.0)          # close to the map position: counts more than importance
    return points


def locality(city, province, city_norm, index):
    """'Milano', or 'Pozzuoli (Napoli)' when the province differs from the city."""
    if province and index.norm(province) != city_norm:
        return f"{city} ({province})" if city else province
    return city


def detail(row, index):
    """Where the entry is, without words that need translating: '20121 Milano' or 'Milano, Lombardia'."""
    place = locality(row["city"], row["province"], row["city_norm"], index)
    if row["type"] == "street":
        parts = [row["district"] if row["district"] and index.norm(row["district"]) != row["city_norm"] else "",
                 " ".join(x for x in (row["postcode"], place) if x)]
    else:
        parts = [place, row["region"] if row["type"] == "place" else ""]
    return ", ".join(p for p in parts if p)


def find_house_number(db, row, number):
    """The house number closest to the street among those with the same street name; None if unmapped."""
    for attempt, exact in ((number, True), (re.sub(r"\D+$", "", number), False)):
        if not attempt or (not exact and attempt == number):
            continue
        best = None
        for found in db.execute("SELECT lat, lon FROM house_numbers WHERE street_norm = ? AND number = ?",
                                (row["name_norm"], attempt.upper())):
            km = distance_km(row["lat"], row["lon"], found["lat"], found["lon"])
            if km <= 8 and (best is None or km < best[0]):
                best = (km, found["lat"], found["lon"])
        if best:
            return best[1], best[2], exact
    return None


def search_postcode(db, postcode, limit, index):
    """A postcode alone: the area it covers, city by city (centre and bounding box of its streets)."""
    results = []
    for r in db.execute("SELECT min(city) city, max(province) province, city_norm, avg(lat) lat, avg(lon) lon, "
                        "min(west) west, min(south) south, max(east) east, max(north) north, count(*) streets "
                        "FROM entries WHERE postcode = ? AND type = 'street' GROUP BY city_norm "
                        "ORDER BY streets DESC LIMIT ?", (postcode, limit)):
        results.append({"type": "postcode", "name": postcode, "detail": locality(r["city"], r["province"], r["city_norm"], index),
                        "streets": r["streets"], "lat": round(r["lat"], 6), "lon": round(r["lon"], 6),
                        "bbox": [round(r[k], 6) for k in ("west", "south", "east", "north")]})
    return results


def is_postcode(db, word):
    """A number of 4 or 5 digits that is a postcode of the index (Italy, France, Germany: 5; Switzerland, Austria,
    Belgium: 4). Other shapes ("1012 AB", "SW1A 1AA") are found as words of the place."""
    return bool(re.fullmatch(r"\d{4,5}", word)) and \
        db.execute("SELECT 1 FROM entries WHERE postcode = ? LIMIT 1", (word,)).fetchone() is not None


def search(db, query, near=None, limit=8):
    index = index_of(db)
    raw = query.lower()
    for pattern, replacement in index.rules.abbreviations:
        raw = re.sub(pattern, replacement, raw)
    words = index.norm(raw).split()[:10]
    if not words:
        return []
    last_is_partial = not query.endswith(" ")
    postcode = next((w for w in words if is_postcode(db, w)), None)
    words = [w for w in words if w != postcode]
    if not words:
        return search_postcode(db, postcode, limit, index) if postcode else []
    number = None
    street_type, terms = parse(words, index.rules)
    rows = candidates(db, words, terms, last_is_partial, near)
    if not rows:
        # No entry has all the words: a number is the house number. After the street ("via roma 12 milano") the
        # last one; in front of it ("12 rue de la paix", "10 downing street") the first one.
        positions = [i for i, w in enumerate(words) if HOUSE_NUMBER.match(w)]
        after = [i for i in positions if i > 0]
        if positions and len(words) > 1:
            where = after[-1] if after else positions[0]
            number = words.pop(where)
            last_is_partial = last_is_partial and where != len(words)
            street_type, terms = parse(words, index.rules)
            rows = candidates(db, words, terms, last_is_partial, near)
    ranked = sorted(rows.values(),
                    key=lambda r: -score(r, words, street_type, terms, postcode, near, last_is_partial, index))
    results, seen = [], set()
    for row in ranked:
        key = (row["type"], row["name_norm"], row["city_norm"])
        if key in seen:
            continue
        seen.add(key)
        entry = {"type": row["type"], "name": row["name"], "detail": detail(row, index),
                 "lat": round(row["lat"], 6), "lon": round(row["lon"], 6),
                 "bbox": [round(row[k], 6) for k in ("west", "south", "east", "north")]}
        if row["type"] != "street":
            entry["class"] = CLASSES.get(row["class"], "locality" if row["type"] == "place" else "place")
        city_typed = bool(row["city_norm"]) and all(t in terms for t in row["city_norm"].split())
        if number and row["type"] == "street":
            found = find_house_number(db, row, number)
            if found:
                entry.update(type="house_number", name=f"{row['name']} {number.upper()}", lat=round(found[0], 6),
                             lon=round(found[1], 6), bbox=None, exact_number=found[2])
            else:
                entry["missing_number"] = number.upper()
        results.append((city_typed, entry))
        if len(results) >= limit * 2:
            break
    if number:
        # If the house number exists in some street, streets without it are noise, except those in the
        # city typed in the query. Order: typed city, then house number found, then the rest.
        if any(e["type"] == "house_number" for _, e in results):
            results = [(c, e) for c, e in results if c or not e.get("missing_number")]
        results.sort(key=lambda ce: (not ce[0], ce[1]["type"] != "house_number"))
    return [e for _, e in results][:limit]


class Handler(BaseHTTPRequestHandler):
    server_version = "hub-search"
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        address = urlparse(self.path)
        params = parse_qs(address.query)
        path = address.path.rstrip("/")
        if path not in ("/search", "/search/status"):
            return self.reply(404, {"error": "not_found"})
        if not os.path.exists(DB):
            return self.reply(503, {"error": "index_missing", "message": "The address index has not been built yet."})
        try:
            db = open_db()
        except sqlite3.Error:
            return self.reply(503, {"error": "index_unreadable"})
        try:
            if path == "/search/status":
                meta = dict(db.execute("SELECT key, value FROM meta"))
                return self.reply(200, {"ready": True, "data_date": meta.get("data_date"),
                                        "streets": int(meta.get("streets", 0)),
                                        "house_numbers": int(meta.get("house_numbers", 0))})
            query = (params.get("q") or [""])[0][:120]
            try:
                near = (float(params["lat"][0]), float(params["lon"][0]))
            except (KeyError, ValueError, IndexError):
                near = None
            try:
                if near and float(params["zoom"][0]) < 8:
                    near = None                    # half the country in view: the map centre says nothing
            except (KeyError, ValueError, IndexError):
                pass
            try:
                limit = max(1, min(20, int((params.get("limit") or ["8"])[0])))
            except ValueError:
                limit = 8
            start = time.monotonic()
            try:
                results = search(db, query, near, limit)
            except sqlite3.OperationalError:
                # interrupted by the time limit: the query was too generic
                return self.reply(200, {"q": query, "results": [], "too_generic": True})
            self.reply(200, {"q": query, "results": results, "ms": round((time.monotonic() - start) * 1000)})
        finally:
            db.close()


def main():
    if len(sys.argv) > 1:                       # try it from a terminal: hub-search.py via garibaldi 12 milano
        with open_db() as db:
            for entry in search(db, " ".join(sys.argv[1:])):
                print(f"{entry['type']:12} {entry['name']}  |  {entry['detail']}  |  {entry['lat']}, {entry['lon']}"
                      + (f"  (house number {entry['missing_number']} not mapped)" if entry.get("missing_number") else ""))
        return
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    print(f"hub-search listening on 127.0.0.1:{PORT}, index {DB}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
