"""Smoke tests for the scripts that run on the Raspberry Pi. Standard library only:

    python3 -m unittest discover -s pi/tests -v

They build a small address index from a made-up Photon dump, search it, convert an index in the 1.x
layout, upgrade a fake 1.x installation with hub-migrate.py and talk to hub-control.py over HTTP.
The hub-control test needs Linux (/proc); the others run anywhere.
"""
import http.client
import importlib.util
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

PI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(PI, file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def photon_dump():
    """A few lines in the format of the Photon/Nominatim dump: Milano, Roma, a street with a house number
    and enough filler streets to pass the --check of the index."""
    address = {"city": "Milano", "county": "Milano", "state": "Lombardia"}
    lines = [{"type": "NominatimDumpFile", "content": {"data_timestamp": "2026-11-08T00:00:00Z"}},
             {"type": "Place", "content": [
                 {"name": {"name": "Milano"}, "address_type": "city", "osm_key": "place", "osm_value": "city",
                  "centroid": [9.19, 45.4642], "bbox": [9.04, 45.536, 9.278, 45.386], "importance": 0.9,
                  "address": address},
                 {"name": {"name": "Roma"}, "address_type": "city", "osm_key": "place", "osm_value": "city",
                  "centroid": [12.4829, 41.8933], "bbox": [12.234, 42.141, 12.856, 41.655], "importance": 0.95,
                  "address": {"city": "Roma", "county": "Roma", "state": "Lazio"}},
                 {"name": {"name": "Via Giuseppe Garibaldi"}, "address_type": "street", "osm_key": "highway",
                  "osm_value": "residential", "centroid": [9.1854, 45.4762], "postcode": "20121", "importance": 0.2,
                  "address": address, "geometry": {"type": "LineString", "coordinates": [[9.18, 45.47], [9.19, 45.48]]}},
                 {"housenumber": "12", "centroid": [9.1851, 45.4738], "postcode": "20121",
                  "address": {**address, "street": "Via Giuseppe Garibaldi"}},
             ]}]
    for i in range(1200):
        lines.append({"type": "Place", "content": {
            "name": {"name": f"Via Prova {i}"}, "address_type": "street", "osm_key": "highway",
            "osm_value": "residential", "centroid": [10 + i / 1000, 44], "postcode": "40100", "importance": 0.01,
            "address": {"city": "Bologna", "county": "Bologna", "state": "Emilia-Romagna"}}})
    return "\n".join(json.dumps(line) for line in lines) + "\n"


def build_index(path):
    result = subprocess.run([sys.executable, os.path.join(PI, "build-search-index.py"), "--out", path],
                            input=photon_dump(), capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 0, result.stderr


def downgrade_to_1x(path):
    """Rewrites an index in the layout of raspberry-hub 1.x (Italian names), to test --migrate."""
    db = sqlite3.connect(path)
    renames = {"entries": ("voci", {"type": "tipo", "name": "nome", "name_norm": "nn", "city": "comune",
                                     "city_norm": "cn", "postcode": "cap", "province": "prov", "region": "regione",
                                     "district": "zona", "west": "o", "south": "s", "east": "e", "north": "n",
                                     "importance": "imp", "segments": "pezzi", "class": "classe"}),
               "house_numbers": ("civici", {"street_norm": "nn", "number": "numero"}),
               "meta": ("meta", {"key": "chiave", "value": "valore"})}
    db.execute("DROP TABLE entries_fts")
    for table, (old_table, columns) in renames.items():
        for column, old_column in columns.items():
            db.execute(f'ALTER TABLE "{table}" RENAME COLUMN "{column}" TO "{old_column}"')
        if old_table != table:
            db.execute(f'ALTER TABLE "{table}" RENAME TO "{old_table}"')
    db.execute("UPDATE voci SET tipo = CASE tipo WHEN 'street' THEN 'via' WHEN 'place' THEN 'luogo' ELSE tipo END")
    db.execute("UPDATE voci SET classe = 'tipo=' || substr(classe, 7) WHERE classe LIKE 'level=%'")
    db.execute("UPDATE voci SET classe = 'indirizzo' WHERE classe = 'address'")
    for new, old in (("data_date", "dati"), ("streets", "vie"), ("house_numbers", "civici"), ("places", "luoghi")):
        db.execute("UPDATE meta SET chiave = ? WHERE chiave = ?", (old, new))
    db.execute("UPDATE meta SET valore = '2' WHERE chiave = 'schema'")
    db.execute("CREATE VIRTUAL TABLE testo USING fts5(nome, luogo, cella, content='')")
    db.commit()
    db.close()


class AddressIndex(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.mkdtemp()
        cls.db = os.path.join(cls.folder, "addresses.db")
        build_index(cls.db)
        cls.search = load("hub_search", "hub-search.py")
        cls.builder = os.path.join(PI, "build-search-index.py")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.folder, ignore_errors=True)

    def run_search(self, db, query):
        self.search.DB = db
        connection = self.search.open_db()
        try:
            return self.search.search(connection, query)
        finally:
            connection.close()

    def test_check_and_date(self):
        self.assertEqual(subprocess.run([sys.executable, self.builder, "--check", self.db]).returncode, 0)
        date = subprocess.run([sys.executable, self.builder, "--date", self.db], capture_output=True, text=True)
        self.assertEqual(date.stdout.strip(), "2026-11-08")

    def test_place(self):
        first = self.run_search(self.db, "milano")[0]
        self.assertEqual((first["type"], first["name"], first["class"]), ("place", "Milano", "city"))
        self.assertEqual(first["detail"], "Milano, Lombardia")

    def test_house_number(self):
        found = self.run_search(self.db, "via garibaldi 12 milano")[0]
        self.assertEqual((found["type"], found["name"]), ("house_number", "Via Giuseppe Garibaldi 12"))
        self.assertTrue(found["exact_number"])

    def test_missing_house_number(self):
        found = self.run_search(self.db, "via garibaldi 99 milano")[0]
        self.assertEqual((found["type"], found["missing_number"]), ("street", "99"))

    def test_postcode(self):
        found = self.run_search(self.db, "20121")[0]
        self.assertEqual((found["type"], found["name"], found["streets"]), ("postcode", "20121", 1))

    def test_migrating_a_1x_index(self):
        old = os.path.join(self.folder, "old.db")
        build_index(old)
        downgrade_to_1x(old)
        result = subprocess.run([sys.executable, self.builder, "--migrate", old], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.run_search(old, "via garibaldi 12 milano")[0]["type"], "house_number")
        again = subprocess.run([sys.executable, self.builder, "--migrate", old], capture_output=True, text=True)
        self.assertIn("already up to date", again.stdout)


class UpgradeFrom1x(unittest.TestCase):
    """hub-migrate.py on a fake root with the files of a raspberry-hub 1.x installation."""

    def setUp(self):
        self.root = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def path(self, p):
        return os.path.join(self.root, p.lstrip("/"))

    def write(self, p, text):
        os.makedirs(os.path.dirname(self.path(p)), exist_ok=True)
        with open(self.path(p), "w", encoding="utf-8") as f:
            f.write(text)

    def read(self, p):
        with open(self.path(p), encoding="utf-8") as f:
            return f.read()

    def migrate(self):
        result = subprocess.run([sys.executable, os.path.join(PI, "hub-migrate.py")], capture_output=True, text=True,
                                env={**os.environ, "HUB_MIGRATE_ROOT": self.root})
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_upgrade(self):
        self.write("/srv/hub/config/servizi.json", json.dumps({"servizi": [
            {"id": "pihole", "nome": "Pi-hole", "descrizione": "Blocco", "url": "/admin/", "icona": "/icone/pihole.svg", "tipo": "pihole"},
            {"id": "mappe", "nome": "Mappe", "url": "/mappe/", "icona": "/icone/mappe.svg", "tipo": "unita",
             "unita": "hub-search.service", "richiede": "/srv/hub/maps/italia.pmtiles", "facoltativa": True,
             "senza_unita": "Ricerca degli indirizzi non attiva"},
            {"id": "u-1a2b3c4d", "nome": "NAS", "descrizione": "Foto", "url": "http://192.168.1.20/",
             "icona": "/icone/0123456789abcdef.png", "tipo": "link", "aggiunto": True},
            {"id": "stampante", "nome": "Stampante", "url": "/stampante/", "tipo": "unita", "unita": "cups.service",
             "verifica": "tcp://127.0.0.1:631"},
        ]}))
        self.write("/srv/hub/icone/0123456789abcdef.png", "png")
        self.write("/srv/hub/icone/mappe.svg", "<svg/>")
        self.write("/srv/hub/stato/mappe.esito", "errore: download interrotto\n")
        self.write("/srv/hub/stato/wiki.esito", "ok\n")
        self.write("/srv/hub/maps/italia.pmtiles", "tiles")
        self.write("/srv/hub/maps/italia.build", "20261116.pmtiles")
        self.write("/etc/hub-control/credenziali.json", json.dumps({"utente": "admin", "salt": "s", "hash": "h"}))
        self.write("/etc/hub-control/unita-consentite", "kiwix-hub.service\nhub-search.service\ncups.service\n")
        self.write("/var/lib/hub-control/mappe.off", "")
        self.write("/var/lib/hub-control/sessioni.json", "{}")
        self.write("/var/lib/hub-control/.stato-iniziale", "")
        self.write("/etc/hub.conf", "# vecchio\nWIKI_LINGUA=it\nWIKI_VARIANTE=nopic\nMAPPE_MAXZOOM=14\nHUB_DIR=/srv/hub\n")
        self.write("/etc/caddy/servizi/000-vuoto.caddy", "#")
        self.write("/etc/caddy/servizi/stampante.caddy", "handle /stampante/* {}")
        self.write("/etc/caddy/pubblico/ca.crt", "CA")
        self.write("/usr/local/sbin/hub-servizio", "#!/bin/sh")
        self.write("/etc/systemd/system/cups.service.d/hub-control.conf",
                   "# Spento dall'hub: resta spento anche dopo un riavvio.\n[Unit]\nConditionPathExists=!/var/lib/hub-control/stampante.off\n")
        os.makedirs(self.path("/srv/hub/search"))
        build_index(self.path("/srv/hub/search/indirizzi.db"))
        downgrade_to_1x(self.path("/srv/hub/search/indirizzi.db"))

        self.migrate()

        services = {s["id"]: s for s in json.loads(self.read("/srv/hub/config/services.json"))["services"]}
        self.assertEqual(list(services), ["pihole", "maps", "u-1a2b3c4d", "stampante"])
        self.assertEqual(services["maps"]["requires"], "/srv/hub/maps/basemap.pmtiles")
        self.assertEqual(services["maps"]["optional_detail"], "address_search_off")
        self.assertEqual(services["u-1a2b3c4d"], {"id": "u-1a2b3c4d", "name": "NAS", "description": "Foto",
                                                  "url": "http://192.168.1.20/", "icon": "/icons/0123456789abcdef.png",
                                                  "type": "link", "added": True})
        self.assertEqual(services["stampante"]["type"], "unit")
        self.assertEqual(services["stampante"]["check"], "tcp://127.0.0.1:631")
        self.assertTrue(os.path.exists(self.path("/srv/hub/icons/0123456789abcdef.png")))
        self.assertTrue(os.path.exists(self.path("/srv/hub/icons/maps.svg")))
        self.assertFalse(os.path.exists(self.path("/srv/hub/icone")))
        self.assertEqual(self.read("/srv/hub/state/maps.result"), "error: download interrotto\n")
        self.assertEqual(self.read("/srv/hub/maps/basemap.build"), "20261116.pmtiles")
        self.assertEqual(json.loads(self.read("/etc/hub-control/credentials.json"))["username"], "admin")
        self.assertIn("cups.service", self.read("/etc/hub-control/allowed-units"))
        self.assertTrue(os.path.exists(self.path("/var/lib/hub-control/maps.off")))
        self.assertFalse(os.path.exists(self.path("/var/lib/hub-control/sessioni.json")))
        conf = self.read("/etc/hub.conf")
        self.assertIn("WIKI_VARIANT=nopic", conf)
        self.assertIn("MAP_MAXZOOM=14", conf)
        self.assertIn("ADDRESS_DUMP_URL=https://", conf)
        self.assertNotIn("WIKI_LINGUA", conf)
        self.assertEqual(sorted(os.listdir(self.path("/etc/caddy/services"))), ["stampante.caddy"])
        self.assertTrue(os.path.exists(self.path("/etc/caddy/public/ca.crt")))
        self.assertFalse(os.path.exists(self.path("/usr/local/sbin/hub-servizio")))
        self.assertTrue(self.read("/etc/systemd/system/cups.service.d/hub-control.conf").startswith("# Turned off"))
        db = sqlite3.connect(self.path("/srv/hub/search/addresses.db"))
        self.assertEqual(db.execute("SELECT value FROM meta WHERE key = 'schema'").fetchone()[0], "3")
        db.close()

        self.assertIn("nothing to migrate", self.migrate())


@unittest.skipUnless(sys.platform.startswith("linux"), "hub-control reads /proc")
class HubControl(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.mkdtemp()
        hub = os.path.join(cls.folder, "hub")
        os.makedirs(os.path.join(hub, "config"))
        os.makedirs(os.path.join(hub, "icons"))
        shutil.copy(os.path.join(PI, "services.json"), os.path.join(hub, "config", "services.json"))
        credentials = os.path.join(cls.folder, "credentials.json")
        setpass = load("setpass", "hub-control-setpass")
        import base64
        salt = b"0123456789abcdef"
        derived = setpass.hashlib.scrypt(b"test1234", salt=salt, n=16384, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024)
        with open(credentials, "w", encoding="utf-8") as f:
            json.dump({"username": "admin", "salt": base64.b64encode(salt).decode(),
                       "hash": base64.b64encode(derived).decode(), "n": 16384, "r": 8, "p": 1}, f)
        cls.port = free_port()
        cls.server = subprocess.Popen(
            [sys.executable, os.path.join(PI, "hub-control.py")],
            env={**os.environ, "HUB_CONTROL_PORT": str(cls.port), "HUB_DIR": hub, "HUB_CONTROL_STATE": cls.folder,
                 "HUB_CONTROL_CREDENTIALS": credentials, "HUB_CONTROL_UNITS": os.path.join(cls.folder, "units"),
                 "HUB_LOG_PORT": str(free_port()), "HUB_INSECURE_COOKIE": "1",
                 "HUB_PIHOLE_API": "http://127.0.0.1:9/api"},
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", cls.port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(10)
        shutil.rmtree(cls.folder, ignore_errors=True)

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        connection.request(method, path, json.dumps(body) if body is not None else None,
                           {"Content-Type": "application/json", **(headers or {})})
        response = connection.getresponse()
        data = json.loads(response.read() or b"null")
        connection.close()
        return response.status, data, response.getheader("Set-Cookie")

    def test_status_is_public(self):
        status, data, _ = self.request("GET", "/control/status")
        self.assertEqual(status, 200)
        self.assertFalse(data["authenticated"])
        self.assertTrue(data["configured"])

    def test_system_readings(self):
        time.sleep(5.5)                            # the monitor samples every 5 seconds
        status, data, _ = self.request("GET", "/control/system")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(data["cpu"]["count"], 1)

    def test_writes_need_the_hub_header(self):
        status, data, _ = self.request("POST", "/control/login", {"username": "admin", "password": "test1234"})
        self.assertEqual((status, data["error"]), (403, "foreign_request"))

    def test_login_and_add_a_service(self):
        hub = {"X-Hub": "1"}
        status, data, _ = self.request("POST", "/control/login", {"username": "admin", "password": "nope"}, hub)
        self.assertEqual((status, data["error"]), (401, "bad_credentials"))
        self.assertIn("attempts_left", data)
        status, data, cookie = self.request("POST", "/control/login", {"username": "admin", "password": "test1234"}, hub)
        self.assertEqual(status, 200)
        session = cookie.split(";", 1)[0]
        self.assertTrue(session.startswith("hub_session="))
        logged_in = {**hub, "Cookie": session}
        status, data, _ = self.request("POST", "/control/services", {"name": "NAS", "url": "ftp://nas"}, logged_in)
        self.assertEqual((status, data["error"]), (400, "invalid_url"))
        status, data, _ = self.request("POST", "/control/services", {"name": "NAS", "url": "http://192.0.2.10/"}, logged_in)
        self.assertEqual(status, 200)
        self.assertTrue(data["service"]["id"].startswith("u-"))
        status, data, _ = self.request("POST", "/control/services/pihole", {"name": "x", "url": "/x"}, logged_in)
        self.assertEqual((status, data["error"]), (404, "not_editable"))
        status, data, _ = self.request("POST", "/control/services/wikipedia/switch", {"on": False}, hub)
        self.assertEqual((status, data["error"]), (401, "login_required"))


if __name__ == "__main__":
    unittest.main()
