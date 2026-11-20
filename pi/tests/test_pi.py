"""Smoke tests for the scripts that run on the Raspberry Pi. Standard library only:

    python3 -m unittest discover -s pi/tests -v

They build a small address index from a made-up Photon dump, search it, convert an index in the 1.x
layout, upgrade a fake 1.x installation with hub-migrate.py and talk to hub-control.py over HTTP.
The hub-control test needs Linux (/proc); the others run anywhere.
"""
import base64
import contextlib
import hashlib
import http.client
import importlib.util
import io
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

PI =os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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


def write_credentials(path, password=b"test1234"):
    """The same format hub-control-setpass writes."""
    salt = b"0123456789abcdef"
    derived = hashlib.scrypt(password, salt=salt, n=16384, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"username": "admin", "salt": base64.b64encode(salt).decode(),
                   "hash": base64.b64encode(derived).decode(), "n": 16384, "r": 8, "p": 1}, f)


def start_hub_control(port, hub, state, credentials, **extra):
    """hub-control.py on a free port, with its files in temporary folders; returns once it answers."""
    server = subprocess.Popen(
        [sys.executable, os.path.join(PI, "hub-control.py")],
        env={**os.environ, "HUB_CONTROL_PORT": str(port), "HUB_DIR": hub, "HUB_CONTROL_STATE": state,
             "HUB_CONTROL_CREDENTIALS": credentials, "HUB_CONTROL_UNITS": os.path.join(state, "units"),
             "HUB_LOG_PORT": str(free_port()), "HUB_INSECURE_COOKIE": "1",
             "HUB_PIHOLE_API": "http://127.0.0.1:9/api", **extra},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for _ in range(50):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    return server


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

    def test_new_settings_are_added_to_hub_conf(self):
        with open(os.path.join(PI, "hub.conf"), encoding="utf-8") as f:
            template = f.read()
        # a 2.0 file: the settings of that time, one changed by hand, without the newer ones
        old = template.split("# New versions")[0].replace("WIKI_VARIANT=maxi", "WIKI_VARIANT=nopic")
        self.write("/etc/hub.conf", old)
        self.assertIn("CHECK_FOR_UPDATES", self.migrate())
        conf = self.read("/etc/hub.conf")
        self.assertTrue(conf.startswith(old))
        self.assertIn("WIKI_VARIANT=nopic", conf)
        self.assertIn("# New versions: once a day", conf)
        self.assertEqual(conf.count("CHECK_FOR_UPDATES=yes"), 1)
        self.assertEqual(conf.count("NOTIFY_NEW_VERSION="), 1)
        self.assertEqual(conf.count("WATCHDOG=no"), 1)
        self.assertIn("nothing to migrate", self.migrate())
        self.assertEqual(self.read("/etc/hub.conf"), conf)


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
        write_credentials(credentials)
        cls.port = free_port()
        cls.server = start_hub_control(cls.port, hub, cls.folder, credentials)

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
        self.assertIn("version", data)             # None here: hub-install.sh writes the VERSION file

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

    def test_the_month_only_when_asked(self):
        status, data, _ = self.request("GET", "/control/system/history")
        self.assertEqual((status, sorted(data)), (200, ["day", "power", "recent"]))
        status, data, _ = self.request("GET", "/control/system/history?period=month")
        self.assertEqual((status, list(data), data["month"]["step"]), (200, ["month"], 3600))
        self.assertIsInstance(data["month"]["points"], list)
        status, data, _ = self.request("GET", "/control/system/history?period=year")
        self.assertEqual((status, data["error"]), (400, "invalid_request"))


@unittest.skipUnless(sys.platform.startswith("linux"), "hub-control reads /proc")
class UpgradeButton(unittest.TestCase):
    """POST /control/upgrade: the "Update" button accepts only the latest release found by the daily check."""

    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.mkdtemp()
        cls.hub = os.path.join(cls.folder, "hub")
        os.makedirs(os.path.join(cls.hub, "config"))
        os.makedirs(os.path.join(cls.hub, "state"))
        credentials = os.path.join(cls.folder, "credentials.json")
        write_credentials(credentials)
        cls.version = os.path.join(cls.folder, "VERSION")
        with open(cls.version, "w", encoding="utf-8") as f:
            f.write("2.0.1\n")
        cls.port = free_port()
        cls.server = start_hub_control(cls.port, cls.hub, cls.folder, credentials, HUB_VERSION_FILE=cls.version)

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(10)
        shutil.rmtree(cls.folder, ignore_errors=True)

    request = HubControl.request

    def state(self, name, data=None):
        path = os.path.join(self.hub, "state", name)
        if data is None:
            if os.path.exists(path):
                os.remove(path)
            return
        with open(path, "w", encoding="utf-8") as f:
            f.write(data if isinstance(data, str) else json.dumps(data))

    def test_the_update_button(self):
        self.state("latest.json")
        status, data, _ = self.request("GET", "/control/upgrade")
        self.assertEqual((status, data["installed"], data["latest"], data["newer"]), (200, "2.0.1", None, False))
        hub = {"X-Hub": "1"}
        status, data, _ = self.request("POST", "/control/upgrade", {"version": "2.1.0"}, hub)
        self.assertEqual((status, data["error"]), (401, "login_required"))
        _, _, cookie = self.request("POST", "/control/login", {"username": "admin", "password": "test1234"}, hub)
        logged_in = {**hub, "Cookie": cookie.split(";", 1)[0]}

        status, data, _ = self.request("POST", "/control/upgrade", {"version": "2.1.0"}, logged_in)
        self.assertEqual((status, data["error"]), (400, "not_latest"))          # no daily check yet
        self.state("latest.json", {"version": "2.1.0", "url": "https://example.invalid", "notes": "### Features"})
        status, data, _ = self.request("GET", "/control/upgrade")
        self.assertEqual((data["latest"]["version"], data["newer"]), ("2.1.0", True))
        for wanted in ("2.1.1", "../../etc", "2.1.0; reboot", None):
            status, data, _ = self.request("POST", "/control/upgrade", {"version": wanted}, logged_in)
            self.assertEqual((status, data["error"]), (400, "not_latest"), wanted)
        self.state("upgrade.json", {"version": "2.1.0", "step": "install"})
        status, data, _ = self.request("POST", "/control/upgrade", {"version": "2.1.0"}, logged_in)
        self.assertEqual((status, data["error"]), (409, "upgrade_running"))
        self.state("upgrade.json", {"version": "2.1.0", "step": "failed", "error": "download_failed"})
        self.state("maps.running", "")
        status, data, _ = self.request("POST", "/control/upgrade", {"version": "2.1.0"}, logged_in)
        self.assertEqual((status, data["error"]), (409, "content_update_running"))
        self.state("maps.running")
        # everything allowed: here systemctl refuses an unknown unit (on the Pi the polkit rule allows it)
        status, data, _ = self.request("POST", "/control/upgrade", {"version": "2.1.0"}, logged_in)
        self.assertEqual((status, data["error"]), (502, "upgrade_not_started"))
        self.state("latest.json", {"version": "2.0.1"})
        status, data, _ = self.request("POST", "/control/upgrade", {"version": "2.0.1"}, logged_in)
        self.assertEqual((status, data["error"]), (409, "up_to_date"))


@unittest.skipUnless(sys.platform.startswith("linux"), "hub-control reads /proc")
class MonthHistory(unittest.TestCase):
    """The last month in Trends: one point per hour with the average and the peak of every 5 s sample. It is
    kept in memory and written to the state folder only when the service stops, and at most once a day, so a
    restart does not empty it and the SD card is not written in the sampling loop."""

    def setUp(self):
        self.folder = tempfile.mkdtemp()
        with mock.patch.dict(os.environ, {"HUB_DIR": self.folder, "HUB_CONTROL_STATE": self.folder,
                                          "HUB_CHECK_REPORT": os.path.join(self.folder, "hub-check.json")}):
            self.control = load("hub_control_month", "hub-control.py")
        self.hour = int(time.time() // 3600) * 3600 - 5 * 3600      # five hours ago, at the start of the hour

    def tearDown(self):
        shutil.rmtree(self.folder, ignore_errors=True)

    def fill(self, monitor, hours, cpu=10.0, temp=50.0):
        """One sample every 5 s for the given number of hours from self.hour, then the first one after them."""
        for i in range(hours * 720 + 1):
            monitor.add_to_hour(self.hour + i * 5, cpu, temp)

    def saved(self):
        with open(self.control.MONTH_FILE, encoding="utf-8") as f:
            return json.load(f)

    def test_one_point_per_hour_with_the_average_and_the_peak(self):
        monitor = self.control.Monitor()
        for i in range(720):                       # one hour, with a 5 s spike of processor and temperature
            monitor.add_to_hour(self.hour + i * 5, 95.0 if i == 100 else 10.0, 71.0 if i == 200 else 50.0)
        self.assertEqual(list(monitor.month), [])  # the hour is not over yet
        monitor.add_to_hour(self.hour + 3600, 20.0, None)
        self.assertEqual(list(monitor.month), [[self.hour, 10.1, 95.0, 50.0, 71.0, 0, 0]])
        month = monitor.history("month")["month"]
        self.assertEqual(month["step"], 3600)
        # the hour so far comes last; no temperature reading means null, not 0
        self.assertEqual(month["points"][-1], [self.hour + 3600, 20.0, 20.0, None, None, 0, 0])
        self.assertEqual(sorted(monitor.history()), ["day", "power", "recent"])

    def test_a_clock_going_back_adds_no_point_out_of_order(self):
        monitor = self.control.Monitor()
        self.fill(monitor, 2)
        monitor.add_to_hour(self.hour - 3600, 10.0, 50.0)            # closes the third hour
        monitor.add_to_hour(self.hour, 10.0, 50.0)                   # closes the hour before the first
        times = [p[0] for p in monitor.month]
        self.assertEqual(times, sorted(set(times)))
        self.assertEqual(len(times), 3)

    def test_saved_and_read_back(self):
        monitor = self.control.Monitor()
        self.fill(monitor, 3)
        monitor.save_month()
        self.assertEqual([p[0] for p in self.saved()["points"]], [self.hour, self.hour + 3600, self.hour + 7200])
        again = self.control.Monitor()
        self.assertEqual(list(again.month), list(monitor.month))

    def test_old_and_damaged_points_are_dropped_when_read(self):
        old = self.hour - 31 * 86400
        with open(self.control.MONTH_FILE, "w", encoding="utf-8") as f:
            json.dump({"step": 3600, "points": [
                [self.hour + 3600, 12.0, 30.0, None, None], [old, 1.0, 1.0, 40.0, 40.0], "nonsense",
                [self.hour, True, 2.0, 40.0, 40.0], [self.hour, 11.0, 20.0, 45.5, 48.0], [self.hour, 1.0],
                [self.hour + 7200, 9.0, 9.0, 41.0, 42.0, 2, 1], [self.hour + 10800, 9.0, 9.0, 41.0, 42.0, -1, 0]]}, f)
        monitor = self.control.Monitor()
        # points saved before the power episodes were counted (5 values) get no episodes
        self.assertEqual(list(monitor.month),
                         [[self.hour, 11.0, 20.0, 45.5, 48.0, 0, 0], [self.hour + 3600, 12.0, 30.0, None, None, 0, 0],
                          [self.hour + 7200, 9.0, 9.0, 41.0, 42.0, 2, 1]])

    def test_a_damaged_file_means_an_empty_month(self):
        with open(self.control.MONTH_FILE, "w", encoding="utf-8") as f:
            f.write("{not json")
        with contextlib.redirect_stdout(io.StringIO()) as log:
            monitor = self.control.Monitor()
        self.assertEqual(list(monitor.month), [])
        self.assertIn("not readable", log.getvalue())

    def test_written_at_most_once_a_day_while_running(self):
        monitor = self.control.Monitor()
        self.fill(monitor, 2)
        self.assertFalse(os.path.exists(self.control.MONTH_FILE))   # started less than a day ago
        monitor._saved -= 86401
        self.hour += 2 * 3600
        self.fill(monitor, 1)                                         # the next hour that closes saves
        self.assertTrue(os.path.exists(self.control.MONTH_FILE))
        os.remove(self.control.MONTH_FILE)
        self.hour += 3600
        self.fill(monitor, 1)
        self.assertFalse(os.path.exists(self.control.MONTH_FILE))

    def test_power_episodes(self):
        monitor = self.control.Monitor()
        # vcgencmd get_throttled every 30 s: under-voltage starts, goes on, ends; throttling for a while; then a
        # dip shorter than 30 s, seen only in the "since boot" bit; a start in the first reading counts too
        readings = ["0x0", "0x10001", "0x10001", "0x10000", "0x50006", "0x50000", "0x50000"]
        times = [self.hour + 60 + 30 * i for i in range(len(readings))]
        with mock.patch.object(self.control, "run", side_effect=[(True, f"throttled={r}") for r in readings]):
            for now in times:
                monitor._read_power(now)
        self.assertEqual(list(monitor.power_events), [[times[1], "undervoltage"], [times[4], "throttled"]])
        with mock.patch.object(self.control, "run", side_effect=[(True, "throttled=0x0"), (True, "throttled=0x10000")]):
            fresh = self.control.Monitor()
            fresh._read_power(times[0])
            fresh._read_power(times[1])
        self.assertEqual(list(fresh.power_events), [[times[1], "undervoltage"]])
        with mock.patch.object(self.control, "run", return_value=(True, "throttled=0x1")):
            first = self.control.Monitor()
            first._read_power(times[0])
        self.assertEqual(list(first.power_events), [[times[0], "undervoltage"]])

        self.fill(monitor, 1)                       # the hour of the episodes closes: they are counted in it
        self.assertEqual(list(monitor.month)[0][5:], [1, 1])
        self.assertEqual(monitor.history()["power"]["events"], [[times[1], "undervoltage"], [times[4], "throttled"]])

    def test_the_device_of_the_content(self):
        mounts = os.path.join(self.folder, "mounts")
        with open(mounts, "w", encoding="utf-8") as f:
            f.write("/dev/mmcblk0p2 / ext4 rw 0 0\n/dev/mmcblk0p1 /boot/firmware vfat rw 0 0\n"
                    "tmpfs /run tmpfs rw 0 0\n")
        with mock.patch.object(self.control, "MOUNTS", mounts):
            self.assertEqual(self.control.storage_device("/srv/hub"), ("mmcblk0p2", "sd"))
            with open(mounts, "a", encoding="utf-8") as f:
                f.write("/dev/sda1 /srv/hub ext4 rw,nofail 0 0\n")
            self.assertEqual(self.control.storage_device("/srv/hub")[0], "sda1")
            self.assertEqual(self.control.storage_device("/srv/hubble"), ("mmcblk0p2", "sd"))
            self.assertEqual(self.control.storage_device("/run/x"), ("", "other"))

    def test_a_failed_check_after_boot_is_an_alert(self):
        monitor = self.control.Monitor()
        self.assertIsNone(monitor._read_check(1000))
        with open(self.control.CHECK_REPORT, "w", encoding="utf-8") as f:
            json.dump({"time": "2026-11-20T08:00:00+0100", "passed": 30, "failed": 2, "skipped": 3,
                       "failures": ["caddy running", "hub home page"]}, f)
        self.assertIsNone(monitor._read_check(1030))   # read once a minute
        self.assertEqual(monitor._read_check(1061),
                         {"time": "2026-11-20T08:00:00+0100", "failed": 2, "failures": ["caddy running", "hub home page"]})

    def test_saved_when_the_service_stops(self):
        server = start_hub_control(free_port(), self.folder, self.folder, os.path.join(self.folder, "none.json"))
        server.terminate()                         # SIGTERM, as systemctl stop does
        server.wait(10)
        self.assertEqual(self.saved(), {"step": 3600, "points": []})


@unittest.skipUnless(sys.platform.startswith("linux"), "hub-control reads /proc")
class ResponseHeaders(unittest.TestCase):
    """Handler.reply() is the only way out for response headers: nothing with a control character in it is
    sent, because http.server writes header values exactly as given and a CR or LF would split the response."""

    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.mkdtemp()
        with mock.patch.dict(os.environ, {"HUB_DIR": cls.folder, "HUB_CONTROL_STATE": cls.folder}):
            cls.control = load("hub_control", "hub-control.py")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.folder, ignore_errors=True)

    def reply(self, headers):
        """What reply() writes on the connection: the header lines and the JSON body."""
        handler = self.control.Handler.__new__(self.control.Handler)     # no socket: the response goes to a buffer
        handler.request_version = "HTTP/1.1"
        handler.requestline = "POST /control/login HTTP/1.1"
        handler.wfile = io.BytesIO()
        log = io.StringIO()
        with contextlib.redirect_stdout(log):
            handler.reply(200, {"ok": True}, headers)
        head, _, body = handler.wfile.getvalue().partition(b"\r\n\r\n")
        return head.decode("latin-1").split("\r\n"), json.loads(body), log.getvalue()

    def test_a_header_with_a_line_break_is_never_sent(self):
        lines, body, log = self.reply([("Set-Cookie", "hub_session=x\r\nX-Injected: 1")])
        self.assertEqual(lines[0], "HTTP/1.1 500 Internal Server Error")
        self.assertEqual(body["error"], "internal_error")
        self.assertFalse([line for line in lines if line.lower().startswith(("set-cookie", "x-injected"))])
        self.assertIn("'Set-Cookie'", log)

    def test_other_control_characters_are_refused_too(self):
        for value in ("a\nb", "a\rb", "a\x00b", "a\x7fb"):
            lines, body, _ = self.reply([("X-Test", value)])
            self.assertEqual(body["error"], "internal_error", repr(value))
        lines, body, _ = self.reply([("X-Test\r\n", "ok")])
        self.assertEqual(body["error"], "internal_error")

    def test_the_session_cookie_still_goes_out(self):
        token = "Ab0_-" * 9                                              # the shape of secrets.token_urlsafe(32)
        cookie = self.control.Handler.cookie(None, token, 60)
        lines, body, log = self.reply([cookie])
        self.assertEqual(lines[0], "HTTP/1.1 200 OK")
        self.assertEqual(body, {"ok": True})
        self.assertIn(f"Set-Cookie: hub_session={token}; Path=/control; Max-Age=60; HttpOnly; SameSite=Strict"
                      + ("; Secure" if self.control.SECURE_COOKIE else ""), lines)
        self.assertEqual(log, "")


class ReleaseUpgrade(unittest.TestCase):
    """hub-upgrade.py (sudo hub-install.sh upgrade) against a fake GitHub release served on this computer."""

    @classmethod
    def setUpClass(cls):
        cls.files = {}
        test = cls

        class Release(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path == "/control/status":                 # hub-control after the installation
                    body = json.dumps({"version": test.read_version()}).encode()
                else:
                    body = test.files.get(self.path)
                self.send_response(200 if body is not None else 404)
                self.end_headers()
                self.wfile.write(body or b"{}")

        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Release)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.lib = os.path.join(self.root, "lib")
        self.hub = os.path.join(self.root, "hub")
        self.home = os.path.join(self.root, "pi-setup", "hub")
        os.makedirs(self.lib)
        os.makedirs(os.path.join(self.hub, "state"))
        self.write_version("2.0.1")
        ReleaseUpgrade.read_version = staticmethod(lambda: self.read(os.path.join(self.lib, "VERSION")).strip())
        self.files.clear()
        self.publish("2.1.0", latest=True)
        self.publish("3.0.0")
        self.publish("2.2.0", prerelease=True)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    @staticmethod
    def read(path):
        with open(path, encoding="utf-8") as f:
            return f.read()

    def write_version(self, value):
        with open(os.path.join(self.lib, "VERSION"), "w", encoding="utf-8") as f:
            f.write(value + "\n")

    def publish(self, version, latest=False, prerelease=False, checksum=None):
        """A release on the fake GitHub: its API entry, the package and SHA256SUMS."""
        name = f"raspberry-hub-{version}"
        folder = os.path.join(self.root, "build", name)
        os.makedirs(folder)
        with open(os.path.join(folder, "hub-install.sh"), "w", encoding="utf-8", newline="\n") as f:
            f.write(f'#!/bin/bash\necho "installer of {version}: $1"\nprintf "{version}\\n" > "$HUB_LIB/VERSION"\n')
        with open(os.path.join(folder, "UPGRADING.md"), "w", encoding="utf-8") as f:
            f.write("# Upgrading\n\n## From 2.x to 3.0\n\nEverything moved.\n\n## From 1.x to 2.0\n\nOld news.\n")
        package = os.path.join(self.root, "build", name + ".tar.gz")
        with tarfile.open(package, "w:gz") as archive:
            archive.add(folder, name)
        with open(package, "rb") as f:
            data = f.read()
        entry = json.dumps({"tag_name": f"v{version}", "html_url": f"https://example.invalid/v{version}",
                            "prerelease": prerelease, "body": "### Features\n\n* something"}).encode()
        self.files[f"/api/tags/v{version}"] = entry
        if latest:
            self.files["/api/latest"] = entry
        self.files[f"/download/v{version}/{name}.tar.gz"] = data
        self.files[f"/download/v{version}/SHA256SUMS"] = \
            f"{checksum or hashlib.sha256(data).hexdigest()}  {name}.tar.gz\n".encode()

    def upgrade(self, *args):
        env = {**os.environ, "HUB_RELEASES_API": self.base + "/api", "HUB_RELEASES_DOWNLOAD": self.base + "/download",
               "HUB_LIB": self.lib, "HUB_DIR": self.hub, "HUB_HOME": self.home, "ADMIN_USER": "pi",
               "HUB_UPGRADE_LOCK": os.path.join(self.root, "lock"), "HUB_CONTROL_URL": self.base + "/control/status",
               "HUB_CHECK": os.path.join(self.root, "no-hub-check"), "HUB_UPGRADE_ANY_USER": "1"}
        return subprocess.run([sys.executable, os.path.join(PI, "hub-upgrade.py"), *args], capture_output=True,
                              text=True, env=env, stdin=subprocess.DEVNULL, timeout=120)

    def progress(self):
        return json.loads(self.read(os.path.join(self.hub, "state", "upgrade.json")))

    @unittest.skipUnless(sys.platform.startswith("linux"), "runs the installer of the package with bash")
    def test_the_latest_release_is_installed_and_checked(self):
        result = self.upgrade()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("installer of 2.1.0: all", result.stdout)
        self.assertTrue(os.path.isfile(os.path.join(self.home, "UPGRADING.md")))
        self.assertEqual(self.read(os.path.join(self.lib, "VERSION")).strip(), "2.1.0")
        progress = self.progress()
        self.assertEqual((progress["from"], progress["version"], progress["step"], progress["result"]),
                         ("2.0.1", "2.1.0", "done", "ok"))
        self.assertIn("installer of 2.1.0", self.read(os.path.join(self.hub, "state", "upgrade.log")))
        again = self.upgrade()
        self.assertEqual(again.returncode, 0)
        self.assertIn("2.1.0 is already installed", again.stdout)

    def test_a_package_that_does_not_match_its_checksum_is_not_installed(self):
        self.publish("2.1.1", checksum="0" * 64)
        result = self.upgrade("2.1.1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("SHA-256", result.stderr)
        self.assertEqual((self.progress()["step"], self.progress()["error"]), ("failed", "checksum_mismatch"))
        self.assertFalse(os.path.exists(self.home))

    def test_a_new_major_version_asks_first(self):
        result = self.upgrade("3.0.0")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Everything moved.", result.stdout)          # the section about 3.0, not the others
        self.assertNotIn("Old news.", result.stdout)
        self.assertIn("--yes", result.stderr)
        self.assertEqual(self.progress()["error"], "confirmation_needed")
        self.assertFalse(os.path.exists(self.home))

    def test_older_versions_and_pre_releases_are_refused(self):
        self.write_version("2.1.0")
        self.publish("2.0.9")
        result = self.upgrade("2.0.9")
        self.assertEqual(result.returncode, 1)
        self.assertIn("older", result.stderr)
        result = self.upgrade("2.2.0")
        self.assertEqual(result.returncode, 1)
        self.assertIn("not a published release", result.stderr)
        result = self.upgrade("2.3")
        self.assertIn("not a version", result.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.hub, "state", "upgrade.json")))

    def test_not_during_a_content_update(self):
        with open(os.path.join(self.hub, "state", "maps.running"), "w", encoding="utf-8"):
            pass
        result = self.upgrade()
        self.assertEqual(result.returncode, 1)
        self.assertIn("content update is running", result.stderr)


@unittest.skipUnless(sys.platform.startswith("linux"), "hub-check.sh is a Linux script")
class CheckReport(unittest.TestCase):
    def test_the_report_lists_what_failed(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder, True)
        report = os.path.join(folder, "hub-check.json")
        # nothing of the hub is installed here: most checks fail, which is what the report has to say
        result = subprocess.run(["bash", os.path.join(PI, "hub-check.sh"), "--report", report], capture_output=True,
                                text=True, timeout=300)
        self.assertNotEqual(result.returncode, 0)
        with open(report, encoding="utf-8") as f:
            data = json.load(f)
        self.assertGreater(data["failed"], 0)
        self.assertEqual(len(data["failures"]), data["failed"])
        self.assertIn("caddy running", data["failures"])
        self.assertIn("Result:", result.stdout)


if __name__ == "__main__":
    unittest.main()
