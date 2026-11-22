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
import re
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
import urllib.error
import urllib.request
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


def foreign_dump():
    """Addresses of other countries, as the dump of each would have them: German, Swiss, French, Danish and Greek
    names, with the filler streets the --check of the index needs."""
    def place(name, kind, lon, lat, city, importance, **extra):
        return {"name": {"name": name}, "address_type": kind, "osm_key": "place" if kind == "city" else "highway",
                "osm_value": "city" if kind == "city" else "residential", "centroid": [lon, lat],
                "importance": importance, "address": {"city": city}, **extra}
    lines = [{"type": "NominatimDumpFile", "content": {"data_timestamp": "2026-11-08T00:00:00Z"}},
             {"type": "Place", "content": [
                 place("Berlin", "city", 13.40, 52.52, "Berlin", 0.99),
                 place("Zürich", "city", 8.54, 47.37, "Zürich", 0.9),
                 place("Paris", "city", 2.35, 48.86, "Paris", 0.95),
                 place("Αθήνα", "city", 23.73, 37.98, "Αθήνα", 0.8),
                 place("Hauptstraße", "street", 13.41, 52.53, "Berlin", 0.3, postcode="10115"),
                 place("Bahnhofstrasse", "street", 8.539, 47.372, "Zürich", 0.3, postcode="8001"),
                 place("Rue de la Paix", "street", 2.331, 48.869, "Paris", 0.3, postcode="75002"),
                 place("Nørregade", "street", 12.57, 55.68, "København", 0.2, postcode="1165"),
                 {"housenumber": "5", "centroid": [13.411, 52.531], "postcode": "10115",
                  "address": {"city": "Berlin", "street": "Hauptstraße"}},
                 {"housenumber": "12", "centroid": [2.332, 48.8691], "postcode": "75002",
                  "address": {"city": "Paris", "street": "Rue de la Paix"}},
             ]}]
    for i in range(1100):
        lines.append({"type": "Place", "content": place(f"Teststraße {i}", "street", 10 + i / 1000, 50, "Kassel", 0.01)})
    return "\n".join(json.dumps(line, ensure_ascii=False) for line in lines) + "\n"


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


class AddressesOfOtherCountries(unittest.TestCase):
    """An index built with --languages: the street rules of those languages, letters like ß and ø, other scripts,
    postcodes of 4 digits and house numbers written before the street."""

    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.mkdtemp()
        cls.db = os.path.join(cls.folder, "addresses.db")
        cls.builder = os.path.join(PI, "build-search-index.py")
        result = subprocess.run([sys.executable, cls.builder, "--out", cls.db, "--languages", "de,fr"],
                                input=foreign_dump(), capture_output=True, text=True, encoding="utf-8")
        assert result.returncode == 0, result.stderr
        cls.search = load("hub_search_foreign", "hub-search.py")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.folder, ignore_errors=True)

    def first(self, query):
        self.search.DB = self.db
        connection = self.search.open_db()
        try:
            return self.search.search(connection, query)[0]
        finally:
            connection.close()

    def test_the_index_says_its_languages_and_answers_the_check(self):
        db = sqlite3.connect(self.db)
        meta = dict(db.execute("SELECT key, value FROM meta"))
        db.close()
        self.assertEqual((meta["languages"], meta["norm"]), ("de,fr", "2"))
        # the test search uses the most important place of the index, not "roma"
        self.assertEqual(subprocess.run([sys.executable, self.builder, "--check", self.db]).returncode, 0)

    def test_german_abbreviation_and_sharp_s(self):
        found = self.first("hauptstr. 5 berlin")
        self.assertEqual((found["type"], found["name"]), ("house_number", "Hauptstraße 5"))
        self.assertEqual(self.first("hauptstrasse berlin")["name"], "Hauptstraße")
        self.assertEqual(self.first("Hauptstraße")["name"], "Hauptstraße")

    def test_french_house_number_before_the_street(self):
        found = self.first("12 rue de la paix paris")
        self.assertEqual((found["type"], found["name"]), ("house_number", "Rue de la Paix 12"))

    def test_four_digit_postcode(self):
        found = self.first("8001")
        self.assertEqual((found["type"], found["name"], found["detail"]), ("postcode", "8001", "Zürich"))
        self.assertEqual(self.first("bahnhofstrasse 8001")["name"], "Bahnhofstrasse")

    def test_letters_without_accents_and_other_scripts(self):
        self.assertEqual(self.first("norregade")["name"], "Nørregade")
        self.assertEqual(self.first("αθηνα")["name"], "Αθήνα")

    def test_an_index_of_an_older_version_keeps_the_italian_rules(self):
        index = self.search.Index({"schema": "3"})
        self.assertEqual((index.languages, index.norm_version), (["it"], 1))
        self.assertIn("piazza", index.rules.street_types)
        self.assertEqual(index.norm("Straße"), "stra e")           # as it was built, so that it still matches
        self.assertEqual(self.search.Index({"languages": "", "norm": "2"}).rules.street_types, set())


class CountryChoice(unittest.TestCase):
    """hub-configure.py (sudo hub-install.sh configure) on a copy of hub.conf, without questions."""

    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.conf = os.path.join(self.folder, "hub.conf")
        shutil.copy(os.path.join(PI, "hub.conf"), self.conf)
        with open(os.path.join(PI, "countries.json"), encoding="utf-8") as f:
            self.countries = {c["code"]: c for c in json.load(f)["countries"]}

    def tearDown(self):
        shutil.rmtree(self.folder, ignore_errors=True)

    def configure(self, *args):
        return subprocess.run([sys.executable, os.path.join(PI, "hub-configure.py"), *args], capture_output=True,
                              text=True, stdin=subprocess.DEVNULL, env={**os.environ, "HUB_CONF": self.conf})

    def conf_values(self):
        with open(self.conf, encoding="utf-8") as f:
            return dict(re.findall(r"^([A-Z_]+)=(.*)$", f.read(), re.M))

    def test_the_list_of_countries_is_sound(self):
        languages = set(load("hub_search_rules", "hub-search.py").LANGUAGES)
        self.assertIn("IT", self.countries)
        for code, country in self.countries.items():
            self.assertRegex(code, r"^[A-Z]{2}$")
            west, south, east, north = map(float, country["bbox"].split(","))
            self.assertTrue(-180 <= west < east <= 180 and -90 <= south < north <= 90, code)
            self.assertRegex(country["addresses"], r"^[a-z-]+/[a-z-]+/photon-dump-[a-z-]+-1\.0-latest\.jsonl\.zst$")
            self.assertLessEqual(set(filter(None, country["address_languages"].split(","))), languages, code)
        # the template of hub.conf is the default country
        self.assertEqual(self.conf_values()["MAP_BBOX"], self.countries["IT"]["bbox"])
        self.assertTrue(self.conf_values()["ADDRESS_DUMP_URL"].endswith(self.countries["IT"]["addresses"]))

    def test_choosing_a_country_writes_its_settings_and_nothing_else(self):
        before = self.conf_values()
        result = self.configure("--country", "fr")
        self.assertEqual(result.returncode, 0, result.stderr)
        values = self.conf_values()
        france = self.countries["FR"]
        self.assertEqual((values["MAP_COUNTRY"], values["MAP_BBOX"], values["ADDRESS_LANGUAGES"]),
                         ("FR", france["bbox"], france["address_languages"]))
        self.assertTrue(values["ADDRESS_DUMP_URL"].endswith(france["addresses"]))
        unchanged = {k: v for k, v in before.items()
                     if k not in ("MAP_COUNTRY", "MAP_BBOX", "ADDRESS_DUMP_URL", "ADDRESS_LANGUAGES")}
        self.assertEqual({k: values[k] for k in unchanged}, unchanged)
        with open(self.conf, encoding="utf-8") as f:
            self.assertIn("# Map and address search: the country", f.read())
        self.assertIn("as before", self.configure("--country", "FR").stdout)

    def test_unknown_country_and_no_terminal(self):
        result = self.configure("--country", "XX")
        self.assertEqual(result.returncode, 2)
        self.assertIn("CH  Switzerland", result.stdout)
        # nobody to ask (an upgrade, a script): nothing changes
        before = self.conf_values()
        quiet = self.configure("--first-install")
        self.assertEqual(quiet.returncode, 0, quiet.stderr)
        self.assertIn("Italy", quiet.stdout)
        self.assertEqual(self.conf_values(), before)


KIWIX_LISTING = """<pre>
      <a href="wikipedia_en_all_maxi_2026-07.zim">wikipedia_en_all_maxi_2026-07.zim</a>             2026-07-20 04:42  110G
      <a href="wikipedia_en_all_maxi_2026-10.zim">wikipedia_en_all_maxi_2026-10.zim</a>             2026-10-20 04:42  115G
      <a href="wikipedia_en_all_nopic_2026-10.zim">wikipedia_en_all_nopic_2026-10.zim</a>           2026-10-21 11:25   52G
      <a href="wikipedia_en_all_mini_2026-10.zim">wikipedia_en_all_mini_2026-10.zim</a>             2026-10-09 08:25   12G
      <a href="wikipedia_it_all_maxi_2026-08.zim">wikipedia_it_all_maxi_2026-08.zim</a>             2026-08-13 17:04   30G
      <a href="wikipedia_it_all_nopic_2026-11.zim">wikipedia_it_all_nopic_2026-11.zim</a>           2026-11-16 15:18   10G
      <a href="wikipedia_it_top_mini_2026-11.zim">wikipedia_it_top_mini_2026-11.zim</a>             2026-11-13 13:03  300M
</pre>"""


class WikipediaChoice(unittest.TestCase):
    """The Wikipedia language and variant in hub-configure.py, checked against a copy of the Kiwix listing."""

    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.conf = os.path.join(self.folder, "hub.conf")
        shutil.copy(os.path.join(PI, "hub.conf"), self.conf)
        self.listing = os.path.join(self.folder, "listing.html")
        with open(self.listing, "w", encoding="utf-8") as f:
            f.write(KIWIX_LISTING)

    def tearDown(self):
        shutil.rmtree(self.folder, ignore_errors=True)

    def configure(self, *args):
        url = "file:" + urllib.request.pathname2url(self.listing)
        return subprocess.run([sys.executable, os.path.join(PI, "hub-configure.py"), *args], capture_output=True,
                              text=True, stdin=subprocess.DEVNULL,
                              env={**os.environ, "HUB_CONF": self.conf, "HUB_WIKI_URL": url})

    def values(self):
        with open(self.conf, encoding="utf-8") as f:
            return dict(re.findall(r"^([A-Z_]+)=(.*)$", f.read(), re.M))

    def test_the_listing_gives_the_newest_edition_of_each_variant(self):
        editions = load("hub_configure", "hub-configure.py").kiwix_editions(KIWIX_LISTING)
        self.assertEqual(editions["en"], {"maxi": ("2026-10", "115G"), "nopic": ("2026-10", "52G"),
                                          "mini": ("2026-10", "12G")})
        self.assertEqual(set(editions["it"]), {"maxi", "nopic"})      # "top" subsets are not whole editions

    def test_language_and_variant_without_questions(self):
        result = self.configure("--wiki-language", "en", "--wiki-variant", "nopic")
        self.assertEqual(result.returncode, 0, result.stderr)
        values = self.values()
        self.assertEqual((values["WIKI_LANGUAGE"], values["WIKI_VARIANT"]), ("en", "nopic"))
        self.assertEqual(values["MAP_COUNTRY"], "IT")                  # the country is another question
        self.assertIn("sudo hub-update.sh wiki", result.stdout)

    def test_several_editions(self):
        result = self.configure("--wiki-language", "it:maxi,en:nopic")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.values()["WIKI_LANGUAGE"], self.values()["WIKI_VARIANT"]), ("it:maxi,en:nopic", "maxi"))
        result = self.configure("--wiki-language", "it,en", "--wiki-variant", "nopic")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.values()["WIKI_LANGUAGE"], self.values()["WIKI_VARIANT"]), ("it,en", "nopic"))
        self.assertIn("it (nopic), en (nopic)", result.stdout)
        refused = self.configure("--wiki-language", "it:maxi,en:huge")
        self.assertEqual(refused.returncode, 2)

    def test_a_typo_is_caught_at_install_time(self):
        before = self.values()
        result = self.configure("--wiki-language", "itt")
        self.assertEqual(result.returncode, 2)
        self.assertIn("not in the Kiwix listing", result.stderr)
        result = self.configure("--wiki-language", "it", "--wiki-variant", "mini")
        self.assertEqual(result.returncode, 2)
        self.assertIn("Variants of 'it': maxi, nopic", result.stderr)
        self.assertEqual(self.values(), before)


@unittest.skipUnless(sys.platform.startswith("linux") and shutil.which("openssl"), "Bash and openssl")
class HomeCertificate(unittest.TestCase):
    """hub-cert: the home CA of the hub when the pi-setup package is not there."""

    def setUp(self):
        self.ca = os.path.join(tempfile.mkdtemp(), "hub-ca")
        self.addCleanup(shutil.rmtree, os.path.dirname(self.ca), True)

    def cert(self, what, ip="192.0.2.10"):
        return subprocess.run(["bash", os.path.join(PI, "hub-cert"), what], capture_output=True, text=True,
                              env={**os.environ, "HUB_CA_DIR": self.ca, "PI_IP": ip, "HUB_CERT_ANY_USER": "1"})

    def openssl(self, *args):
        return subprocess.run(["openssl", *args], capture_output=True, text=True)

    def test_a_certificate_for_the_raspberry_pi_signed_by_its_own_ca(self):
        self.assertIn("nothing to renew", self.cert("renew").stdout)      # the weekly timer never creates a CA
        self.assertFalse(os.path.exists(os.path.join(self.ca, "ca.key")))
        result = self.cert("ensure")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("home CA created", result.stdout)
        tls = os.path.join(self.ca, "tls.pem")
        self.assertEqual(os.stat(os.path.join(self.ca, "ca.key")).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(tls).st_mode & 0o077, 0)                  # the key is in it
        self.assertEqual(self.openssl("verify", "-CAfile", os.path.join(self.ca, "ca.crt"), tls).returncode, 0)
        names = self.openssl("x509", "-in", tls, "-noout", "-ext", "subjectAltName").stdout
        for name in ("DNS:raspberry", "DNS:pi.hole", "IP Address:192.0.2.10"):
            self.assertIn(name, names)
        with open(tls, encoding="utf-8") as f:
            first = f.read()
        # still valid for a year: nothing changes
        self.assertIn("valid until", self.cert("renew").stdout)
        with open(tls, encoding="utf-8") as f:
            self.assertEqual(f.read(), first)
        # the Raspberry Pi got another address: a new certificate, from the same CA
        self.assertIn("certificate issued", self.cert("renew", ip="192.0.2.20").stdout)
        names = self.openssl("x509", "-in", tls, "-noout", "-ext", "subjectAltName").stdout
        self.assertIn("IP Address:192.0.2.20", names)
        self.assertEqual(self.openssl("verify", "-CAfile", os.path.join(self.ca, "ca.crt"), tls).returncode, 0)


@unittest.skipUnless(sys.platform.startswith("linux"), "Bash scripts with GNU tools")
class WikipediaFiles(unittest.TestCase):
    """kiwix-start serves every link wikipedia_<language>.zim; hub-update.sh removes the other languages."""

    def setUp(self):
        self.hub = tempfile.mkdtemp()
        self.zim = os.path.join(self.hub, "zim")
        os.makedirs(os.path.join(self.hub, "state"))
        os.makedirs(self.zim)
        for name in ("wikipedia_it_all_maxi_2026-08.zim", "wikipedia_en_all_nopic_2026-10.zim"):
            with open(os.path.join(self.zim, name), "w", encoding="utf-8") as f:
                f.write("zim")
        os.symlink("wikipedia_it_all_maxi_2026-08.zim", os.path.join(self.zim, "wikipedia_it.zim"))
        os.symlink("wikipedia_en_all_nopic_2026-10.zim", os.path.join(self.zim, "wikipedia_en.zim"))

    def tearDown(self):
        shutil.rmtree(self.hub, ignore_errors=True)

    def test_kiwix_serves_one_book_per_language(self):
        result = subprocess.run(["bash", os.path.join(PI, "kiwix-start"), "--list"], capture_output=True, text=True,
                                env={**os.environ, "HUB_ZIM": self.zim})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(os.path.basename(p) for p in result.stdout.split()),
                         ["wikipedia_en.zim", "wikipedia_it.zim"])
        empty = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, empty, True)
        nothing = subprocess.run(["bash", os.path.join(PI, "kiwix-start"), "--list"], capture_output=True, text=True,
                                 env={**os.environ, "HUB_ZIM": empty})
        self.assertNotEqual(nothing.returncode, 0)

    def update(self, script, language):
        hub = os.path.dirname(self.zim)
        return subprocess.run(["bash", "-c", f'. "{os.path.join(PI, "hub-update.sh")}"; HUB_DIR="{hub}"; '
                               f'ZIM="{self.zim}"; WIKI_LANGUAGE="{language}"; WIKI_VARIANT=maxi; {script}'],
                              capture_output=True, text=True)

    def test_several_languages_stay_and_are_all_in_the_status(self):
        result = self.update("remove_other_languages", "it:maxi,en:nopic")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(os.listdir(self.zim)), 4)
        result = self.update("wiki_editions", "it,en:nopic")
        self.assertEqual(result.stdout.split("\n")[:2], ["it maxi", "en nopic"])
        result = self.update("write_status", "en,it")
        self.assertEqual(result.returncode, 0, result.stderr)
        with open(os.path.join(os.path.dirname(self.zim), "status.json"), encoding="utf-8") as f:
            wikipedia = json.load(f)["wikipedia"]
        self.assertEqual(wikipedia["language"], "en")
        self.assertEqual([(e["language"], e["edition"]) for e in wikipedia["editions"]],
                         [("en", "2026-10"), ("it", "2026-08")])

    def test_the_other_languages_go(self):
        script = f'. "{os.path.join(PI, "hub-update.sh")}"; ZIM="{self.zim}"; WIKI_LANGUAGE=en; remove_other_languages'
        result = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(os.listdir(self.zim)), ["wikipedia_en.zim", "wikipedia_en_all_nopic_2026-10.zim"])
        self.assertIn("removed wikipedia_it.zim", result.stdout)


@unittest.skipUnless(sys.platform.startswith("linux"), "hub-control reads /proc")
class PiholeSession(unittest.TestCase):
    """The statistics of Pi-hole: one API session, kept across errors (Pi-hole has only a few seats)."""

    def test_errors_do_not_open_new_sessions(self):
        control = load("hub_control_dns", "hub-control.py")
        stats = control.DnsStats()
        calls = []

        def call(method, path, body=None):
            calls.append((method, path))
            if path == "/auth":
                return {"session": {"sid": f"sid-{len(calls)}"}}
            if len(calls) == 6:
                raise urllib.error.HTTPError(path, 401, "Unauthorized", {}, None)   # Pi-hole restarted
            raise urllib.error.URLError("Pi-hole does not answer")

        stats._call = call
        with mock.patch.object(control, "read_text", return_value="the internal password"), \
                mock.patch.object(control.time, "sleep", side_effect=[None, None, None, None, StopIteration]):
            with self.assertRaises(StopIteration):
                stats.run()
        logins = [c for c in calls if c[1] == "/auth"]
        # five rounds that all failed: one session at the start, one more only after the 401
        self.assertEqual(len(logins), 2, calls)
        self.assertIsNotNone(stats.sid)


class Rollback(unittest.TestCase):
    """hub-rollback.py on a fake root: the version kept before an upgrade, and going back to it."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)

    def path(self, p):
        return os.path.join(self.root, p.lstrip("/"))

    def write(self, p, text):
        os.makedirs(os.path.dirname(self.path(p)), exist_ok=True)
        with open(self.path(p), "w", encoding="utf-8") as f:
            f.write(text)

    def read(self, p):
        with open(self.path(p), encoding="utf-8") as f:
            return f.read()

    def rollback(self, *args):
        result = subprocess.run([sys.executable, os.path.join(PI, "hub-rollback.py"), *args], capture_output=True,
                                text=True, stdin=subprocess.DEVNULL, env={**os.environ, "HUB_ROLLBACK_ROOT": self.root})
        return result

    def install(self, version, site, conf, extra_unit=False):
        """What hub-install.sh writes for a version (a few of its files)."""
        self.write("/usr/local/lib/raspberry-hub/VERSION", version + "\n")
        self.write("/usr/local/lib/raspberry-hub/hub-control.py", f"# {version}\n")
        self.write("/srv/hub/site/index.html", site)
        self.write("/etc/hub.conf", conf)
        self.write("/usr/local/sbin/hub-update.sh", f"# {version}\n")
        self.write("/etc/systemd/system/hub-control.service", f"# {version}\n")
        if extra_unit:
            self.write("/etc/systemd/system/hub-new.timer", "# only in the new version\n")
            self.write("/srv/hub/site/new-page/index.html", "new")
        # not the hub's: never kept, never removed
        self.write("/usr/local/sbin/pihole-backup.sh", "# pi-setup\n")
        self.write("/etc/systemd/system/unbound.service", "# system\n")

    def test_kept_before_an_upgrade_and_put_back(self):
        self.assertIn("no earlier version to keep", self.rollback("snapshot", "2.2.0").stdout)   # a new installation
        self.install("2.1.0", "old site", "WIKI_LANGUAGE=it\n")
        self.write("/var/lib/hub-control/maps.off", "")
        self.write("/srv/hub/search/addresses.db", "index of 2.1.0")
        self.write("/srv/hub/zim/wikipedia_it_all_maxi_2026-08.zim", "zim")
        if hasattr(os, "symlink") and sys.platform.startswith("linux"):
            os.symlink("wikipedia_it_all_maxi_2026-08.zim", self.path("/srv/hub/zim/wikipedia_it.zim"))
        result = self.rollback("snapshot", "2.2.0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("version 2.1.0 kept", result.stdout)
        manifest = json.loads(self.read("/var/lib/raspberry-hub/previous/manifest.json"))
        self.assertEqual((manifest["version"], manifest["replaced_by"]), ("2.1.0", "2.2.0"))
        self.assertIn("/usr/local/sbin/hub-update.sh", manifest["paths"])
        self.assertNotIn("/usr/local/sbin/pihole-backup.sh", manifest["paths"])
        self.assertNotIn("/srv/hub/search/addresses.db", manifest["paths"])       # content is not copied

        # the upgrade: new files, changed settings, a migration that rebuilt the index; then the same again
        self.install("2.2.0", "new site", "WIKI_LANGUAGE=it\nNEW_SETTING=1\n", extra_unit=True)
        os.remove(self.path("/var/lib/hub-control/maps.off"))
        self.write("/srv/hub/search/addresses.db", "index rebuilt by 2.2.0, a bit longer")
        self.assertIn("2.1.0 stays kept", self.rollback("snapshot", "2.2.0").stdout)
        self.assertEqual(json.loads(self.read("/var/lib/raspberry-hub/previous/manifest.json"))["version"], "2.1.0")
        self.assertIn("Version 2.1.0 is kept", self.rollback("status").stdout)

        result = self.rollback("restore", "--yes")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.read("/usr/local/lib/raspberry-hub/VERSION"), "2.1.0\n")
        self.assertEqual(self.read("/srv/hub/site/index.html"), "old site")
        self.assertEqual(self.read("/etc/hub.conf"), "WIKI_LANGUAGE=it\n")
        self.assertTrue(os.path.exists(self.path("/var/lib/hub-control/maps.off")))
        self.assertFalse(os.path.exists(self.path("/srv/hub/site/new-page")))
        self.assertFalse(os.path.exists(self.path("/etc/systemd/system/hub-new.timer")))
        self.assertIn("removed /etc/systemd/system/hub-new.timer", result.stdout)
        self.assertEqual(self.read("/usr/local/sbin/pihole-backup.sh"), "# pi-setup\n")
        self.assertTrue(os.path.exists(self.path("/etc/systemd/system/unbound.service")))
        # the content stays, and the rollback says what to rebuild if needed
        self.assertEqual(self.read("/srv/hub/search/addresses.db"), "index rebuilt by 2.2.0, a bit longer")
        self.assertIn("sudo hub-update.sh addresses", result.stdout)
        # used up: nothing is kept any more, and going back again says so
        self.assertFalse(os.path.exists(self.path("/var/lib/raspberry-hub/previous")))
        again = self.rollback("restore", "--yes")
        self.assertEqual(again.returncode, 1)
        self.assertIn("no previous version", again.stderr)

    def test_asks_first_at_a_terminal_only(self):
        self.install("2.1.0", "old", "A=1\n")
        self.rollback("snapshot", "2.2.0")
        self.install("2.2.0", "new", "A=2\n")
        result = self.rollback("restore")                    # no terminal and no --yes: nothing changes
        self.assertEqual(result.returncode, 1)
        self.assertIn("--yes", result.stderr)
        self.assertEqual(self.read("/etc/hub.conf"), "A=2\n")


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
                                env={**os.environ, "HUB_MIGRATE_ROOT": self.root,
                                     "HUB_PISETUP": self.path("/home/pi/pi-setup")})
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

    def test_the_icons_shipped_before_become_the_official_logos(self):
        hub_migrate = load("hub_migrate_icons", "hub-migrate.py")
        # pihole.svg as 2.2 installed it, here with Windows line endings
        old = (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Pi-hole">\n'
            '  <rect width="64" height="64" rx="14" fill="#1F4D2B"/>\n'
            '  <path d="M32 11 50 17v14c0 11-7.5 18.5-18 22-10.5-3.5-18-11-18-22V17z" fill="#123019" stroke="#D9A941" '
            'stroke-width="2.5" stroke-linejoin="round"/>\n'
            '  <circle cx="32" cy="30" r="8.5" fill="none" stroke="#F3F5F1" stroke-width="2.5"/>\n'
            '  <path d="m26 36 12-12" stroke="#F3F5F1" stroke-width="2.5" stroke-linecap="round"/>\n'
            '</svg>\n'
        )
        self.assertIn(hashlib.sha256(old.encode()).hexdigest(), hub_migrate.OLD_ICONS["pihole.svg"])
        os.makedirs(self.path("/srv/hub/icons"))
        with open(self.path("/srv/hub/icons/pihole.svg"), "wb") as f:
            f.write(old.replace("\n", "\r\n").encode())
        self.write("/srv/hub/icons/wikipedia.svg", "<svg>changed by hand</svg>")

        self.assertIn("pihole.svg: replaced with the icon of this version", self.migrate())
        with open(os.path.join(PI, "icons", "pihole.svg"), encoding="utf-8") as f:
            self.assertEqual(self.read("/srv/hub/icons/pihole.svg"), f.read())
        self.assertEqual(self.read("/srv/hub/icons/wikipedia.svg"), "<svg>changed by hand</svg>")   # the user's stays
        self.assertFalse(os.path.exists(self.path("/srv/hub/icons/maps.svg")))     # hub-install.sh copies it
        self.assertIn("nothing to migrate", self.migrate())
        # every icon of the list is shipped, and no old version is the new icon
        for name, hashes in hub_migrate.OLD_ICONS.items():
            with open(os.path.join(PI, "icons", name), "rb") as f:
                self.assertNotIn(hashlib.sha256(f.read()).hexdigest(), hashes)


    def test_the_monthly_update_leaves_pi_setup(self):
        hub_migrate = load("hub_migrate_blocks", "hub-migrate.py")
        before = "#!/bin/bash\nts() { date; }\n    apt-get -y upgrade\n"
        after = '    echo "===== $(ts) riavvio ====="\n    reboot\n'
        # the copy of the package with the block of 2.x, the installed one with the block of 1.x
        self.write("/home/pi/pi-setup/monthly-update.sh", before + hub_migrate.MONTHLY_BLOCK + after)
        self.write("/usr/local/sbin/monthly-update.sh", before + hub_migrate.MONTHLY_BLOCK_1X + after)
        os.chmod(self.path("/usr/local/sbin/monthly-update.sh"), 0o750)
        self.assertIn("hub block removed", self.migrate())
        self.assertEqual(self.read("/home/pi/pi-setup/monthly-update.sh"), before + after)
        self.assertEqual(self.read("/usr/local/sbin/monthly-update.sh"), before + after)
        if sys.platform.startswith("linux"):
            self.assertEqual(os.stat(self.path("/usr/local/sbin/monthly-update.sh")).st_mode & 0o777, 0o750)
        self.assertIn("nothing to migrate", self.migrate())
        # a call added by hand is not the hub's to remove (hub-install.sh then leaves hub-update.timer off)
        by_hand = before + "    /usr/local/sbin/hub-update.sh all\n" + after
        self.write("/usr/local/sbin/monthly-update.sh", by_hand)
        self.assertIn("nothing to migrate", self.migrate())
        self.assertEqual(self.read("/usr/local/sbin/monthly-update.sh"), by_hand)

    def test_wikipedia_waits_for_any_language(self):
        # 2.1: the built-in Wikipedia service needed the Italian edition
        self.write("/srv/hub/config/services.json", json.dumps({"services": [
            {"id": "wikipedia", "name": "Wikipedia", "url": "/wikipedia/", "type": "unit", "unit": "kiwix-hub.service",
             "requires": "/srv/hub/zim/wikipedia_it.zim"}]}))
        self.migrate()
        service = json.loads(self.read("/srv/hub/config/services.json"))["services"][0]
        self.assertEqual(service["requires"], "/srv/hub/zim/wikipedia_*.zim")
        self.assertIn("nothing to migrate", self.migrate())

    def test_the_country_of_an_older_hub_conf(self):
        with open(os.path.join(PI, "hub.conf"), encoding="utf-8") as f:
            template = f.read()
        # a 2.1 file: no MAP_COUNTRY nor ADDRESS_LANGUAGES yet
        old = re.sub(r"(?m)^(# Map and address search.*\n)(#.*\n)*MAP_COUNTRY=.*\n\n", "", template)
        old = re.sub(r"(?m)^\n(#.*\n)+ADDRESS_LANGUAGES=.*\n", "", old)
        self.assertNotIn("MAP_COUNTRY", old)
        for url, country, languages in (
                ("https://download1.graphhopper.com/public/europe/italy/photon-dump-italy-1.0-latest.jsonl.zst", "IT", "it"),
                ("https://download1.graphhopper.com/public/europe/france-monacco/photon-dump-france-monacco-1.0-latest.jsonl.zst", "FR", "fr"),
                ("https://example.org/my-own-dump.jsonl.zst", "", "")):
            self.write("/etc/hub.conf", re.sub(r"(?m)^ADDRESS_DUMP_URL=.*$", f"ADDRESS_DUMP_URL={url}", old))
            self.migrate()
            conf = self.read("/etc/hub.conf")
            self.assertEqual(re.findall(r"(?m)^MAP_COUNTRY=(.*)$", conf), [country], url)
            self.assertEqual(re.findall(r"(?m)^ADDRESS_LANGUAGES=(.*)$", conf), [languages], url)
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
        cls.previous = os.path.join(cls.folder, "previous.json")
        cls.server = start_hub_control(cls.port, cls.hub, cls.folder, credentials, HUB_VERSION_FILE=cls.version,
                                       HUB_PREVIOUS=cls.previous)

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(10)
        shutil.rmtree(cls.folder, ignore_errors=True)

    request = HubControl.request

    def test_the_restart_button(self):
        self.state("upgrade.json")
        hub = {"X-Hub": "1"}
        status, data, _ = self.request("POST", "/control/reboot", {}, hub)
        self.assertEqual((status, data["error"]), (401, "login_required"))
        status, data, _ = self.request("POST", "/control/reboot", {}, {})
        self.assertEqual((status, data["error"]), (403, "foreign_request"))     # not from the page of the hub
        _, _, cookie = self.request("POST", "/control/login", {"username": "admin", "password": "test1234"}, hub)
        logged_in = {**hub, "Cookie": cookie.split(";", 1)[0]}
        self.state("upgrade.json", {"version": "2.1.0", "step": "install"})
        status, data, _ = self.request("POST", "/control/reboot", {}, logged_in)
        self.assertEqual((status, data["error"]), (409, "upgrade_running"))     # never in the middle of an upgrade
        self.state("upgrade.json")
        # no systemd here: the unit cannot start, and the hub says so
        status, data, _ = self.request("POST", "/control/reboot", {}, logged_in)
        self.assertEqual((status, data["error"]), (502, "reboot_not_started"))

    def test_going_back_to_the_previous_version(self):
        self.state("upgrade.json")
        hub = {"X-Hub": "1"}
        _, _, cookie = self.request("POST", "/control/login", {"username": "admin", "password": "test1234"}, hub)
        logged_in = {**hub, "Cookie": cookie.split(";", 1)[0]}
        status, data, _ = self.request("GET", "/control/upgrade")
        self.assertIsNone(data["previous"])
        status, data, _ = self.request("POST", "/control/rollback", {"version": "2.0.0"}, logged_in)
        self.assertEqual((status, data["error"]), (409, "no_previous"))
        with open(self.previous, "w", encoding="utf-8") as f:
            json.dump({"version": "2.0.0", "replaced_by": "2.0.1", "time": "2026-11-20T15:00:00+0100"}, f)
        status, data, _ = self.request("GET", "/control/upgrade")
        self.assertEqual(data["previous"], {"version": "2.0.0", "time": "2026-11-20T15:00:00+0100"})
        status, data, _ = self.request("POST", "/control/rollback", {"version": "2.0.0"}, hub)
        self.assertEqual((status, data["error"]), (401, "login_required"))
        for wanted in ("1.9.9", "2.0.0; reboot", None):
            status, data, _ = self.request("POST", "/control/rollback", {"version": wanted}, logged_in)
            self.assertEqual((status, data["error"]), (409, "no_previous"), wanted)
        self.state("upgrade.json", {"version": "2.1.0", "step": "install"})
        status, data, _ = self.request("POST", "/control/rollback", {"version": "2.0.0"}, logged_in)
        self.assertEqual((status, data["error"]), (409, "upgrade_running"))
        self.state("upgrade.json")
        # no systemd here: the service cannot start, and says so
        status, data, _ = self.request("POST", "/control/rollback", {"version": "2.0.0"}, logged_in)
        self.assertEqual((status, data["error"]), (502, "rollback_not_started"))
        os.remove(self.previous)

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


@unittest.skipUnless(sys.platform.startswith("linux"), "hub-control reads /proc")
class Upstream(unittest.TestCase):
    """The resolver shown under DNS at home comes from Unbound's forward file: the first forward-addr wins."""

    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.mkdtemp()
        with mock.patch.dict(os.environ, {"HUB_DIR": cls.folder, "HUB_CONTROL_STATE": cls.folder}):
            cls.control = load("hub_control_upstream", "hub-control.py")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.folder, ignore_errors=True)

    def upstream(self, text):
        path = os.path.join(self.folder, "forward-dot.conf")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        with mock.patch.object(self.control, "UNBOUND_FILE", path):
            return self.control.upstream()

    def test_the_first_resolver_is_named(self):
        text = ('forward-zone:\n    name: "."\n    forward-tls-upstream: yes\n'
                "    forward-addr: 192.0.2.1@853#dns.adguard-dns.com\n"
                "    forward-addr: 2001:db8::1@853#dns.adguard-dns.com\n"
                "    forward-addr: 192.0.2.2@853#cloudflare-dns.com\n")
        self.assertEqual(self.upstream(text), {"name": "AdGuard", "encrypted": True})
        self.assertEqual(self.upstream(text.replace("dns.adguard-dns.com", "dns11.quad9.net")),
                         {"name": "Quad9", "encrypted": True})

    def test_an_unknown_resolver_keeps_its_name(self):
        self.assertEqual(self.upstream("forward-zone:\n    forward-addr: 192.0.2.1@853#dns.example.net\n"),
                         {"name": "dns.example.net", "encrypted": False})

    def test_no_forward_file_means_the_root_servers(self):
        self.assertEqual(self.upstream(""), {"name": "root_servers", "encrypted": False})


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
