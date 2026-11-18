# Changelog

All notable changes to this project. From 2.0.0 on, entries are written by
[release-please](https://github.com/googleapis/release-please) from the
[Conventional Commits](https://www.conventionalcommits.org/) merged into `main`; the project follows
[Semantic Versioning](https://semver.org/). How to upgrade, and what changes between major versions:
[docs/upgrading.md](docs/upgrading.md).

## [2.0.1](https://github.com/Dxz0-96/raspberry-hub/compare/v2.0.0...v2.0.1) (2026-11-18)


### Bug Fixes

* **release:** ensure proper evaluation of pull request condition in C… ([#12](https://github.com/Dxz0-96/raspberry-hub/issues/12)) ([bffc098](https://github.com/Dxz0-96/raspberry-hub/commit/bffc09826cdd3ce126ac1fe4661c12775cfa5bb7))
* **release:** ensure proper evaluation of pull request condition in CI workflow ([bffc098](https://github.com/Dxz0-96/raspberry-hub/commit/bffc09826cdd3ce126ac1fe4661c12775cfa5bb7))

## [2.0.0](https://github.com/Dxz0-96/raspberry-hub/compare/v1.0.0...v2.0.0) (2026-11-18)


### ⚠ BREAKING CHANGES

* run hub-install.sh again (or deploy.ps1 -Update) to migrate; logged-in devices must log in again.

### Features

* english codebase, english/italian interface, ci and community files ([#1](https://github.com/Dxz0-96/raspberry-hub/issues/1)) ([d5726aa](https://github.com/Dxz0-96/raspberry-hub/commit/d5726aa9c3af11d29aef41370511583bbe945f06))
* releases with release-please, and a version check between the website and the pi ([#8](https://github.com/Dxz0-96/raspberry-hub/issues/8)) ([933f724](https://github.com/Dxz0-96/raspberry-hub/commit/933f724de3b529846ec64121b29e54019ff19bff))


### Bug Fixes

* **hub:** upgrade maplibre-gl to 6.x ([#9](https://github.com/Dxz0-96/raspberry-hub/issues/9)) ([3c8a150](https://github.com/Dxz0-96/raspberry-hub/commit/3c8a150fd166f37a59bec87e142cf5b5a582ce53))


### Dependencies and build

* **deps:** Bump maplibre-gl from 5.24.1 to 6.18.0 in /hub ([#6](https://github.com/Dxz0-96/raspberry-hub/issues/6)) ([2e8cb1c](https://github.com/Dxz0-96/raspberry-hub/commit/2e8cb1c109425a10e5aba87ed9ce5ea7a016ecf8))
* **deps:** Bump maplibre-gl from 5.24.1 to 6.4.1 in /hub ([#5](https://github.com/Dxz0-96/raspberry-hub/issues/5)) ([0ec2c73](https://github.com/Dxz0-96/raspberry-hub/commit/0ec2c73270c1f6a063ea39d56511c0da24cb15bc))

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
