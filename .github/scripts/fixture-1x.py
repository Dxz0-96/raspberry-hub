#!/usr/bin/env python3
"""Writes the files of a raspberry-hub 1.x installation (Italian names, address index schema 2) on this system,
so that .github/workflows/install.yml can check the upgrade with the real hub-install.sh. Run as root in the
test container only: it writes to /etc, /srv and /var/lib.

    python3 .github/scripts/fixture-1x.py

The same layout as the UpgradeFrom1x test in pi/tests/test_pi.py, whose helpers build the index.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "pi", "tests"))
import test_pi  # noqa: E402  (helpers only: building and downgrading the address index)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


write("/srv/hub/config/servizi.json", json.dumps({"servizi": [
    {"id": "pihole", "nome": "Pi-hole", "descrizione": "Blocco", "url": "/admin/", "icona": "/icone/pihole.svg",
     "tipo": "pihole"},
    {"id": "mappe", "nome": "Mappe", "url": "/mappe/", "icona": "/icone/mappe.svg", "tipo": "unita",
     "unita": "hub-search.service", "richiede": "/srv/hub/maps/italia.pmtiles", "facoltativa": True,
     "senza_unita": "Ricerca degli indirizzi non attiva"},
    {"id": "u-1a2b3c4d", "nome": "NAS", "descrizione": "Foto", "url": "http://192.0.2.20/",
     "icona": "/icone/0123456789abcdef.png", "tipo": "link", "aggiunto": True},
]}))
write("/srv/hub/icone/0123456789abcdef.png", "png")
write("/srv/hub/icone/mappe.svg", "<svg/>")
write("/srv/hub/stato/mappe.esito", "errore: download interrotto\n")
write("/etc/hub-control/credenziali.json", json.dumps({"utente": "admin", "salt": "s", "hash": "h"}))
write("/etc/hub-control/unita-consentite", "kiwix-hub.service\nhub-search.service\n")
write("/var/lib/hub-control/mappe.off", "")
write("/var/lib/hub-control/.stato-iniziale", "")
write("/etc/hub.conf", "# raspberry-hub 1.x\nWIKI_LINGUA=it\nWIKI_VARIANTE=nopic\nMAPPE_MAXZOOM=14\nHUB_DIR=/srv/hub\n")
write("/usr/local/sbin/hub-servizio", "#!/bin/sh\n")
os.makedirs("/srv/hub/search", exist_ok=True)
test_pi.build_index("/srv/hub/search/indirizzi.db")
test_pi.downgrade_to_1x("/srv/hub/search/indirizzi.db")
print("raspberry-hub 1.x files written")
