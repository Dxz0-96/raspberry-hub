#!/usr/bin/env python3
"""Upgrades a Raspberry Pi set up by raspberry-hub 1.x to the current layout.

    sudo python3 hub-migrate.py

Version 1.x used Italian names for files, folders, settings and JSON fields. This moves and converts
them in place, keeping everything the hub has collected: services added from the hub and their icons,
the switch states, the password, the downloaded content and the address index (converted, not rebuilt).
hub-install.sh runs it before installing the new scripts; running it again does nothing.

Logged-in devices have to log in once more: the session cookie moved to the new /control path.

Later versions add what they need here too, always idempotent: for example the settings a new version brings
are added to /etc/hub.conf with their default, without touching the values already set.

HUB_MIGRATE_ROOT=/some/folder runs it on a copy of the file system instead of / (used by the tests).
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("HUB_MIGRATE_ROOT", "/")


def P(path):
    """An absolute path of the Raspberry Pi, inside ROOT."""
    return os.path.join(ROOT, path.lstrip("/"))


HUB_DIR = P("/srv/hub")
changes = 0


def log(message):
    global changes
    changes += 1
    print(f"   {message}", flush=True)


def move(old, new):
    """Renames old to new. If both are folders, moves the content that new does not have yet."""
    if not os.path.lexists(old):
        return
    if not os.path.lexists(new):
        os.rename(old, new)
        log(f"{old} -> {new}")
        return
    if os.path.isdir(old) and os.path.isdir(new):
        for name in os.listdir(old):
            if not os.path.lexists(os.path.join(new, name)):
                os.rename(os.path.join(old, name), os.path.join(new, name))
        shutil.rmtree(old, ignore_errors=True)
        log(f"{old} merged into {new}")
    else:
        if os.path.isdir(old) and not os.path.islink(old):
            shutil.rmtree(old, ignore_errors=True)
        else:
            os.remove(old)
        log(f"{old} removed ({new} already exists)")


def remove(path):
    if not os.path.lexists(path):
        return
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    else:
        os.remove(path)
    log(f"{path} removed")


def rewrite_json(path, convert):
    """Converts a JSON file in place, keeping owner and permissions."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return
    new = convert(data)
    if new == data:
        return
    with open(path, "r+", encoding="utf-8") as f:
        f.seek(0)
        json.dump(new, f, ensure_ascii=False, indent=2 if isinstance(new, dict) and "services" in new else None)
        f.write("\n")
        f.truncate()
    log(f"{path} converted")


# --------------------------------------------------------------------------- icons
# The icons of the services shipped with a new install, as earlier versions installed them in /srv/hub/icons
# (sha256 of the file with LF line endings). hub-install.sh never overwrites an icon that is there, so these are
# replaced here with the ones of this version: the official logos, and a new icon for the network monitor. An
# icon that is not one of these (changed by hand) stays.
OLD_ICONS = {
    "pihole.svg": {"6f664647081ff6173cfc9ba5a747a6f2ea7d3f3189ed383460bae2809acf70bd"},
    "wikipedia.svg": {"9fe0c4c201074dc195b51db9419a274646ace357b403c797e0986f61ad8103c0"},
    "maps.svg": {"575ec7e00fdb295084269ff269d969f14872bbe298cd39f2f4041c4ff0bd5807",
                 "09692351fa0d1ce061ae042f615e425f99dcd07f4a34cfc42ba582a2a8dc63a8"},    # mappe.svg of 1.x
    "netmon.svg": {"06206c4ff809be79b48b29334dbaec6c0d3513da604d65654d74837272a4ce30",
                   "d2cabc2d02b02cfaae867013d549875a86c4adbdfd86a774888b0d39b778dda7"},   # 1.x, in Italian
}


def refresh_shipped_icons():
    for name, old in OLD_ICONS.items():
        path = os.path.join(HUB_DIR, "icons", name)
        try:
            with open(path, "rb") as f:
                current = f.read()
            with open(os.path.join(HERE, "icons", name), "rb") as f:
                new = f.read()
        except OSError:
            continue
        if hashlib.sha256(current.replace(b"\r\n", b"\n")).hexdigest() not in old:
            continue
        with open(path, "r+b") as f:      # in place: owner and mode stay
            f.write(new)
            f.truncate()
        log(f"{path}: replaced with the icon of this version")


# --------------------------------------------------------------------------- services.json
SERVICE_KEYS = {"nome": "name", "descrizione": "description", "icona": "icon", "tipo": "type", "unita": "unit",
                "richiede": "requires", "facoltativa": "optional", "verifica": "check", "aggiunto": "added"}


def convert_path(value):
    value = re.sub(r"^/icone/", "/icons/", str(value))
    value = value.replace("/icons/mappe.svg", "/icons/maps.svg")
    value = value.replace("/srv/hub/maps/italia.pmtiles", "/srv/hub/maps/basemap.pmtiles")
    return "/maps/" if value == "/mappe/" else value


def convert_services(data):
    try:
        with open(os.path.join(HERE, "services.json"), encoding="utf-8") as f:
            built_in = {s["id"]: s for s in json.load(f)["services"]}
    except (OSError, ValueError, KeyError):
        built_in = {}
    services = []
    for old in data.get("servizi", data.get("services", [])):
        if not isinstance(old, dict):
            continue
        ident = "maps" if old.get("id") == "mappe" else old.get("id")
        if ident in built_in:
            services.append(built_in[ident])
            continue
        service = {}
        for key, value in old.items():
            if key == "senza_unita":
                continue
            key = SERVICE_KEYS.get(key, key)
            if key == "type" and value == "unita":
                value = "unit"
            if key in ("url", "icon", "requires"):
                value = convert_path(value)
            service[key] = value
        services.append(service)
    return {"services": services}


# --------------------------------------------------------------------------- hub.conf
CONF_KEYS = {"WIKI_LINGUA": "WIKI_LANGUAGE", "WIKI_VARIANTE": "WIKI_VARIANT", "MAPPE_BBOX": "MAP_BBOX",
             "MAPPE_MAXZOOM": "MAP_MAXZOOM", "DUMP_INDIRIZZI": "ADDRESS_DUMP_URL", "GIORNI_MINIMI": "MIN_AGE_DAYS"}


def migrate_conf(path=None):
    """Rewrites /etc/hub.conf from the new template, keeping the values set in the old one."""
    path = path or P("/etc/hub.conf")
    try:
        old = open(path, encoding="utf-8").read()
        template = open(os.path.join(HERE, "hub.conf"), encoding="utf-8").read()
    except OSError:
        return
    if not any(re.search(rf"^{key}=", old, re.M) for key in CONF_KEYS):
        return
    values = {}
    for key, value in re.findall(r"^([A-Z_]+)=(.*)$", old, re.M):
        values[CONF_KEYS.get(key, key)] = value
    new = re.sub(r"^([A-Z_]+)=(.*)$", lambda m: f"{m.group(1)}={values.get(m.group(1), m.group(2))}", template,
                 flags=re.M)
    shutil.copy2(path, path + ".1x")
    with open(path, "w", encoding="utf-8") as f:
        f.write(new)
    log(f"{path} rewritten with the new setting names (old file kept as {path}.1x)")


def map_country(values):
    """MAP_COUNTRY and ADDRESS_LANGUAGES for a hub.conf older than them (2.2): the country whose address dump the
    file already downloads (Italy, unless it was changed by hand). A dump that is in no country of countries.json
    stays a choice of its own: MAP_COUNTRY empty."""
    try:
        with open(os.path.join(HERE, "countries.json"), encoding="utf-8") as f:
            countries = json.load(f)["countries"]
    except (OSError, ValueError, KeyError):
        return {}
    url = values.get("ADDRESS_DUMP_URL", "")
    for country in countries:
        folder = "/" + country["addresses"].rsplit("/", 1)[0] + "/"
        if url.endswith("/" + country["addresses"]) or folder in url:
            return {"MAP_COUNTRY": country["code"], "ADDRESS_LANGUAGES": country["address_languages"]}
    return {"MAP_COUNTRY": "", "ADDRESS_LANGUAGES": ""}


def add_new_conf_keys(path=None):
    """Adds to /etc/hub.conf the settings of the template it does not have yet (a newer version brought them),
    each with its comment, at the end. The values already there are never touched. Most new settings get the
    default of the template; MAP_COUNTRY and ADDRESS_LANGUAGES follow what the file already downloads."""
    path = path or P("/etc/hub.conf")
    try:
        old = open(path, encoding="utf-8").read()
        template = open(os.path.join(HERE, "hub.conf"), encoding="utf-8").read()
    except OSError:
        return
    values = dict(re.findall(r"^([A-Z_]+)=(.*)$", old, re.M))
    have = set(values)
    inferred = map_country(values) if "MAP_COUNTRY" not in have else {}
    blocks, comment = [], []
    for line in template.splitlines():
        key = re.match(r"^([A-Z_]+)=", line)
        if line.startswith("#"):
            comment.append(line)
            continue
        if key and key.group(1) not in have:
            if key.group(1) in inferred:
                line = f"{key.group(1)}={inferred[key.group(1)]}"
            blocks.append("\n".join([*comment, line]))
        comment = []
    if not blocks:
        return
    with open(path, "a", encoding="utf-8") as f:
        f.write(("" if old.endswith("\n") else "\n") + "\n" + "\n\n".join(blocks) + "\n")
    added = ", ".join(re.match(r"^([A-Z_]+)=", b.splitlines()[-1]).group(1) for b in blocks)
    log(f"{path}: new settings added with their default: {added}")


# --------------------------------------------------------------------------- content updates
def migrate_update_state():
    state = os.path.join(HUB_DIR, "state")
    move(os.path.join(HUB_DIR, "stato"), state)
    if not os.path.isdir(state):
        return
    for old, new in (("wiki", "wiki"), ("mappe", "maps"), ("indirizzi", "addresses")):
        result = os.path.join(state, f"{old}.esito")
        if os.path.exists(result):
            text = open(result, encoding="utf-8").read().strip()
            with open(os.path.join(state, f"{new}.result"), "w", encoding="utf-8") as f:
                f.write(re.sub(r"^errore\b", "error", text) + "\n")
            os.remove(result)
            log(f"{result} -> {new}.result")
        remove(os.path.join(state, f"{old}.in-corso"))


def migrate_address_index():
    search = os.path.join(HUB_DIR, "search")
    move(os.path.join(search, "indirizzi.db"), os.path.join(search, "addresses.db"))
    move(os.path.join(search, "indirizzi.data"), os.path.join(search, "addresses.date"))
    move(os.path.join(search, "indirizzi.md5"), os.path.join(search, "addresses.md5"))
    for leftover in ("indirizzi.db.nuovo", "indirizzi.db.nuovo-journal", "indirizzi.data.nuovo"):
        remove(os.path.join(search, leftover))
    db = os.path.join(search, "addresses.db")
    if os.path.exists(db):
        builder = os.path.join(HERE, "build-search-index.py")
        result = subprocess.run([sys.executable, builder, "--migrate", db], capture_output=True, text=True)
        output = (result.stdout + result.stderr).strip()
        if "already up to date" not in output:
            for line in output.splitlines():
                log(line.strip())
        if result.returncode != 0:
            log("the address index could not be converted: rebuild it with sudo hub-update.sh addresses")


def migrate_drop_ins():
    """Translates the comment in the systemd drop-ins written by hub-service for switchable services."""
    root = P("/etc/systemd/system")
    for entry in os.listdir(root) if os.path.isdir(root) else []:
        path = os.path.join(root, entry, "hub-control.conf")
        if entry.endswith(".d") and os.path.isfile(path):
            text = open(path, encoding="utf-8").read()
            if text.startswith("# Spento dall'hub"):
                with open(path, "w", encoding="utf-8") as f:
                    f.write("# Turned off from the hub: stays off after a reboot too.\n" + text.split("\n", 1)[1])
                log(f"{path} comment translated")


# --------------------------------------------------------------------------- pi-setup's monthly update
# Up to 2.2 the content update of the hub was a block written into monthly-update.sh of the pi-setup package,
# right before its reboot, found by the text of that script. hub-update.timer does it now: the block of the hub
# (as 2.x and 1.x wrote it) comes out of both copies, the one of the package and the installed one. A call to
# hub-update.sh added by hand stays, and hub-install.sh then leaves the timer off, so nothing runs twice.
MONTHLY_BLOCK = '''    # raspberry-hub content: offline Wikipedia, maps and address index (see hub-update.sh).
    # An error here does not stop the reboot: it is logged and reported.
    if [ -x /usr/local/sbin/hub-update.sh ]; then
      echo "===== $(ts) updating the hub content (Wikipedia, maps, addresses) ====="
      if timeout 6h /usr/local/sbin/hub-update.sh all; then
        echo "===== $(ts) hub content updated ====="
      else
        echo "===== $(ts) WARNING: the hub content update failed or is incomplete ====="
        [ -x /usr/local/bin/netmon ] && /usr/local/bin/netmon notify "⚠️ Hub: updating Wikipedia, maps or addresses failed: see /var/log/monthly-update.log" >/dev/null 2>&1
      fi
    fi

'''
MONTHLY_BLOCK_1X = '''    # Contenuti dell'hub: Wikipedia offline, mappe e indice degli indirizzi (vedi hub-update.sh).
    # Un errore qui non blocca il riavvio: viene registrato e segnalato.
    if [ -x /usr/local/sbin/hub-update.sh ]; then
      echo "===== $(ts) aggiorno i contenuti dell'hub (Wikipedia, mappe, indirizzi) ====="
      if timeout 6h /usr/local/sbin/hub-update.sh tutto; then
        echo "===== $(ts) contenuti dell'hub aggiornati ====="
      else
        echo "===== $(ts) ATTENZIONE: aggiornamento dei contenuti dell'hub non riuscito o incompleto ====="
        [ -x /usr/local/bin/netmon ] && /usr/local/bin/netmon notify "⚠️ Hub: aggiornamento di Wikipedia, mappe o indirizzi non riuscito: vedi /var/log/monthly-update.log" >/dev/null 2>&1
      fi
    fi

'''
MONTHLY_BLOCKS = [MONTHLY_BLOCK, MONTHLY_BLOCK_1X]


def remove_monthly_hook():
    places = [P("/usr/local/sbin/monthly-update.sh")]
    if os.environ.get("HUB_PISETUP"):
        places.append(os.path.join(os.environ["HUB_PISETUP"], "monthly-update.sh"))
    for path in places:
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        new = text
        for block in MONTHLY_BLOCKS:
            new = new.replace(block, "")
        if new != text:
            with open(path, "r+", encoding="utf-8", newline="\n") as f:      # in place: owner and mode stay
                f.write(new)
                f.truncate()
            log(f"{path}: hub block removed (hub-update.timer updates the content now)")


def main():
    if ROOT == "/" and os.geteuid() != 0:
        print("Run it with sudo.", file=sys.stderr)
        return 1

    # files the hub serves and edits
    move(os.path.join(HUB_DIR, "icone"), os.path.join(HUB_DIR, "icons"))
    move(os.path.join(HUB_DIR, "icons", "mappe.svg"), os.path.join(HUB_DIR, "icons", "maps.svg"))
    refresh_shipped_icons()
    services = os.path.join(HUB_DIR, "config", "services.json")
    move(os.path.join(HUB_DIR, "config", "servizi.json"), services)
    if os.path.exists(services):
        rewrite_json(services, convert_services)

    # downloaded content
    maps = os.path.join(HUB_DIR, "maps")
    move(os.path.join(maps, "italia.pmtiles"), os.path.join(maps, "basemap.pmtiles"))
    move(os.path.join(maps, "italia.build"), os.path.join(maps, "basemap.build"))
    remove(os.path.join(maps, "italia.pmtiles.nuovo"))
    migrate_update_state()
    migrate_address_index()

    # login, switches and settings
    credentials = P("/etc/hub-control/credentials.json")
    move(P("/etc/hub-control/credenziali.json"), credentials)
    rewrite_json(credentials, lambda c: {("username" if k == "utente" else k): v for k, v in c.items()})
    move(P("/etc/hub-control/unita-consentite"), P("/etc/hub-control/allowed-units"))
    move(P("/etc/hub-control/pihole-porta-originale"), P("/etc/hub-control/pihole-original-port"))
    remove(P("/var/lib/hub-control/sessioni.json"))
    move(P("/var/lib/hub-control/.stato-iniziale"), P("/var/lib/hub-control/.initial-state"))
    move(P("/var/lib/hub-control/mappe.off"), P("/var/lib/hub-control/maps.off"))
    migrate_conf()
    add_new_conf_keys()
    migrate_drop_ins()

    # Caddy and installed commands
    move(P("/etc/caddy/servizi"), P("/etc/caddy/services"))
    remove(P("/etc/caddy/services/000-vuoto.caddy"))
    move(P("/etc/caddy/pubblico"), P("/etc/caddy/public"))
    move(P("/etc/caddy/Caddyfile.originale"), P("/etc/caddy/Caddyfile.orig"))
    remove(P("/usr/local/sbin/hub-servizio"))
    remove(P("/usr/local/sbin/hub-verifica.sh"))
    remove_monthly_hook()

    if changes == 0:
        print("   nothing to migrate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
