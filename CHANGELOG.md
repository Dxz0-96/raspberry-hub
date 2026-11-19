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

## [1.0.0](https://github.com/Dxz0-96/raspberry-hub/releases/tag/v1.0.0) (2026-11-18)

First public version (in Italian): Caddy in front of Pi-hole, offline Wikipedia and maps with address search,
service switches, services added from the hub, hardware monitor.
