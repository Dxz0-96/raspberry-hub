#!/usr/bin/env python3
"""Address search for raspberry-hub.

    GET /search?q=via+garibaldi+12+milano[&lat=45.46&lon=9.19&zoom=13][&limit=8]
    GET /search/status

Answers in JSON from the SQLite index built by build-search-index.py. Standard library only.
Listens on 127.0.0.1: Caddy publishes it as https://raspberry/search.

The address data is Italian (OpenStreetMap via Photon), so the query parser knows Italian street
types ("via", "piazza", ...), their abbreviations and the articles and prepositions found in street
names. Each result carries language-neutral data; the hub translates the labels.
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
# Italian street types: only the first word of a query can be one ("via del corso" looks for "corso").
STREET_TYPES = {"via", "viale", "vicolo", "vico", "piazza", "piazzale", "piazzetta", "corso", "largo", "strada",
                "stradone", "stradella", "contrada", "localita", "frazione", "borgo", "salita", "discesa",
                "lungomare", "lungotevere", "lungarno", "calle", "traversa", "rione", "rotonda", "galleria"}
ABBREVIATIONS = [(r"\bp\.?\s?zza\b", "piazza"), (r"\bp\.?\s?le\b", "piazzale"), (r"\bc\.?\s?so\b", "corso"),
                 (r"\bv\.?\s?le\b", "viale"), (r"\bl\.?\s?go\b", "largo"), (r"\bv\.\s", "via "),
                 (r"\bs\.\s?", "san "), (r"\bloc\.\s?", "localita "), (r"\bfraz\.\s?", "frazione ")]
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
# Italian articles and prepositions: optional when matching street names
STOPWORDS = {"di", "del", "dello", "della", "dei", "degli", "delle", "da", "dal", "dallo", "dalla",
             "dai", "dagli", "dalle", "de", "d", "la", "il", "lo", "le", "i", "gli", "l", "al", "allo",
             "alla", "ai", "agli", "alle", "e", "ed", "in", "a"}


def norm(text):
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


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


def parse(words):
    """(street type typed first, words to search). Only the first word can be a street type
    ("via", "corso", ...): "via del corso" looks for "corso". Articles and prepositions are optional."""
    street_type = words[0] if len(words) > 1 and words[0] in STREET_TYPES else None
    rest = words[1:] if street_type else words
    terms = [w for w in rest if w not in STOPWORDS and (len(w) > 1 or w.isdigit())]
    return street_type, terms or [w for w in rest if len(w) > 1]


def score(row, words, street_type, terms, postcode, near, last_is_partial):
    name_tokens = row["name_norm"].split()
    city_tokens = row["city_norm"].split()
    alternative = norm(row["alt"] or "")
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
    essential = [t for t in name_tokens if t not in STOPWORDS]
    if essential[:1] and essential[0] in STREET_TYPES:
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


def locality(city, province, city_norm):
    """'Milano', or 'Pozzuoli (Napoli)' when the province differs from the city."""
    if province and norm(province) != city_norm:
        return f"{city} ({province})" if city else province
    return city


def detail(row):
    """Where the entry is, without words that need translating: '20121 Milano' or 'Milano, Lombardia'."""
    place = locality(row["city"], row["province"], row["city_norm"])
    if row["type"] == "street":
        parts = [row["district"] if row["district"] and norm(row["district"]) != row["city_norm"] else "",
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


def search_postcode(db, postcode, limit):
    """A postcode alone: the area it covers, city by city (centre and bounding box of its streets)."""
    results = []
    for r in db.execute("SELECT min(city) city, max(province) province, city_norm, avg(lat) lat, avg(lon) lon, "
                        "min(west) west, min(south) south, max(east) east, max(north) north, count(*) streets "
                        "FROM entries WHERE postcode = ? AND type = 'street' GROUP BY city_norm "
                        "ORDER BY streets DESC LIMIT ?", (postcode, limit)):
        results.append({"type": "postcode", "name": postcode, "detail": locality(r["city"], r["province"], r["city_norm"]),
                        "streets": r["streets"], "lat": round(r["lat"], 6), "lon": round(r["lon"], 6),
                        "bbox": [round(r[k], 6) for k in ("west", "south", "east", "north")]})
    return results


def search(db, query, near=None, limit=8):
    raw = query.lower()
    for pattern, replacement in ABBREVIATIONS:
        raw = re.sub(pattern, replacement, raw)
    words = norm(raw).split()[:10]
    if not words:
        return []
    last_is_partial = not query.endswith(" ")
    postcode = next((w for w in words if re.fullmatch(r"\d{5}", w)), None)
    words = [w for w in words if w != postcode]
    if not words:
        return search_postcode(db, postcode, limit) if postcode else []
    number = None
    street_type, terms = parse(words)
    rows = candidates(db, words, terms, last_is_partial, near)
    if not rows:
        # no entry has all the words: the last number is the house number ("via roma 12 milano")
        positions = [i for i, w in enumerate(words) if HOUSE_NUMBER.match(w) and i > 0]
        if positions:
            number = words.pop(positions[-1])
            last_is_partial = last_is_partial and positions[-1] != len(words)
            street_type, terms = parse(words)
            rows = candidates(db, words, terms, last_is_partial, near)
    ranked = sorted(rows.values(),
                    key=lambda r: -score(r, words, street_type, terms, postcode, near, last_is_partial))
    results, seen = [], set()
    for row in ranked:
        key = (row["type"], row["name_norm"], row["city_norm"])
        if key in seen:
            continue
        seen.add(key)
        entry = {"type": row["type"], "name": row["name"], "detail": detail(row),
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
