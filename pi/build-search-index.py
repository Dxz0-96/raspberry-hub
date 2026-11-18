#!/usr/bin/env python3
"""Costruisce l'indice di ricerca degli indirizzi dal dump Photon/Nominatim (dati OpenStreetMap).

    zstd -dc photon-dump-italy-1.0-latest.jsonl.zst | build-search-index.py --out indirizzi.db
    build-search-index.py --verifica indirizzi.db   prova una ricerca; esce con 0 se l'indice risponde
    build-search-index.py --data indirizzi.db       stampa la data dei dati (AAAA-MM-GG)

Legge il dump riga per riga da stdin e lavora su disco: la memoria usata resta bassa anche sul Pi 3.
I file temporanei di SQLite vanno nella cartella indicata da SQLITE_TMPDIR (non in /tmp, che e' in RAM).

Tabelle prodotte:
    voci    una riga per via (segmenti uniti per nome + comune + CAP), localita' o luogo con nome
    testo   indice full-text FTS5 sulle voci (nome, luogo, cella geografica)
    civici  numeri civici con coordinate, cercati per nome normalizzato della via
    meta    data dei dati e conteggi
"""
import argparse
import json
import re
import sqlite3
import sys
import time
import unicodedata

SCHEMA = 2
LOTTO = 5000
# La geometria e' la parte piu' pesante di ogni riga e non serve: toglierla prima di leggere il JSON
# dimezza i tempi. Le geometrie GeoJSON semplici non contengono parentesi graffe annidate.
SENZA_GEOMETRIA = re.compile(r',\s*"geometry"\s*:\s*\{[^{}]*\}')
LOCALITA = {"city", "district", "locality", "county", "state"}


def norm(testo):
    """minuscole, senza accenti, solo lettere e cifre separate da uno spazio"""
    testo = unicodedata.normalize("NFKD", testo.lower())
    testo = "".join(c for c in testo if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9]+", " ", testo).split())


def norm_civico(numero):
    return re.sub(r"[\s/.\\-]+", "", numero.upper())[:12]


def primo(valore):
    if isinstance(valore, list):
        valore = valore[0] if valore else ""
    return valore.strip() if isinstance(valore, str) else ""


def leggi_luoghi(flusso):
    """Restituisce (intestazione, luogo) per ogni luogo del dump; l'intestazione arriva una volta sola."""
    for riga in flusso:
        riga = riga.lstrip()                     # nel dump le righe dopo la prima iniziano con uno spazio
        if not riga or riga[0] != "{":
            continue
        try:
            doc = json.loads(SENZA_GEOMETRIA.sub("", riga))
        except ValueError:
            continue
        tipo = doc.get("type")
        contenuto = doc.get("content")
        if tipo == "NominatimDumpFile":
            yield contenuto, None
        elif tipo == "Place":
            for luogo in contenuto if isinstance(contenuto, list) else [contenuto]:
                if isinstance(luogo, dict):
                    yield None, luogo


def costruisci(uscita):
    inizio = time.time()
    db = sqlite3.connect(uscita, isolation_level=None)
    db.executescript("""
        PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA locking_mode=EXCLUSIVE;
        PRAGMA cache_size=-48000; PRAGMA temp_store=FILE;
        CREATE TABLE grezzo(tipo TEXT, nome TEXT, alt TEXT, nn TEXT, comune TEXT, cn TEXT, cap TEXT, prov TEXT,
                            regione TEXT, zona TEXT, lat REAL, lon REAL, o REAL, s REAL, e REAL, n REAL,
                            imp REAL, classe TEXT);
        CREATE TABLE civ_grezzo(strada TEXT, nn TEXT, numero TEXT, comune TEXT, cn TEXT, cap TEXT, prov TEXT,
                                regione TEXT, lat REAL, lon REAL);
        CREATE TABLE meta(chiave TEXT PRIMARY KEY, valore TEXT);
    """)
    voci, civici, letti, data_dati = [], [], 0, ""

    def scarica():
        if voci:
            db.executemany("INSERT INTO grezzo VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", voci)
            voci.clear()
        if civici:
            db.executemany("INSERT INTO civ_grezzo VALUES (?,?,?,?,?,?,?,?,?,?)", civici)
            civici.clear()

    db.execute("BEGIN")
    for intestazione, p in leggi_luoghi(sys.stdin):
        if intestazione is not None:
            data_dati = str(intestazione.get("data_timestamp", ""))[:10]
            continue
        letti += 1
        centro = p.get("centroid")
        if not centro or len(centro) != 2:
            continue
        lon, lat = centro
        ind = p.get("address") or {}
        comune = primo(ind.get("city"))
        cap = (re.findall(r"\d{5}", str(p.get("postcode") or "")) or [""])[0]
        prov = primo(ind.get("county"))
        regione = primo(ind.get("state"))
        tipo_ind = p.get("address_type")

        numero = p.get("housenumber")
        strada = primo(ind.get("street"))
        if numero and strada:
            for n in re.split(r"[;,]", str(numero))[:4]:
                n = norm_civico(n)
                if n:
                    civici.append((strada, norm(strada), n, comune, norm(comune), cap, prov, regione, lat, lon))

        nomi = p.get("name") or {}
        nome = primo(nomi.get("name:it")) or primo(nomi.get("name"))
        if nome and tipo_ind != "country":
            alt = " ".join(x for x in (primo(nomi.get("alt_name")), primo(nomi.get("loc_name")),
                                       primo(nomi.get("short_name"))) if x)
            riquadro = p.get("bbox") or [lon, lat, lon, lat]       # ovest, nord, est, sud
            if len(riquadro) != 4:
                riquadro = [lon, lat, lon, lat]
            if tipo_ind == "street":
                tipo = "via"
            elif tipo_ind in LOCALITA:
                tipo = "luogo"
            else:
                tipo = "poi"
            zona = primo(ind.get("suburb")) or primo(ind.get("neighbourhood"))
            # per i confini amministrativi conta il livello (comune, provincia, regione), non il tag OSM
            if p.get("osm_key") == "boundary" or tipo_ind in ("county", "state"):
                classe = f"tipo={tipo_ind}"
            else:
                classe = f"{p.get('osm_key', '')}={p.get('osm_value', '')}"
            voci.append((tipo, nome, alt, norm(nome), comune, norm(comune), cap, prov, regione, zona, lat, lon,
                         riquadro[0], riquadro[3], riquadro[2], riquadro[1], float(p.get("importance") or 0),
                         classe))
        if len(voci) >= LOTTO or len(civici) >= LOTTO:
            scarica()
        if letti % 500000 == 0:
            print(f"  letti {letti:,} luoghi in {time.time() - inizio:.0f} s", file=sys.stderr, flush=True)
    scarica()
    db.execute("COMMIT")
    if letti == 0:
        print("nessun luogo letto dal dump", file=sys.stderr)
        return 1
    print(f"  dump letto: {letti:,} luoghi in {time.time() - inizio:.0f} s, ora unisco e indicizzo",
          file=sys.stderr, flush=True)

    db.executescript("""
        CREATE TABLE unite(tipo TEXT, nome TEXT, alt TEXT, nn TEXT, comune TEXT, cn TEXT, cap TEXT, prov TEXT,
                           regione TEXT, zona TEXT, lat REAL, lon REAL, o REAL, s REAL, e REAL, n REAL,
                           imp REAL, pezzi INTEGER, classe TEXT);
        -- le vie: un segmento OpenStreetMap per riga nel dump, qui una riga per via in ogni comune e CAP
        INSERT INTO unite
          SELECT 'via', min(nome), max(alt), nn, min(comune), cn, cap, max(prov), max(regione),
                 CASE WHEN count(DISTINCT zona) = 1 THEN min(zona) ELSE '' END,
                 avg(lat), avg(lon), min(o), min(s), max(e), max(n), max(imp), count(*), min(classe)
          FROM grezzo WHERE tipo = 'via' AND nn <> '' GROUP BY nn, cn, cap;
        INSERT INTO unite
          SELECT tipo, nome, alt, nn, comune, cn, cap, prov, regione, zona, lat, lon, o, s, e, n, imp, 1, classe
          FROM grezzo WHERE tipo <> 'via' AND nn <> '';
        DROP TABLE grezzo;
        CREATE INDEX unite_nome ON unite(nn, cn);
        -- vie che esistono solo negli indirizzi dei civici (nessuna strada con quel nome nel comune)
        INSERT INTO unite
          SELECT 'via', min(strada), '', nn, min(comune), cn, min(cap), max(prov), max(regione), '',
                 avg(lat), avg(lon), min(lon), min(lat), max(lon), max(lat), 0, count(*), 'indirizzo'
          FROM civ_grezzo c
          WHERE nn <> '' AND NOT EXISTS (SELECT 1 FROM unite v WHERE v.nn = c.nn AND v.cn = c.cn AND v.tipo = 'via')
          GROUP BY nn, cn;
        -- Le voci sono numerate dalla piu' importante alla meno importante: la ricerca legge le prime
        -- che corrispondono e si ferma, senza dover ordinare tutti i risultati (conta sul Pi 3).
        CREATE TABLE voci(id INTEGER PRIMARY KEY, tipo TEXT, nome TEXT, alt TEXT, nn TEXT, comune TEXT, cn TEXT,
                          cap TEXT, prov TEXT, regione TEXT, zona TEXT, lat REAL, lon REAL,
                          o REAL, s REAL, e REAL, n REAL, imp REAL, pezzi INTEGER, classe TEXT);
        INSERT INTO voci(tipo, nome, alt, nn, comune, cn, cap, prov, regione, zona, lat, lon, o, s, e, n, imp, pezzi, classe)
          SELECT * FROM unite ORDER BY imp DESC, pezzi DESC;
        DROP TABLE unite;
        CREATE INDEX voci_nome ON voci(nn);
        CREATE INDEX voci_cap ON voci(cap);
        CREATE TABLE civici(nn TEXT, numero TEXT, lat REAL, lon REAL, PRIMARY KEY(nn, numero, lat, lon)) WITHOUT ROWID;
        INSERT OR IGNORE INTO civici SELECT nn, numero, lat, lon FROM civ_grezzo WHERE nn <> '' ORDER BY nn, numero;
        DROP TABLE civ_grezzo;
        -- "cella" e' un riquadro di mezzo grado (circa 50 km): serve a cercare vicino a un punto.
        CREATE VIRTUAL TABLE testo USING fts5(nome, luogo, cella, content='',
                                              tokenize="unicode61 remove_diacritics 2", prefix='2 3 4');
        INSERT INTO testo(rowid, nome, luogo, cella)
          SELECT id, nome || ' ' || alt, comune || ' ' || zona || ' ' || prov || ' ' || cap,
                 'c' || CAST((lat + 90) * 2 AS INTEGER) || 'x' || CAST((lon + 180) * 2 AS INTEGER) FROM voci;
        INSERT INTO testo(testo) VALUES('optimize');
    """)
    conteggi = {
        "vie": db.execute("SELECT count(*) FROM voci WHERE tipo = 'via'").fetchone()[0],
        "luoghi": db.execute("SELECT count(*) FROM voci WHERE tipo <> 'via'").fetchone()[0],
        "civici": db.execute("SELECT count(*) FROM civici").fetchone()[0],
    }
    db.executemany("INSERT INTO meta VALUES (?, ?)", [
        ("schema", str(SCHEMA)), ("dati", data_dati), ("creato", time.strftime("%Y-%m-%d %H:%M:%S")),
        ("luoghi_letti", str(letti)), *((k, str(v)) for k, v in conteggi.items())])
    db.execute("VACUUM")
    db.execute("PRAGMA journal_mode=DELETE")
    db.close()
    print(f"  indice creato in {time.time() - inizio:.0f} s: {conteggi['vie']:,} vie, "
          f"{conteggi['luoghi']:,} luoghi, {conteggi['civici']:,} civici", file=sys.stderr, flush=True)
    return 0


def apri_sola_lettura(percorso):
    return sqlite3.connect(f"file:{percorso}?mode=ro", uri=True)


def verifica(percorso):
    try:
        db = apri_sola_lettura(percorso)
        schema = db.execute("SELECT valore FROM meta WHERE chiave = 'schema'").fetchone()
        vie = db.execute("SELECT count(*) FROM voci WHERE tipo = 'via'").fetchone()[0]
        trovati = db.execute("SELECT count(*) FROM (SELECT rowid FROM testo WHERE testo MATCH ? LIMIT 5)",
                             ('"roma"*',)).fetchone()[0]
    except sqlite3.Error as errore:
        print(f"indice non leggibile: {errore}", file=sys.stderr)
        return 1
    if not schema or int(schema[0]) != SCHEMA or vie < 1000 or trovati == 0:
        print(f"indice incompleto: schema {schema}, {vie} vie, {trovati} risultati di prova", file=sys.stderr)
        return 1
    return 0


def data(percorso):
    riga = apri_sola_lettura(percorso).execute("SELECT valore FROM meta WHERE chiave = 'dati'").fetchone()
    print(riga[0] if riga else "")
    return 0


def main():
    argomenti = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    gruppo = argomenti.add_mutually_exclusive_group(required=True)
    gruppo.add_argument("--out", metavar="FILE", help="crea l'indice leggendo il dump da stdin")
    gruppo.add_argument("--verifica", metavar="FILE", help="controlla che l'indice risponda")
    gruppo.add_argument("--data", metavar="FILE", help="stampa la data dei dati")
    scelta = argomenti.parse_args()
    if scelta.out:
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        return costruisci(scelta.out)
    if scelta.verifica:
        return verifica(scelta.verifica)
    return data(scelta.data)


if __name__ == "__main__":
    sys.exit(main())
