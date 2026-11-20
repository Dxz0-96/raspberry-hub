# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Copilot and similar) working in this repository.
Humans should read [CONTRIBUTING.md](CONTRIBUTING.md) first; everything there applies to agents too.

## What this project is

A home hub for a Raspberry Pi 3 (1 GB RAM, 64-bit Debian 13, Pi-hole v6). Two halves:

- `hub/`: Next.js 16 + React 19 + TypeScript, built as a **static export** (`output: "export"`). There is no
  Node server at run time: no API routes, no server actions, no `getServerSideProps`, no middleware.
- `pi/`: what runs on the Pi. Python 3.13 services using **only the standard library**, Bash scripts,
  systemd units and a Caddyfile. Nothing may require `pip install` or extra packages on the Pi beyond those
  `hub-install.sh` installs.

Caddy serves the static site and proxies `/control/` (hub-control.py), `/search` (hub-search.py) and
`/wiki/` (kiwix-serve). The README section "How it is built" has the full map.

## Commands

Run from `hub/` unless noted. All of them must pass before you say a change is done.

| Purpose | Command |
|---|---|
| Install | `npm ci` |
| Typecheck | `npm run typecheck` |
| Build the static site | `npm run build` |
| Smoke test the built site | `npm run smoke` |
| End-to-end tests | `npx playwright test` (Chromium: `npx playwright install chromium` once) |
| Mock Raspberry Pi for manual checks | `npm run mock`, then http://localhost:8790 (admin / test1234) |
| Pi script tests (repository root) | `python3 -m unittest discover -s pi/tests` |
| Shell scripts (repository root) | `bash -n pi/*.sh pi/hub-cert-sync` and `shellcheck --severity=warning pi/*.sh pi/hub-cert-sync` |
| Commit message check | `bash .github/scripts/check-commits.sh "<message>"` |

The hub-control tests in `pi/tests` need Linux (`/proc`) and are skipped elsewhere; CI runs them.

## Rules

1. **Every interface string goes through the dictionaries.** Add the key to `hub/lib/messages/en.ts` and the
   Italian text to `hub/lib/messages/it.ts`, then read it with `const { t } = useI18n()`. Never hard-code
   user-visible text in components. Format numbers and dates with `hub/lib/format.ts` and the current
   `locale`. The board drawing (`components/Board.tsx`) is the one exception: its labels are an English
   silkscreen in every language.
2. **The Pi API speaks codes, not sentences.** `hub-control.py` errors are `{"error": "<code>", "message":
   "<English fallback>"}` and service states carry a `detail` code. Add new codes to `apiErrors` or
   `services.details` in both dictionaries.
3. **Anything that changes the Pi's files, paths, settings, JSON fields or the address index schema needs a
   migration** in `pi/hub-migrate.py` (idempotent: running it twice must be a no-op) and a test in
   `pi/tests/test_pi.py`. Existing installations upgrade by re-running `hub-install.sh`; never require a
   reinstall.
4. **Keep the mock in step with the real services.** `hub/dev/mock-server.mjs` must answer exactly like
   `hub-control.py`, `hub-search.py` and Caddy, because the Playwright tests run against it.
5. **Respect the Pi 3.** No polling faster than the existing intervals, no new heavy dependencies, no
   writes to the SD card in loops (the monitor keeps its history in memory on purpose; only the hourly
   month is saved, when the service stops and at most once a day).
6. **Accessibility is tested.** Tests find elements by role and accessible name; keep labels, `aria-*`
   attributes and keyboard behaviour working, and update the tests when you rename a label.
7. **Tests:** Playwright tests import `test` and `expect` from `hub/tests/helpers.ts` (its `page.goto`
   waits for hydration). Tests run in parallel against one shared mock server: do not change its state in a
   way other tests can observe; use `page.route` (see `serviceIn`) instead.
8. **Commits and pull requests** follow Conventional Commits (`feat(hub): ...`, `fix(pi): ...`); CI rejects
   other messages. The pull request title becomes the changelog line. **Never edit versions or
   `CHANGELOG.md` by hand**: release-please does it (`version.txt`, `.release-please-manifest.json`,
   `hub/package.json`, the `x-release-please-version` line in `pi/hub-install.sh`). Breaking changes get a `!`
   and a section in `docs/upgrading.md`.
9. **Do not commit** build output (`hub/out`, `hub/.next`, `pi/site.tar.gz`, `hub/public/map-assets`),
   certificates or `deploy.local.ps1`. Never put real IP addresses, passwords or tokens in the repository.
10. Names, comments and docs are in English.

## Where things are

| Need | Look at |
|---|---|
| Data fetching, login, toasts | `hub/lib/hub.tsx` |
| Response shapes from the Pi | `hub/lib/types.ts` |
| Language detection and switching | `hub/lib/i18n.tsx` |
| Styles (one stylesheet, colour tokens on `:root`) | `hub/app/globals.css` |
| Service list shipped with a new install | `pi/services.json` |
| Install, upgrade, rollback | `pi/hub-install.sh`, `pi/hub-migrate.py` |
| Content downloads (Wikipedia, maps, address index) | `pi/hub-update.sh`, `pi/build-search-index.py` |
