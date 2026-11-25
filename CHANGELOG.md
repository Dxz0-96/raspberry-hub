# Changelog

All notable changes to this project. From 2.0.0 on, entries are written by
[release-please](https://github.com/googleapis/release-please) from the
[Conventional Commits](https://www.conventionalcommits.org/) merged into `main`; the project follows
[Semantic Versioning](https://semver.org/). How to upgrade, and what changes between major versions:
[docs/upgrading.md](docs/upgrading.md).

## [2.3.0](https://github.com/Dxz0-96/raspberry-hub/compare/v2.2.2...v2.3.0) (2026-11-25)


### Features

* **hub:** the detailed Raspberry Pi board on phones too ([#59](https://github.com/Dxz0-96/raspberry-hub/issues/59)) ([6884b35](https://github.com/Dxz0-96/raspberry-hub/commit/6884b35b7af83e0bb633eee496a30297b47185b3))

## [2.2.2](https://github.com/Dxz0-96/raspberry-hub/compare/v2.2.1...v2.2.2) (2026-11-22)


### Bug Fixes

* **ci:** refresh release artifact attestation ([#56](https://github.com/Dxz0-96/raspberry-hub/issues/56)) ([978fabb](https://github.com/Dxz0-96/raspberry-hub/commit/978fabb117a497fcd48684866a8e68138954d6be))
* **hub:** official logos for the default services, and a new network monitor icon ([#58](https://github.com/Dxz0-96/raspberry-hub/issues/58)) ([9525d27](https://github.com/Dxz0-96/raspberry-hub/commit/9525d27e636984b25ce0823cfa0c6cf3a8dbe8a4)), closes [#55](https://github.com/Dxz0-96/raspberry-hub/issues/55)

## [2.2.1](https://github.com/Dxz0-96/raspberry-hub/compare/v2.2.0...v2.2.1) (2026-11-22)


### Bug Fixes

* **hub:** the demo takes no space for the Wikipedia it does not have ([d51d055](https://github.com/Dxz0-96/raspberry-hub/commit/d51d05505bec5c841ca9069c2566b96763074724))
* **i18n:** Pizza as the example of the Wikipedia search ([d51d055](https://github.com/Dxz0-96/raspberry-hub/commit/d51d05505bec5c841ca9069c2566b96763074724))

## [2.2.0](https://github.com/Dxz0-96/raspberry-hub/compare/v2.1.0...v2.2.0) (2026-11-22)


### Features

* **hub:** open the Wikipedia edition in the browser language when several are installed ([d0d2278](https://github.com/Dxz0-96/raspberry-hub/commit/d0d2278fa4f505fb1a4e690d57cdb42753a9e7ea))
* **hub:** restart the Raspberry Pi from the header ([129f8de](https://github.com/Dxz0-96/raspberry-hub/commit/129f8dee577db3401629198a42b18a1bffaf21fc))
* **hub:** Spanish, French and German, and the language always follows the browser ([#43](https://github.com/Dxz0-96/raspberry-hub/issues/43)) ([a46fb36](https://github.com/Dxz0-96/raspberry-hub/commit/a46fb3691b352e431863cfc4c49597d6cff5a513))
* look after the Pi's health, and a live demo on GitHub Pages ([#37](https://github.com/Dxz0-96/raspberry-hub/issues/37)) ([e8a7603](https://github.com/Dxz0-96/raspberry-hub/commit/e8a7603d328649fdfee1a743a12eebc4a2cac089))
* **pi:** choose the country of the map and of the address search during installation ([#45](https://github.com/Dxz0-96/raspberry-hub/issues/45)) ([95231fd](https://github.com/Dxz0-96/raspberry-hub/commit/95231fd86dfbd555ac7f523e467ccc3187104a04))
* **pi:** choose the Wikipedia language and variant during installation ([d0d2278](https://github.com/Dxz0-96/raspberry-hub/commit/d0d2278fa4f505fb1a4e690d57cdb42753a9e7ea))
* **pi:** install and run without the pi-setup package ([a0c5296](https://github.com/Dxz0-96/raspberry-hub/commit/a0c5296b670b2fdc6f3fa956eea9dd7e6b3c9a59))
* **pi:** name AdGuard as the DNS resolver in DNS at home ([#41](https://github.com/Dxz0-96/raspberry-hub/issues/41)) ([c4c2044](https://github.com/Dxz0-96/raspberry-hub/commit/c4c2044204a9e3f07ca3b3954d57fe1ee3f7364b))
* **pi:** roll back to the previous version ([a0c5296](https://github.com/Dxz0-96/raspberry-hub/commit/a0c5296b670b2fdc6f3fa956eea9dd7e6b3c9a59))


### Bug Fixes

* **pi:** forget at boot the markers of a content update that was killed ([129f8de](https://github.com/Dxz0-96/raspberry-hub/commit/129f8dee577db3401629198a42b18a1bffaf21fc))
* **pi:** keep the Pi-hole API session across errors, so its few sessions do not run out ([129f8de](https://github.com/Dxz0-96/raspberry-hub/commit/129f8dee577db3401629198a42b18a1bffaf21fc))
* **pi:** other sites cannot frame the hub, and its pages get a Content Security Policy ([#44](https://github.com/Dxz0-96/raspberry-hub/issues/44)) ([9263a1f](https://github.com/Dxz0-96/raspberry-hub/commit/9263a1f7cb9f41b98c3177fc3f884661cfd5aff5))


### Documentation

* point new contributors to the demo, the good first issues and the milestones ([#50](https://github.com/Dxz0-96/raspberry-hub/issues/50)) ([d9d5389](https://github.com/Dxz0-96/raspberry-hub/commit/d9d53895db12c64896d06afb04bf77be0ef71ca3)), closes [#28](https://github.com/Dxz0-96/raspberry-hub/issues/28)

## [2.1.0](https://github.com/Dxz0-96/raspberry-hub/compare/v2.0.1...v2.1.0) (2026-11-20)


### Features

* **hub:** last-month view in Trends, without the data table ([#34](https://github.com/Dxz0-96/raspberry-hub/issues/34)) ([3f1ee03](https://github.com/Dxz0-96/raspberry-hub/commit/3f1ee03635abc0b6588e916db023671f53c86b03))
* read the deploy settings from a .env file ([#32](https://github.com/Dxz0-96/raspberry-hub/issues/32)) ([9e68f4f](https://github.com/Dxz0-96/raspberry-hub/commit/9e68f4f1de1f0ac36503c8736252c34322339f6d)), closes [#16](https://github.com/Dxz0-96/raspberry-hub/issues/16)
* release packages ready to install, and upgrade from the Pi ([#35](https://github.com/Dxz0-96/raspberry-hub/issues/35)) ([b12eb4a](https://github.com/Dxz0-96/raspberry-hub/commit/b12eb4a7849e1ae759d919865c4b98fbeac6b5d3))


### Bug Fixes

* deploy.ps1 reinstalls changed dependencies, and a step-by-step update guide ([#14](https://github.com/Dxz0-96/raspberry-hub/issues/14)) ([34328a3](https://github.com/Dxz0-96/raspberry-hub/commit/34328a379747d8d23b5cc7931765d9a007797ed3))
* **pi:** never send a response header with a control character ([#31](https://github.com/Dxz0-96/raspberry-hub/issues/31)) ([0742e40](https://github.com/Dxz0-96/raspberry-hub/commit/0742e40d147a1492d16a7208c3e75c568f3417ff))

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
