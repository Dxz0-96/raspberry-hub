#!/usr/bin/env python3
"""Builds the address search index from the Photon/Nominatim dump (OpenStreetMap data).

    zstd -dc photon-dump-italy-1.0-latest.jsonl.zst | build-search-index.py --out addresses.db
    build-search-index.py --check addresses.db     runs a test search; exits with 0 if the index answers
    build-search-index.py --date addresses.db      prints the date of the data (YYYY-MM-DD)
    build-search-index.py --migrate addresses.db   converts an index built by an older version, in place

Reads the dump line by line from stdin and works on disk: memory use stays low even on a Pi 3.
SQLite temporary files go to the directory in SQLITE_TMPDIR (not /tmp, which is in RAM).

Tables:
    entries         one row per street (segments merged by name + city + postcode), locality or named place
    entries_fts     FTS5 full-text index over the entries (name, place, geographic cell)
    house_numbers   house numbers with coordinates, looked up by normalized street name
    meta            data date and counts
"""
import argparse
import json
import re
import sqlite3
import sys
import time
import unicodedata

SCHEMA = 3
BATCH = 5000
# The geometry is the heaviest part of each line and is not needed: dropping it before parsing the JSON
# halves the time. Simple GeoJSON geometries contain no nested braces.
WITHOUT_GEOMETRY = re.compile(r',\s*"geometry"\s*:\s*\{[^{}]*\}')
LOCALITY_TYPES = {"city", "district", "locality", "county", "state"}

# The full-text index, created from the entries table. "cell" is a half-degree box (about 50 km): it is
# used to search near a point. Separate statements so that --migrate can run them inside its transaction.
FTS_STATEMENTS = [
    """CREATE VIRTUAL TABLE entries_fts USING fts5(name, place, cell, content='',
                                                 tokenize="unicode61 remove_diacritics 2", prefix='2 3 4')""",
    """INSERT INTO entries_fts(rowid, name, place, cell)
         SELECT id, name || ' ' || alt, city || ' ' || district || ' ' || province || ' ' || postcode,
                'c' || CAST((lat + 90) * 2 AS INTEGER) || 'x' || CAST((lon + 180) * 2 AS INTEGER) FROM entries""",
]
FTS_OPTIMIZE = "INSERT INTO entries_fts(entries_fts) VALUES('optimize')"


def norm(text):
    """lower case, no accents, only letters and digits separated by one space"""
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def norm_house_number(number):
    return re.sub(r"[\s/.\\-]+", "", number.upper())[:12]


def first(value):
    if isinstance(value, list):
        value = value[0] if value else ""
    return value.strip() if isinstance(value, str) else ""


def read_places(stream):
    """Yields (header, place) for every place in the dump; the header arrives only once."""
    for line in stream:
        line = line.lstrip()                     # in the dump, lines after the first start with a space
        if not line or line[0] != "{":
            continue
        try:
            doc = json.loads(WITHOUT_GEOMETRY.sub("", line))
        except ValueError:
            continue
        kind = doc.get("type")
        content = doc.get("content")
        if kind == "NominatimDumpFile":
            yield content, None
        elif kind == "Place":
            for place in content if isinstance(content, list) else [content]:
                if isinstance(place, dict):
                    yield None, place


def build(output):
    start = time.time()
    db = sqlite3.connect(output, isolation_level=None)
    db.executescript("""
        PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA locking_mode=EXCLUSIVE;
        PRAGMA cache_size=-48000; PRAGMA temp_store=FILE;
        CREATE TABLE raw(type TEXT, name TEXT, alt TEXT, name_norm TEXT, city TEXT, city_norm TEXT, postcode TEXT,
                         province TEXT, region TEXT, district TEXT, lat REAL, lon REAL,
                         west REAL, south REAL, east REAL, north REAL, importance REAL, class TEXT);
        CREATE TABLE raw_numbers(street TEXT, street_norm TEXT, number TEXT, city TEXT, city_norm TEXT,
                                 postcode TEXT, province TEXT, region TEXT, lat REAL, lon REAL);
        CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
    """)
    entries, numbers, read, data_date = [], [], 0, ""

    def flush():
        if entries:
            db.executemany("INSERT INTO raw VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", entries)
            entries.clear()
        if numbers:
            db.executemany("INSERT INTO raw_numbers VALUES (?,?,?,?,?,?,?,?,?,?)", numbers)
            numbers.clear()

    db.execute("BEGIN")
    for header, p in read_places(sys.stdin):
        if header is not None:
            data_date = str(header.get("data_timestamp", ""))[:10]
            continue
        read += 1
        centroid = p.get("centroid")
        if not centroid or len(centroid) != 2:
            continue
        lon, lat = centroid
        address = p.get("address") or {}
        city = first(address.get("city"))
        postcode = (re.findall(r"\d{5}", str(p.get("postcode") or "")) or [""])[0]
        province = first(address.get("county"))
        region = first(address.get("state"))
        address_type = p.get("address_type")

        number = p.get("housenumber")
        street = first(address.get("street"))
        if number and street:
            for n in re.split(r"[;,]", str(number))[:4]:
                n = norm_house_number(n)
                if n:
                    numbers.append((street, norm(street), n, city, norm(city), postcode, province, region, lat, lon))

        names = p.get("name") or {}
        name = first(names.get("name:it")) or first(names.get("name"))
        if name and address_type != "country":
            alt = " ".join(x for x in (first(names.get("alt_name")), first(names.get("loc_name")),
                                       first(names.get("short_name"))) if x)
            bbox = p.get("bbox") or [lon, lat, lon, lat]          # west, north, east, south
            if len(bbox) != 4:
                bbox = [lon, lat, lon, lat]
            if address_type == "street":
                kind = "street"
            elif address_type in LOCALITY_TYPES:
                kind = "place"
            else:
                kind = "poi"
            district = first(address.get("suburb")) or first(address.get("neighbourhood"))
            # for administrative boundaries the level matters (city, province, region), not the OSM tag
            if p.get("osm_key") == "boundary" or address_type in ("county", "state"):
                place_class = f"level={address_type}"
            else:
                place_class = f"{p.get('osm_key', '')}={p.get('osm_value', '')}"
            entries.append((kind, name, alt, norm(name), city, norm(city), postcode, province, region, district,
                            lat, lon, bbox[0], bbox[3], bbox[2], bbox[1], float(p.get("importance") or 0),
                            place_class))
        if len(entries) >= BATCH or len(numbers) >= BATCH:
            flush()
        if read % 500000 == 0:
            print(f"  read {read:,} places in {time.time() - start:.0f} s", file=sys.stderr, flush=True)
    flush()
    db.execute("COMMIT")
    if read == 0:
        print("no places read from the dump", file=sys.stderr)
        return 1
    print(f"  dump read: {read:,} places in {time.time() - start:.0f} s, now merging and indexing",
          file=sys.stderr, flush=True)

    db.executescript("""
        CREATE TABLE merged(type TEXT, name TEXT, alt TEXT, name_norm TEXT, city TEXT, city_norm TEXT,
                            postcode TEXT, province TEXT, region TEXT, district TEXT, lat REAL, lon REAL,
                            west REAL, south REAL, east REAL, north REAL, importance REAL, segments INTEGER,
                            class TEXT);
        -- streets: one OpenStreetMap segment per line in the dump, here one row per street in each city and postcode
        INSERT INTO merged
          SELECT 'street', min(name), max(alt), name_norm, min(city), city_norm, postcode, max(province), max(region),
                 CASE WHEN count(DISTINCT district) = 1 THEN min(district) ELSE '' END,
                 avg(lat), avg(lon), min(west), min(south), max(east), max(north), max(importance), count(*), min(class)
          FROM raw WHERE type = 'street' AND name_norm <> '' GROUP BY name_norm, city_norm, postcode;
        INSERT INTO merged
          SELECT type, name, alt, name_norm, city, city_norm, postcode, province, region, district, lat, lon,
                 west, south, east, north, importance, 1, class
          FROM raw WHERE type <> 'street' AND name_norm <> '';
        DROP TABLE raw;
        CREATE INDEX merged_name ON merged(name_norm, city_norm);
        -- streets that exist only in the house-number addresses (no street with that name in the city)
        INSERT INTO merged
          SELECT 'street', min(street), '', street_norm, min(city), city_norm, min(postcode), max(province),
                 max(region), '', avg(lat), avg(lon), min(lon), min(lat), max(lon), max(lat), 0, count(*), 'address'
          FROM raw_numbers r
          WHERE street_norm <> '' AND NOT EXISTS (SELECT 1 FROM merged m WHERE m.name_norm = r.street_norm
                                                  AND m.city_norm = r.city_norm AND m.type = 'street')
          GROUP BY street_norm, city_norm;
        -- Entries are numbered from the most to the least important: a search reads the first matches and
        -- stops, without sorting every result (this matters on a Pi 3).
        CREATE TABLE entries(id INTEGER PRIMARY KEY, type TEXT, name TEXT, alt TEXT, name_norm TEXT, city TEXT,
                             city_norm TEXT, postcode TEXT, province TEXT, region TEXT, district TEXT, lat REAL,
                             lon REAL, west REAL, south REAL, east REAL, north REAL, importance REAL,
                             segments INTEGER, class TEXT);
        INSERT INTO entries(type, name, alt, name_norm, city, city_norm, postcode, province, region, district,
                            lat, lon, west, south, east, north, importance, segments, class)
          SELECT * FROM merged ORDER BY importance DESC, segments DESC;
        DROP TABLE merged;
        CREATE INDEX entries_name ON entries(name_norm);
        CREATE INDEX entries_postcode ON entries(postcode);
        CREATE TABLE house_numbers(street_norm TEXT, number TEXT, lat REAL, lon REAL,
                                   PRIMARY KEY(street_norm, number, lat, lon)) WITHOUT ROWID;
        INSERT OR IGNORE INTO house_numbers
          SELECT street_norm, number, lat, lon FROM raw_numbers WHERE street_norm <> '' ORDER BY street_norm, number;
        DROP TABLE raw_numbers;
    """)
    for statement in [*FTS_STATEMENTS, FTS_OPTIMIZE]:
        db.execute(statement)
    counts = {
        "streets": db.execute("SELECT count(*) FROM entries WHERE type = 'street'").fetchone()[0],
        "places": db.execute("SELECT count(*) FROM entries WHERE type <> 'street'").fetchone()[0],
        "house_numbers": db.execute("SELECT count(*) FROM house_numbers").fetchone()[0],
    }
    db.executemany("INSERT INTO meta VALUES (?, ?)", [
        ("schema", str(SCHEMA)), ("data_date", data_date), ("created", time.strftime("%Y-%m-%d %H:%M:%S")),
        ("places_read", str(read)), *((k, str(v)) for k, v in counts.items())])
    db.execute("VACUUM")
    db.execute("PRAGMA journal_mode=DELETE")
    db.close()
    print(f"  index built in {time.time() - start:.0f} s: {counts['streets']:,} streets, "
          f"{counts['places']:,} places, {counts['house_numbers']:,} house numbers", file=sys.stderr, flush=True)
    return 0


def open_read_only(path):
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def check(path):
    try:
        db = open_read_only(path)
        schema = db.execute("SELECT value FROM meta WHERE key = 'schema'").fetchone()
        streets = db.execute("SELECT count(*) FROM entries WHERE type = 'street'").fetchone()[0]
        found = db.execute("SELECT count(*) FROM (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ? LIMIT 5)",
                           ('"roma"*',)).fetchone()[0]
    except sqlite3.Error as error:
        print(f"index not readable: {error}", file=sys.stderr)
        return 1
    if not schema or int(schema[0]) != SCHEMA or streets < 1000 or found == 0:
        print(f"index incomplete: schema {schema}, {streets} streets, {found} test results", file=sys.stderr)
        return 1
    return 0


def date(path):
    row = open_read_only(path).execute("SELECT value FROM meta WHERE key = 'data_date'").fetchone()
    print(row[0] if row else "")
    return 0


# Schema 2 (raspberry-hub 1.x) used Italian table and column names. Renaming is cheap; only the
# contentless full-text index has to be rebuilt (a few minutes on a Pi 3 instead of a full rebuild).
SCHEMA_2_RENAMES = {
    "voci": ("entries", {"tipo": "type", "nome": "name", "nn": "name_norm", "comune": "city", "cn": "city_norm",
                         "cap": "postcode", "prov": "province", "regione": "region", "zona": "district",
                         "o": "west", "s": "south", "e": "east", "n": "north", "imp": "importance",
                         "pezzi": "segments", "classe": "class"}),
    "civici": ("house_numbers", {"nn": "street_norm", "numero": "number"}),
    "meta": ("meta", {"chiave": "key", "valore": "value"}),
}
SCHEMA_2_META_KEYS = {"dati": "data_date", "creato": "created", "luoghi_letti": "places_read", "vie": "streets",
                      "luoghi": "places", "civici": "house_numbers"}


def migrate(path):
    db = sqlite3.connect(path, isolation_level=None)
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if "entries" in tables:
        print("  address index: already up to date")
        return 0
    if "voci" not in tables:
        print("  address index: unknown layout, rebuild it with: sudo hub-update.sh addresses", file=sys.stderr)
        return 1
    start = time.time()
    print("  address index: converting to the new layout (a few minutes on a Pi 3)", flush=True)
    db.execute("BEGIN")
    try:
        for old_table, (new_table, columns) in SCHEMA_2_RENAMES.items():
            for old_column, new_column in columns.items():
                db.execute(f'ALTER TABLE "{old_table}" RENAME COLUMN "{old_column}" TO "{new_column}"')
            if new_table != old_table:
                db.execute(f'ALTER TABLE "{old_table}" RENAME TO "{new_table}"')
        db.execute("UPDATE entries SET type = CASE type WHEN 'via' THEN 'street' WHEN 'luogo' THEN 'place' ELSE type END")
        db.execute("UPDATE entries SET class = 'level=' || substr(class, 6) WHERE class LIKE 'tipo=%'")
        db.execute("UPDATE entries SET class = 'address' WHERE class = 'indirizzo'")
        for old_key, new_key in SCHEMA_2_META_KEYS.items():
            db.execute("UPDATE meta SET key = ? WHERE key = ?", (new_key, old_key))
        db.execute("UPDATE meta SET value = ? WHERE key = 'schema'", (str(SCHEMA),))
        db.execute("DROP TABLE testo")
        for statement in FTS_STATEMENTS:
            db.execute(statement)
        db.execute("COMMIT")
    except sqlite3.Error as error:
        db.execute("ROLLBACK")
        print(f"  address index: conversion failed ({error}), nothing changed", file=sys.stderr)
        return 1
    db.execute(FTS_OPTIMIZE)
    db.close()
    print(f"  address index: converted in {time.time() - start:.0f} s")
    return check(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--out", metavar="FILE", help="build the index reading the dump from stdin")
    group.add_argument("--check", metavar="FILE", help="check that the index answers")
    group.add_argument("--date", metavar="FILE", help="print the date of the data")
    group.add_argument("--migrate", metavar="FILE", help="convert an index built by raspberry-hub 1.x")
    args = parser.parse_args()
    if args.out:
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        return build(args.out)
    if args.check:
        return check(args.check)
    if args.migrate:
        return migrate(args.migrate)
    return date(args.date)


if __name__ == "__main__":
    sys.exit(main())
