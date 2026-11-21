#!/usr/bin/env python3
"""Chooses what the Raspberry Pi downloads: the country of the offline map and of the address search.

    sudo hub-install.sh configure                  asks, shows how much space it takes, writes /etc/hub.conf
    sudo hub-install.sh configure --country FR     the same without questions
    hub-configure.py --list                        the countries it knows (countries.json, next to it)

hub-install.sh runs it on the first installation, before anything is downloaded. With nobody at a terminal to
answer (an installation started by a script, the update button of the hub) and no --country, nothing changes;
re-runs for upgrades never ask.

The country is a place, not a language: it changes neither the language of the hub nor the Wikipedia edition,
and nothing here guesses one from the other. Countries are named by their ISO 3166 code (IT, FR, CH).

It writes four settings of /etc/hub.conf: MAP_COUNTRY, and from countries.json MAP_BBOX, ADDRESS_DUMP_URL and
ADDRESS_LANGUAGES. A box of your own still works: edit MAP_BBOX by hand. The maps and the address index already
downloaded stay until the new ones are ready (sudo hub-update.sh maps addresses).

Standard library only. HUB_CONF=/some/file works on another file instead of /etc/hub.conf (used by the tests).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CONF = os.environ.get("HUB_CONF", "/etc/hub.conf")
COUNTRIES = os.environ.get("HUB_COUNTRIES", os.path.join(HERE, "countries.json"))
DUMPS = "https://download1.graphhopper.com/public/"
UPDATE = os.environ.get("HUB_UPDATE", "/usr/local/sbin/hub-update.sh")
DEFAULT_COUNTRY = "IT"
# Measured on the Italian dump: the index takes about twice the compressed dump, and building it about ten times
# the dump in free space (6 GB at least, as hub-update.sh asks).
INDEX_RATIO = 2
BUILD_RATIO = 10


def load_countries():
    with open(COUNTRIES, encoding="utf-8") as f:
        return {c["code"]: c for c in json.load(f)["countries"]}


def dump_url(country):
    return DUMPS + country["addresses"]


def read_conf(path=None):
    """The KEY=value settings of /etc/hub.conf (the last one wins, as when the shell reads it)."""
    try:
        with open(path or CONF, encoding="utf-8") as f:
            return dict(re.findall(r"^([A-Z_]+)=(.*)$", f.read(), re.M))
    except OSError:
        return {}


def write_conf(values, path=None):
    """Sets the given settings in /etc/hub.conf, in place: comments, order and the other settings stay. A setting
    the file does not have yet goes at the end."""
    path = path or CONF
    with open(path, encoding="utf-8") as f:
        text = f.read()
    for key, value in values.items():
        line = f"{key}={value}"
        text, found = re.subn(rf"^{key}=.*$", lambda _: line, text, flags=re.M)
        if not found:
            text += ("" if text.endswith("\n") else "\n") + line + "\n"
    temporary = path + ".new"
    with open(temporary, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    try:
        os.chmod(temporary, os.stat(path).st_mode & 0o777)
    except OSError:
        pass
    os.replace(temporary, path)


def settings_for(country):
    return {"MAP_COUNTRY": country["code"], "MAP_BBOX": country["bbox"], "ADDRESS_DUMP_URL": dump_url(country),
            "ADDRESS_LANGUAGES": country["address_languages"]}


def size_text(count):
    if count >= 1024 ** 3:
        return f"{count / 1024 ** 3:.1f} GB"
    return f"{max(1, round(count / 1024 ** 2))} MB"


def download_size(url):
    """The size of a file to download, from its Content-Length; None if the server does not say."""
    try:
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "raspberry-hub-configure"})
        with urllib.request.urlopen(request, timeout=30) as response:
            return int(response.headers.get("Content-Length") or 0) or None
    except (OSError, ValueError):
        return None


def maps_estimate(country):
    """How big the maps of that box would be, from 'hub-update.sh estimate-maps BOX' (pmtiles extract --dry-run:
    it reads the index of the planet build, not the tiles). None when it cannot tell (offline, no pmtiles)."""
    try:
        result = subprocess.run([UPDATE, "estimate-maps", country["bbox"]], capture_output=True, text=True,
                                timeout=300)
    except (OSError, subprocess.SubprocessError):
        return None
    sizes = re.findall(r"archive size of ([\d.,]+ ?[kKMGT]i?B)", result.stdout + result.stderr)
    return sizes[-1] if result.returncode == 0 and sizes else None


def describe(country, maxzoom):
    """One line about what the country takes on the disk, with the estimates when they can be had."""
    print(f"  {country['name']}: estimating the space it takes (it asks the download servers)...", flush=True)
    maps = maps_estimate(country)
    dump = download_size(dump_url(country))
    parts = [f"maps about {maps} at zoom {maxzoom}" if maps else f"maps at zoom {maxzoom} (size unknown now)"]
    if dump:
        parts.append(f"address index about {size_text(dump * INDEX_RATIO)}"
                     f" (download {size_text(dump)}, {size_text(max(6 * 1024 ** 3, dump * BUILD_RATIO))} free while"
                     " it is built)")
    else:
        parts.append("address index (size unknown now)")
    print(f"  {country['name']}: {', '.join(parts)}.")


def ask(question, default=""):
    try:
        answer = input(question).strip()
    except EOFError:
        return default
    return answer or default


def list_countries(countries):
    for code in sorted(countries):
        print(f"  {code}  {countries[code]['name']}")


def choose_country(countries, current, estimate, maxzoom):
    """Asks until the answer is a known country and it is confirmed; None if the person gives up."""
    while True:
        answer = ask(f"Map and address search: which country? ({', '.join(sorted(countries))}) [{current}] ",
                     current).upper()
        if answer not in countries:
            print(f"  {answer!r} is not in the list. The codes are ISO 3166 ones, for example IT, FR, CH:")
            list_countries(countries)
            continue
        country = countries[answer]
        if estimate:
            describe(country, maxzoom)
        reply = ask("  Continue? [Y/n] ", "y").lower()
        if reply in ("y", "yes"):
            return country
        if ask("  Choose another country? [Y/n] ", "y").lower() not in ("y", "yes"):
            return None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--country", help="ISO 3166 code of the country (no question)")
    parser.add_argument("--list", action="store_true", help="list the countries and stop")
    parser.add_argument("--first-install", action="store_true", help="run by hub-install.sh on a new installation")
    parser.add_argument("--no-estimate", action="store_true", help="do not ask the servers how big the content is")
    args = parser.parse_args()
    countries = load_countries()
    if args.list:
        list_countries(countries)
        return 0
    conf = read_conf()
    if not conf and not os.path.exists(CONF):
        print(f"{CONF} does not exist: install the hub first (sudo bash hub-install.sh).", file=sys.stderr)
        return 1
    current = (conf.get("MAP_COUNTRY") or DEFAULT_COUNTRY).upper()
    interactive = sys.stdin.isatty() and sys.stdout.isatty()

    if args.country:
        country = countries.get(args.country.strip().upper())
        if not country:
            print(f"Unknown country {args.country!r}. The countries are:", file=sys.stderr)
            list_countries(countries)
            return 2
    elif interactive:
        country = choose_country(countries, current if current in countries else DEFAULT_COUNTRY,
                                 not args.no_estimate, conf.get("MAP_MAXZOOM", "15"))
        if country is None:
            print("   nothing changed")
            return 0
    else:
        name = countries[current]["name"] if current in countries else f"a box of your own ({conf.get('MAP_BBOX')})"
        print(f"   map and address search: {name} (sudo hub-install.sh configure changes it)")
        return 0

    wanted = settings_for(country)
    if all(conf.get(k) == v for k, v in wanted.items()):
        print(f"   map and address search: {country['name']}, as before")
        return 0
    write_conf(wanted)
    print(f"   map and address search: {country['name']} (written to {CONF})")
    if not args.first_install and conf.get("MAP_COUNTRY", DEFAULT_COUNTRY) != country["code"]:
        print("   The maps and the address index downloaded so far stay until the new ones are ready.")
        if interactive and ask("   Download the new ones now, in the background? [Y/n] ", "y").lower() in ("y", "yes"):
            start_download()
        else:
            print("   To download them: sudo hub-update.sh maps addresses")
    return 0


def start_download():
    """hub-update.sh maps addresses as a transient systemd unit: it goes on if the SSH session closes."""
    try:
        subprocess.run(["systemd-run", "--unit=hub-content-update", "--collect", "--quiet", UPDATE, "maps", "addresses"],
                       check=True, timeout=30)
        print("   Started: the hub shows the progress; journalctl -u hub-content-update -f follows it here.")
    except (OSError, subprocess.SubprocessError):
        print("   Could not start it: run sudo hub-update.sh maps addresses")


if __name__ == "__main__":
    sys.exit(main())
