# Upgrading

How to upgrade an existing installation, and what changes between major versions. The full list of
changes of every release is in [CHANGELOG.md](../CHANGELOG.md).

## Any version

On the PC, after pulling the new version:

```powershell
.\deploy.ps1 -Update
```

It builds the website, copies the `pi/` folder to `~/pi-setup/hub` on the Raspberry Pi and runs
`sudo bash hub-install.sh` there. The installer is safe to run again: it keeps your settings, added services,
switch states and downloaded content, and `pi/hub-migrate.py` converts anything whose name or format changed.

The footer of the hub warns when the website and the Raspberry Pi scripts come from different releases (for
example after a plain `.\deploy.ps1`, which copies only the website): run `.\deploy.ps1 -Update` to bring
them in step. `sudo hub-check.sh` on the Pi prints the installed version.

## From 1.x to 2.0

Version 2.0 is the same hub, now entirely in English, with an English and Italian interface. Everything is
converted automatically by the upgrade above:

- files, folders, settings and JSON fields are renamed, and the address index is converted in a few minutes
  (no need to rebuild it from the dump);
- `/etc/hub.conf` is rewritten with the new setting names and your values (the old file is kept as
  `/etc/hub.conf.1x`);
- bookmarks to `/mappe/` keep working, and so do map and Wikipedia links with the old `#posizione=`,
  `#voce=` and `#cerca=` addresses;
- the theme chosen on each device is kept.

Devices that were logged in have to **log in once more**: the session cookie moved to the new `/control` path.

What was renamed, if you use the commands or files directly:

| 1.x | 2.0 |
|---|---|
| `/mappe/`, `/cerca`, `/controllo/`, `/icone/`, `/servizi.json`, `/spento/` | `/maps/`, `/search`, `/control/`, `/icons/`, `/services.json`, `/unavailable/` |
| `hub-servizio aggiungi` / `elenco` / `rimuovi` | `hub-service add` / `list` / `remove` |
| `hub-verifica.sh [--attendi]` | `hub-check.sh [--wait]` |
| `hub-update.sh tutto` / `mappe` / `indirizzi` / `stato` / `stima-mappe` | `hub-update.sh all` / `maps` / `addresses` / `status` / `estimate-maps` (old names still accepted) |
| `hub-install.sh prepara` / `sito` / `attiva` / `mensile` / `disattiva` | `hub-install.sh prepare` / `site` / `enable` / `monthly` / `disable` |
| `/etc/hub.conf`: `WIKI_LINGUA`, `WIKI_VARIANTE`, `MAPPE_BBOX`, `MAPPE_MAXZOOM`, `DUMP_INDIRIZZI`, `GIORNI_MINIMI` | `WIKI_LANGUAGE`, `WIKI_VARIANT`, `MAP_BBOX`, `MAP_MAXZOOM`, `ADDRESS_DUMP_URL`, `MIN_AGE_DAYS` |
| `/srv/hub/maps/italia.pmtiles`, `/srv/hub/search/indirizzi.db`, `/srv/hub/stato`, `/srv/hub/icone` | `/srv/hub/maps/basemap.pmtiles`, `/srv/hub/search/addresses.db`, `/srv/hub/state`, `/srv/hub/icons` |
| `/etc/hub-control/credenziali.json`, `unita-consentite` | `/etc/hub-control/credentials.json`, `allowed-units` |
| `deploy.ps1 -Chiave`, `$PiPredefinito`, `$ChiavePredefinita` | `deploy.ps1 -Key`, `$DefaultPi`, `$DefaultKey` (old names in `deploy.local.ps1` are still read) |
| `ca-di-casa.crt` | `home-ca.crt` |

For developers: `hub-control.py` now answers with machine-readable error and status codes, which the hub
translates; the HTTP API paths and JSON fields are in English (see the top of `pi/hub-control.py`).
