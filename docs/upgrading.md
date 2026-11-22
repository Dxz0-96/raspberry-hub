# Upgrading

How to upgrade an existing installation, and what changes between major versions. The notes of every release
are on the [releases page](https://github.com/Dxz0-96/raspberry-hub/releases) and in
[CHANGELOG.md](../CHANGELOG.md).

## Any version

The short version is in the README, [Updating](../README.md#updating). In detail:

### 1. Back up (before a major version)

On the Raspberry Pi. It saves the settings of the hub, the password, the added services and their icons, the
switch states and the Caddy configuration; a few MB. The downloaded Wikipedia, maps and address index are not
included: an update does not replace them, and they can always be downloaded again.

```bash
sudo hub-install.sh backup
```

It writes `~/hub-backup-YYYY-MM-DD.tar.gz`, readable only by you: it holds the password hash and the key of the
home CA of the hub. Installed versions before 2.2 do not have the command yet; this does the same:

```bash
sudo tar --ignore-failed-read -czf ~/hub-backup.tar.gz /etc/hub.conf /etc/hub-control /etc/caddy /srv/hub/config /srv/hub/icons /srv/hub/icone /var/lib/hub-control
```

(`/srv/hub/icone` is where 1.x kept the icons; `--ignore-failed-read` skips whichever of the two is missing.)
Copy the archive to the PC if you want it off the SD card.

### 2. Get the new version and update

**On the Raspberry Pi**, once the installed version has the command (versions after 2.0.1):

```bash
sudo hub-install.sh upgrade          # the latest release
sudo hub-install.sh upgrade 2.1.0    # a given version
```

`hub-install.sh upgrade` (the work is done by `hub-upgrade.py`):

1. Asks GitHub for the release: the latest one, or the version given. Pre-releases and versions older than
   the installed one are refused.
2. Downloads `raspberry-hub-X.Y.Z.tar.gz` and `SHA256SUMS` from the release and checks the checksum. The
   package is the `pi/` folder with the website already built, made by the release workflow.
3. Before a new major version, shows the section of this page about it and asks for confirmation (`--yes`
   answers yes in advance, for scripts).
4. Unpacks the package into `~/pi-setup/hub` and runs its `hub-install.sh`, as in point 4 below.
5. Waits for the hub to answer with the new version and runs `hub-check.sh --wait`.

It refuses to start while another upgrade or a content update (`hub-update.sh`) is running, or with less than
200 MB free. Its output also goes to `/srv/hub/state/upgrade.log`, and its progress to
`/srv/hub/state/upgrade.json`.

**On the PC** instead, in the folder of this repository (for changes that are not released yet, too):

```powershell
git switch main
git pull
.\deploy.ps1 -Update
```

`deploy.ps1 -Update` asks for your sudo password on the Raspberry Pi and takes a few minutes:

1. If `hub/package-lock.json` changed since the last build, it installs the dependencies again (`npm ci`).
2. It downloads the map fonts and icons if they are missing, builds the website and packs it.
3. It copies the `pi/` folder, with the website, to `~/pi-setup/hub` on the Raspberry Pi.
4. It runs `sudo bash hub-install.sh` there, the installer of the first time, which is safe to run again:
   - `pi/hub-migrate.py` converts files, settings and data whose name or format changed (it prints what it
     does, or "nothing to migrate");
   - the scripts in `/usr/local/sbin` and `/usr/local/lib/raspberry-hub`, the systemd units, the polkit rule,
     the website and the Caddyfile are installed again; your `/etc/hub.conf`, `services.json`, icons,
     password and switch states are kept;
   - the services restart. Pi-hole keeps answering DNS all along; the hub is unreachable only for the few
     seconds Caddy restarts.

### 3. Check

On the Raspberry Pi:

```bash
sudo hub-check.sh
```

The first line is the version just installed, `raspberry-hub X.Y.Z`. Every check should say `[ ok ]`, or
`[ -- ]` when it was skipped on purpose (a service switched off from the hub, content not downloaded yet).
In the hub, the footer shows the same version as the website; when the two differ it says so.

### If something goes wrong

- `deploy.ps1` stops at the first failing step and says which one. The output of `hub-install.sh` names the
  step it was in (`== Packages`, `== Upgrade from earlier versions`, `== Caddy`, ...); `sudo hub-check.sh`
  and `journalctl -u caddy -u hub-control -n 50` usually say why. Fix the cause and run
  `.\deploy.ps1 -Update` again: every step can be repeated.
- `sudo bash hub-install.sh disable` puts Pi-hole's web interface back on ports 80 and 443 and stops Caddy,
  so DNS and the Pi-hole dashboard keep working while you look into it.
- There is no automatic downgrade: a major version converts files in place. To go back, restore the backup
  (`sudo tar -xzf ~/hub-backup.tar.gz -C /`) and install the previous version from its tag
  (for example `git switch --detach v1.0.0`, then its own `deploy.ps1` and `hub-install.sh`).

### Website only

Changes to the interface alone can be published with `.\deploy.ps1` (without `-Update`), which copies only the
website. If the website and the Raspberry Pi scripts then come from different releases, the footer of the hub
says so: run `.\deploy.ps1 -Update` to bring them in step.

### Deploy settings in .env

`deploy.ps1` reads its settings from `.env` in the repository root (ignored by git): plain `KEY=value` lines,
which are only read, never run. Your `deploy.local.ps1` keeps working, so nothing has to change; when both
files set the same value, `.env` wins (and `-Pi` / `-Key` on the command line win over both). To move to `.env`:

1. Copy `.env.example` to `.env`.
2. Copy the values: `$DefaultPi` (1.x: `$PiPredefinito`) becomes `PI_HOST`, `$DefaultKey` (1.x:
   `$ChiavePredefinita`) becomes `PI_SSH_KEY`. Write the key path as text, for example `~/.ssh/id_ed25519`
   instead of `"$env:USERPROFILE\.ssh\id_ed25519"`: `~` is your user folder, and nothing else is expanded.
3. Delete `deploy.local.ps1`.

A setting `deploy.ps1` does not know gets a warning, so a typo does not go unnoticed. `HUB_URL` is the address
printed at the end of a deploy (`https://raspberry/` unless you change it).

## From 1.x to 2.0

Version 2.0 is the same hub, now entirely in English, with an English and Italian interface. Follow the steps
above, including the backup. Everything is converted automatically:

- files, folders, settings and JSON fields are renamed, and the address index is converted in a few minutes
  (no need to rebuild it from the dump);
- `/etc/hub.conf` is rewritten with the new setting names and your values (the old file is kept as
  `/etc/hub.conf.1x`);
- bookmarks to `/mappe/` keep working, and so do map and Wikipedia links with the old `#posizione=`,
  `#voce=` and `#cerca=` addresses;
- the theme chosen on each device is kept; the language follows the browser and can be changed in the header;
- your `deploy.local.ps1` keeps working: `$PiPredefinito` and `$ChiavePredefinita` are still read (rename them
  to `$DefaultPi` and `$DefaultKey`, or move to `.env`, when you like: see [Deploy settings in .env](#deploy-settings-in-env)).

Afterwards:

- every device that was logged in has to **log in once more**: the session cookie moved to the new
  `/control` path;
- the map uses MapLibre GL JS 6, which needs a browser with **WebGL 2** (every current browser has it; on an
  old one the map page says so instead of drawing). It also fixes the MapLibre security advisory
  [GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579);
- `~/pi-setup/hub` still holds the files of 1.x next to the new ones. They are not used any more; to tidy up:

  ```bash
  cd ~/pi-setup/hub && rm -rf hub-servizio hub-verifica.sh servizi.json icone unita sito.tar.gz
  ```

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
| `deploy.ps1 -Chiave`, `$PiPredefinito`, `$ChiavePredefinita` | `deploy.ps1 -Key`, `$DefaultPi`, `$DefaultKey` |
| `ca-di-casa.crt` | `home-ca.crt` |

For developers: `hub-control.py` now answers with machine-readable error and status codes, which the hub
translates; the HTTP API paths and JSON fields are in English (see the top of `pi/hub-control.py`).
