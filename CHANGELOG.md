# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The whole project is now in English, and the interface speaks English and Italian.

### Added

- English and Italian interface. The language follows the browser on a device's first visit and can be
  changed with the `EN` / `IT` buttons in the header; the choice is remembered on that device.
- The footer names the GitHub repository, links to the issue forms ("Report a problem") and links the
  version to the exact commit the site was built from.
- `.\deploy.ps1 -Update`: builds the site, copies the `pi/` scripts to the Raspberry Pi and runs
  `hub-install.sh` there, in one command. Also the way to upgrade.
- `pi/hub-migrate.py`: upgrades installations made by version 1.x in place (run automatically by
  `hub-install.sh`).
- `build-search-index.py --migrate`: converts an existing address index to the new layout in minutes,
  without rebuilding it from the dump.
- Smoke tests for the Pi scripts (`pi/tests`), a smoke test for the built site (`npm run smoke`), new
  Playwright tests for the home page and both languages, and `npm run screenshots` for the README.
- GitHub Actions CI (commit convention, ShellCheck, Pi script tests, typecheck, build, smoke test,
  Playwright), issue and pull request templates, CODEOWNERS, Dependabot, CONTRIBUTING, AGENTS.md,
  Code of Conduct and security policy.

### Changed

- **Breaking**: names of files, folders, settings, commands, URLs and JSON fields are now in English. The
  upgrade converts everything automatically:

  | 1.x | Now |
  |---|---|
  | `/mappe/`, `/cerca`, `/controllo/`, `/icone/`, `/servizi.json`, `/spento/` | `/maps/` (old bookmarks redirect), `/search`, `/control/`, `/icons/`, `/services.json`, `/unavailable/` |
  | `hub-servizio aggiungi\|elenco\|rimuovi` | `hub-service add\|list\|remove` |
  | `hub-verifica.sh [--attendi]` | `hub-check.sh [--wait]` |
  | `hub-update.sh tutto\|mappe\|indirizzi\|stato\|stima-mappe` | `hub-update.sh all\|maps\|addresses\|status\|estimate-maps` (old names still accepted) |
  | `hub-install.sh prepara\|sito\|attiva\|mensile\|disattiva` | `hub-install.sh prepare\|site\|enable\|monthly\|disable` |
  | `/etc/hub.conf`: `WIKI_LINGUA`, `WIKI_VARIANTE`, `MAPPE_BBOX`, `MAPPE_MAXZOOM`, `DUMP_INDIRIZZI`, `GIORNI_MINIMI` | `WIKI_LANGUAGE`, `WIKI_VARIANT`, `MAP_BBOX`, `MAP_MAXZOOM`, `ADDRESS_DUMP_URL`, `MIN_AGE_DAYS` (old file kept as `/etc/hub.conf.1x`) |
  | `/srv/hub/maps/italia.pmtiles`, `/srv/hub/search/indirizzi.db`, `/srv/hub/stato`, `/srv/hub/icone` | `basemap.pmtiles`, `addresses.db`, `/srv/hub/state`, `/srv/hub/icons` |
  | `/etc/hub-control/credenziali.json`, `unita-consentite` | `credentials.json`, `allowed-units` |
  | `deploy.ps1 -Chiave`, `$PiPredefinito`, `$ChiavePredefinita` | `-Key`, `$DefaultPi`, `$DefaultKey` (old names in `deploy.local.ps1` still read) |
  | `ca-di-casa.crt` | `home-ca.crt` |

- Devices that were logged in have to log in once more after the upgrade (the session cookie moved to
  `/control`).
- `hub-control.py` returns machine-readable error and status codes; the hub translates them.
- The board drawing keeps its English labels in both languages, like a real silkscreen.
- The map needs a browser with WebGL 2 (MapLibre GL JS 6). Browsers without it now get a message
  instead of a map that never opens.

### Security

- MapLibre GL JS upgraded from 5.24 to 6.19, which fixes an XSS sanitizer bypass in map attributions
  ([GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579)).

## [1.0.0] - 2026-11-18

First public version (in Italian): Caddy in front of Pi-hole, offline Wikipedia and maps with address search,
service switches, services added from the hub, hardware monitor.

[Unreleased]: https://github.com/Dxz0-96/raspberry-hub/compare/d724cc0...HEAD
[1.0.0]: https://github.com/Dxz0-96/raspberry-hub/tree/d724cc0
