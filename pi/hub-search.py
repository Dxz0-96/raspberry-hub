#!/usr/bin/env python3
"""Ricerca degli indirizzi per l'hub di casa.

    GET /cerca?q=via+garibaldi+12+milano[&lat=45.46&lon=9.19&zoom=13][&limite=8]
    GET /cerca/stato

Risponde in JSON leggendo l'indice SQLite creato da build-search-index.py. Solo libreria standard.
Ascolta su 127.0.0.1: e' Caddy a pubblicarlo su https://raspberry/cerca.
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

DB = os.environ.get("HUB_SEARCH_DB", "/srv/hub/search/indirizzi.db")
PORTA = int(os.environ.get("HUB_SEARCH_PORT", "8082"))
TEMPO_MASSIMO = 2.5          # secondi: oltre, la ricerca viene interrotta
GENERICI = {"via", "viale", "vicolo", "vico", "piazza", "piazzale", "piazzetta", "corso", "largo", "strada",
            "stradone", "stradella", "contrada", "localita", "frazione", "borgo", "salita", "discesa",
            "lungomare", "lungotevere", "lungarno", "calle", "traversa", "rione", "rotonda", "galleria"}
ABBREVIAZIONI = [(r"\bp\.?\s?zza\b", "piazza"), (r"\bp\.?\s?le\b", "piazzale"), (r"\bc\.?\s?so\b", "corso"),
                 (r"\bv\.?\s?le\b", "viale"), (r"\bl\.?\s?go\b", "largo"), (r"\bv\.\s", "via "),
                 (r"\bs\.\s?", "san "), (r"\bloc\.\s?", "localita "), (r"\bfraz\.\s?", "frazione ")]
CLASSI = {"place=city": "Città", "place=town": "Comune", "place=village": "Paese", "place=hamlet": "Frazione",
          "place=suburb": "Quartiere", "place=quarter": "Quartiere", "place=neighbourhood": "Rione",
          "place=locality": "Località", "place=isolated_dwelling": "Località", "place=island": "Isola",
          "place=state": "Regione", "place=county": "Provincia", "place=municipality": "Comune",
          "tipo=state": "Regione", "tipo=county": "Provincia", "tipo=city": "Comune", "tipo=district": "Frazione",
          "tipo=locality": "Località",
          "natural=peak": "Monte", "natural=water": "Lago", "water=lake": "Lago", "railway=station": "Stazione",
          "aeroway=aerodrome": "Aeroporto", "amenity=hospital": "Ospedale", "tourism=museum": "Museo"}
CIVICO = re.compile(r"^\d{1,4}[a-z]?$")
PREPOSIZIONI = {"di", "del", "dello", "della", "dei", "degli", "delle", "da", "dal", "dallo", "dalla",
                "dai", "dagli", "dalle", "de", "d", "la", "il", "lo", "le", "i", "gli", "l", "al", "allo",
                "alla", "ai", "agli", "alle", "e", "ed", "in", "a"}


def norm(testo):
    testo = unicodedata.normalize("NFKD", testo.lower())
    testo = "".join(c for c in testo if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9]+", " ", testo).split())


def apri():
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=2)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    db.execute("PRAGMA cache_size=-8000")
    scadenza = time.monotonic() + TEMPO_MASSIMO
    db.set_progress_handler(lambda: 1 if time.monotonic() > scadenza else 0, 20000)
    return db


def distanza_km(lat1, lon1, lat2, lon2):
    dx = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * 110.57
    return math.hypot(dx, dy)


def celle_vicine(lat, lon):
    """Le nove celle di mezzo grado attorno a un punto, come le scrive build-search-index.py."""
    riga, colonna = int((lat + 90) * 2), int((lon + 180) * 2)
    return [f'"c{riga + dr}x{colonna + dc}"' for dr in (-1, 0, 1) for dc in (-1, 0, 1)]


def candidati(db, parole, cercate, ultima_incompleta, vicino):
    """Voci che contengono tutte le parole cercate (l'ultima anche solo come inizio di parola).

    Le voci sono numerate per importanza, e FTS5 le restituisce in quell'ordine: basta prendere le
    prime, piu' quelle vicine al punto della mappa, senza ordinare tutte le corrispondenze.
    """
    if not cercate:
        return {}
    termini = [f'"{p}"' for p in cercate]
    if ultima_incompleta and parole and parole[-1] == cercate[-1] and len(cercate[-1]) >= 2:
        termini[-1] += "*"
    domanda = "{nome luogo} : (" + " ".join(termini) + ")"
    numeri = [r[0] for r in db.execute("SELECT rowid FROM testo WHERE testo MATCH ? LIMIT 300", (domanda,))]
    if vicino:
        qui = domanda + " AND cella : (" + " OR ".join(celle_vicine(*vicino)) + ")"
        numeri += [r[0] for r in db.execute("SELECT rowid FROM testo WHERE testo MATCH ? LIMIT 150", (qui,))]
    righe = {}
    for inizio in range(0, len(numeri), 400):
        blocco = numeri[inizio:inizio + 400]
        for riga in db.execute(f"SELECT * FROM voci WHERE id IN ({','.join('?' * len(blocco))})", blocco):
            righe[riga["id"]] = riga
    # nomi che iniziano proprio con il testo scritto: trova subito "Mil" -> Milano
    testo = " ".join(parole)
    if len(" ".join(cercate)) >= 3:
        for riga in db.execute("SELECT * FROM voci WHERE nn >= ? AND nn < ? ORDER BY id LIMIT 40",
                               (testo, testo + "￿")):
            righe.setdefault(riga["id"], riga)
    return righe


def analizza(parole):
    """(tipo di strada scritto in testa, parole da cercare). Solo la prima parola puo' essere un tipo
    ("via", "corso", ...): "via del corso" cerca "corso". Articoli e preposizioni non sono obbligatori."""
    tipo = parole[0] if len(parole) > 1 and parole[0] in GENERICI else None
    resto = parole[1:] if tipo else parole
    cercate = [p for p in resto if p not in PREPOSIZIONI and (len(p) > 1 or p.isdigit())]
    return tipo, cercate or [p for p in resto if len(p) > 1]


def punteggio(riga, parole, tipo, cercate, cap, vicino, ultima_incompleta):
    del_nome = riga["nn"].split()
    del_comune = riga["cn"].split()
    alternativo = norm(riga["alt"] or "")
    dell_alt = alternativo.split()
    punti = 4.0 * riga["imp"]
    for i, parola in enumerate(cercate):
        inizio = ultima_incompleta and i == len(cercate) - 1
        nel_nome = any(t == parola or (inizio and t.startswith(parola)) for t in del_nome)
        nel_comune = any(t == parola or (inizio and t.startswith(parola)) for t in del_comune)
        if nel_nome:
            punti += 3.0
        elif any(t == parola or (inizio and t.startswith(parola)) for t in dell_alt):
            punti += 2.5                          # trovata nel nome alternativo
        if nel_comune:
            punti += 2.0 if nel_nome or riga["tipo"] != "via" else 2.5
    # il nome (senza tipo di strada e preposizioni) e' tutto dentro la ricerca: "via del corso" -> "corso"
    essenziale = [t for t in del_nome if t not in PREPOSIZIONI]
    if essenziale[:1] and essenziale[0] in GENERICI:
        essenziale = essenziale[1:]
    if essenziale and all(t in cercate for t in essenziale):
        punti += 2.0
    if tipo:
        punti += 1.5 if del_nome[:1] == [tipo] else -0.5
        if riga["tipo"] != "via":
            punti -= 1.5
    elif riga["tipo"] == "luogo":
        punti += 1.0
    testo = " ".join(parole)
    if riga["nn"] == testo or (alternativo and testo in (alternativo, *alternativo.split("  "))):
        punti += 3.0
    elif riga["nn"].startswith(testo) or alternativo.startswith(testo):
        punti += 1.5
    if riga["cn"] and riga["cn"] in testo and riga["tipo"] == "via":
        punti += 1.5                              # il comune e' scritto per intero nella ricerca
    punti -= 0.15 * max(0, len(del_nome) - len(parole))
    punti += min(0.6, math.log10(max(1, riga["pezzi"])) * 0.3)
    if cap and riga["cap"] == cap:
        punti += 2.5
    if vicino:
        km = distanza_km(vicino[0], vicino[1], riga["lat"], riga["lon"])
        punti += 5.0 / (1.0 + km / 10.0)          # vicino al punto della mappa: conta piu' dell'importanza
    return punti


def descrizione(riga):
    comune, prov, regione = riga["comune"], riga["prov"], riga["regione"]
    luogo = comune
    if prov and norm(prov) != riga["cn"]:
        luogo = f"{comune} ({prov})" if comune else prov
    if riga["tipo"] == "via":
        pezzi = [riga["zona"] if riga["zona"] and norm(riga["zona"]) != riga["cn"] else "",
                 " ".join(x for x in (riga["cap"], luogo) if x)]
    else:
        classe = CLASSI.get(riga["classe"], "Località" if riga["tipo"] == "luogo" else "Luogo")
        pezzi = [classe, luogo, regione if riga["tipo"] == "luogo" else ""]
    return ", ".join(p for p in pezzi if p)


def trova_civico(db, riga, numero):
    """Il civico piu' vicino alla via tra quelli con lo stesso nome di strada; None se non e' mappato."""
    for tentativo, esatto in ((numero, True), (re.sub(r"\D+$", "", numero), False)):
        if not tentativo or (not esatto and tentativo == numero):
            continue
        migliore = None
        for civico in db.execute("SELECT lat, lon FROM civici WHERE nn = ? AND numero = ?",
                                 (riga["nn"], tentativo.upper())):
            km = distanza_km(riga["lat"], riga["lon"], civico["lat"], civico["lon"])
            if km <= 8 and (migliore is None or km < migliore[0]):
                migliore = (km, civico["lat"], civico["lon"])
        if migliore:
            return migliore[1], migliore[2], esatto
    return None


def cerca_cap(db, cap, limite):
    """Solo un CAP: la zona coperta, comune per comune (centro e riquadro delle sue vie)."""
    risultati = []
    for r in db.execute("SELECT min(comune) comune, max(prov) prov, cn, avg(lat) lat, avg(lon) lon, "
                        "min(o) o, min(s) s, max(e) e, max(n) n, count(*) quante FROM voci "
                        "WHERE cap = ? AND tipo = 'via' GROUP BY cn ORDER BY quante DESC LIMIT ?", (cap, limite)):
        luogo = r["comune"] + (f" ({r['prov']})" if r["prov"] and norm(r["prov"]) != r["cn"] else "")
        risultati.append({"tipo": "luogo", "nome": f"CAP {cap}", "dettaglio": f"{luogo}, {r['quante']} vie",
                          "lat": round(r["lat"], 6), "lon": round(r["lon"], 6),
                          "riquadro": [round(r[k], 6) for k in ("o", "s", "e", "n")]})
    return risultati


def cerca(db, domanda, vicino=None, limite=8):
    grezzo = domanda.lower()
    for modello, sostituto in ABBREVIAZIONI:
        grezzo = re.sub(modello, sostituto, grezzo)
    parole = norm(grezzo).split()[:10]
    if not parole:
        return []
    ultima_incompleta = not domanda.endswith(" ")
    cap = next((p for p in parole if re.fullmatch(r"\d{5}", p)), None)
    parole = [p for p in parole if p != cap]
    if not parole:
        return cerca_cap(db, cap, limite) if cap else []
    numero = None
    tipo, cercate = analizza(parole)
    righe = candidati(db, parole, cercate, ultima_incompleta, vicino)
    if not righe:
        # nessuna voce con tutte le parole: l'ultimo numero e' il civico ("via roma 12 milano")
        posizioni = [i for i, p in enumerate(parole) if CIVICO.match(p) and i > 0]
        if posizioni:
            numero = parole.pop(posizioni[-1])
            ultima_incompleta = ultima_incompleta and posizioni[-1] != len(parole)
            tipo, cercate = analizza(parole)
            righe = candidati(db, parole, cercate, ultima_incompleta, vicino)
    ordinate = sorted(righe.values(),
                      key=lambda r: -punteggio(r, parole, tipo, cercate, cap, vicino, ultima_incompleta))
    risultati, visti = [], set()
    for riga in ordinate:
        chiave = (riga["tipo"], riga["nn"], riga["cn"])
        if chiave in visti:
            continue
        visti.add(chiave)
        voce = {"tipo": riga["tipo"], "nome": riga["nome"], "dettaglio": descrizione(riga),
                "lat": round(riga["lat"], 6), "lon": round(riga["lon"], 6),
                "riquadro": [round(riga[k], 6) for k in ("o", "s", "e", "n")]}
        nel_comune_scritto = bool(riga["cn"]) and all(t in cercate for t in riga["cn"].split())
        if numero and riga["tipo"] == "via":
            civico = trova_civico(db, riga, numero)
            if civico:
                voce.update(tipo="civico", nome=f"{riga['nome']} {numero.upper()}", lat=round(civico[0], 6),
                            lon=round(civico[1], 6), riquadro=None, civico_esatto=civico[2])
            else:
                voce["civico_mancante"] = numero.upper()
        risultati.append((nel_comune_scritto, voce))
        if len(risultati) >= limite * 2:
            break
    if numero:
        # Se il civico esiste in qualche via, le vie dove non c'e' sono rumore, salvo quelle del comune
        # scritto nella ricerca. Ordine: comune scritto, poi civico trovato, poi il resto.
        if any(v["tipo"] == "civico" for _, v in risultati):
            risultati = [(c, v) for c, v in risultati if c or not v.get("civico_mancante")]
        risultati.sort(key=lambda cv: (not cv[0], cv[1]["tipo"] != "civico"))
    return [v for _, v in risultati][:limite]


class Richiesta(BaseHTTPRequestHandler):
    server_version = "hub-search"
    protocol_version = "HTTP/1.1"

    def log_message(self, *argomenti):
        pass

    def rispondi(self, codice, corpo):
        dati = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codice)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(dati)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(dati)

    def do_GET(self):
        indirizzo = urlparse(self.path)
        parametri = parse_qs(indirizzo.query)
        percorso = indirizzo.path.rstrip("/")
        if percorso not in ("/cerca", "/cerca/stato"):
            return self.rispondi(404, {"errore": "non_trovato"})
        if not os.path.exists(DB):
            return self.rispondi(503, {"errore": "indice_mancante",
                                       "messaggio": "L'indice degli indirizzi non è ancora stato creato."})
        try:
            db = apri()
        except sqlite3.Error:
            return self.rispondi(503, {"errore": "indice_illeggibile"})
        try:
            if percorso == "/cerca/stato":
                meta = dict(db.execute("SELECT chiave, valore FROM meta"))
                return self.rispondi(200, {"pronto": True, "dati": meta.get("dati"), "vie": int(meta.get("vie", 0)),
                                           "civici": int(meta.get("civici", 0))})
            domanda = (parametri.get("q") or [""])[0][:120]
            try:
                vicino = (float(parametri["lat"][0]), float(parametri["lon"][0]))
            except (KeyError, ValueError, IndexError):
                vicino = None
            try:
                if vicino and float(parametri["zoom"][0]) < 8:
                    vicino = None                 # inquadrata mezza Italia: il centro della mappa non dice nulla
            except (KeyError, ValueError, IndexError):
                pass
            try:
                limite = max(1, min(20, int((parametri.get("limite") or ["8"])[0])))
            except ValueError:
                limite = 8
            inizio = time.monotonic()
            try:
                risultati = cerca(db, domanda, vicino, limite)
            except sqlite3.OperationalError:
                # interrotta dal limite di tempo: la ricerca era troppo generica
                return self.rispondi(200, {"q": domanda, "risultati": [], "troppo_generica": True})
            self.rispondi(200, {"q": domanda, "risultati": risultati,
                                "ms": round((time.monotonic() - inizio) * 1000)})
        finally:
            db.close()


def main():
    if len(sys.argv) > 1:                       # prova da terminale: hub-search.py via garibaldi 12 milano
        with apri() as db:
            for voce in cerca(db, " ".join(sys.argv[1:])):
                print(f"{voce['tipo']:6} {voce['nome']}  |  {voce['dettaglio']}  |  {voce['lat']}, {voce['lon']}"
                      + (f"  (civico {voce['civico_mancante']} non mappato)" if voce.get("civico_mancante") else ""))
        return
    server = ThreadingHTTPServer(("127.0.0.1", PORTA), Richiesta)
    server.daemon_threads = True
    print(f"hub-search in ascolto su 127.0.0.1:{PORTA}, indice {DB}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
