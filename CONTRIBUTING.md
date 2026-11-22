# Contributing to raspberry hub

Thanks for helping. This project is a home hub that runs entirely on a Raspberry Pi 3 (1 GB of RAM) without
cloud services: changes should keep it light, offline and simple to run at home.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems are reported
privately: see [SECURITY.md](SECURITY.md).

## Ways to help

- **Report a bug** or **suggest a feature** with the [issue forms](https://github.com/Dxz0-96/raspberry-hub/issues/new/choose).
- **Improve a translation**: all interface text is in `hub/lib/messages/` (see [Translations](#translations)).
- **Send a pull request**: for anything bigger than a small fix, open an issue first so we can agree on the approach.

## Project layout

| Path | What it is |
|---|---|
| `hub/app/` | Next.js pages (static export: no server-side code at run time) |
| `hub/components/` | React components, one per part of the interface |
| `hub/lib/` | Data layer (`hub.tsx`), types, formatting, theme, i18n and the text dictionaries |
| `hub/dev/` | Mock Raspberry Pi and fake Wikipedia used for development and tests |
| `hub/tests/` | Playwright end-to-end tests |
| `pi/` | What runs on the Raspberry Pi: Python services (standard library only), Bash scripts, systemd units, Caddyfile |
| `pi/tests/` | Smoke tests for the Pi scripts (standard library `unittest`) |
| `.github/` | CI, issue and pull request templates, Dependabot |

The [README](README.md#how-it-is-built) shows how the pieces fit together on the Pi.

## Setting up

```bash
git clone https://github.com/Dxz0-96/raspberry-hub.git
cd raspberry-hub/hub
npm install
npm run assets                 # map fonts and icons, once
npm run build
npm run mock                   # http://localhost:8790, test login: admin / test1234
npx playwright install chromium  # once, for the end-to-end tests
```

You need Node.js 20 or newer and Python 3.11 or newer (the Pi runs Python 3.13). A Raspberry Pi is not
needed: the mock Raspberry Pi (`hub/dev/mock-server.mjs`) answers like the real services, and its
options are described at the top of the file.

## Before opening a pull request

Run what CI runs:

```bash
# in hub/
npm run typecheck
npm run build
npm run smoke
npx playwright test

# in the repository root
python3 -m unittest discover -s pi/tests
bash -n pi/*.sh pi/hub-cert-sync pi/hub-cert pi/kiwix-start
shellcheck --severity=warning pi/*.sh pi/hub-cert-sync pi/hub-cert pi/kiwix-start   # if you have ShellCheck
```

Also check that:

- interface changes work on a phone (the Playwright suite runs on a Pixel 7 profile too), in both themes and
  with the keyboard;
- new or changed text exists in **every** language (`hub/lib/messages/`);
- anything that changes files, paths, settings or JSON formats on the Raspberry Pi comes with a migration in
  `pi/hub-migrate.py` and a test in `pi/tests/test_pi.py`, so existing installations upgrade with
  `.\deploy.ps1 -Update`;
- the pull request title says what changes for someone using the hub: it becomes the commit on `main` and the
  line in the changelog (see [Releases](#releases));
- the README screenshots are refreshed (`npm run screenshots` in `hub/`) if the interface changed visibly.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). CI checks the title of every
pull request and each of its commits.

```
<type>(<optional scope>): <summary in the imperative, lower case, no final period>

<optional body: what and why, wrapped at 100 columns>

<optional footer: "Closes #12", "BREAKING CHANGE: ...">
```

| Type | For |
|---|---|
| `feat` | A new feature for people using the hub |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no change in behaviour |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Faster or lighter |
| `test` | Tests only |
| `build` | Build system, dependencies |
| `ci` | GitHub Actions and other CI configuration |
| `chore` | Anything else that does not touch the hub or the Pi scripts |
| `revert` | Reverts an earlier commit |

Scopes: `hub` (interface), `pi` (Raspberry Pi scripts and services), `i18n`, `docs`, `ci`, `deps`, or none.
Add `!` before the colon for a breaking change (for example a change that needs a migration on the Pi), and
explain it in a `BREAKING CHANGE:` footer.

Examples:

```
feat(hub): show the Wi-Fi signal on the board
fix(pi): keep the maps switched off after an update
docs: explain how to change the map area
feat(pi)!: move the address index to a new schema
```

You can check a message locally with `bash .github/scripts/check-commits.sh "feat(hub): ..."`.

## Pull requests and reviews

- Branch from `main`, keep each pull request focused on one change, and fill in the template.
- `main` is protected: changes land only through pull requests, CI must pass, and every pull request needs
  the approval of the maintainer (see `.github/CODEOWNERS`) before it can be merged.
- Pull requests are **squash-merged**: the pull request title becomes the commit message on `main`, so it must
  follow the convention above.
- Reviews look at behaviour on the Pi 3 (memory, CPU, SD card writes), accessibility and the upgrade path.

## Code style

- **TypeScript/React**: strict TypeScript, function components and hooks, no new runtime dependencies unless
  they clearly pay for themselves on a Pi 3. CSS lives in `hub/app/globals.css`, with colours as custom
  properties on `:root` and a dark variant.
- **Python** (`pi/`): standard library only, so nothing needs installing on the Pi. Errors returned by
  `hub-control.py` carry a machine-readable `error` code that the hub translates, and an English `message`
  as a fallback.
- **Bash**: `set -u` or `set -e` as the existing scripts do, quoted variables, and ShellCheck clean at the
  warning level.
- Names, comments and documentation are in English.

## Translations

The interface is in English, Italian, Spanish, French and German, and follows the language of the browser
(there is no switch in the page). All texts are in `hub/lib/messages/`: `en.ts` defines the keys, and every other
dictionary must have exactly the same ones (TypeScript reports anything missing, and `hub/tests/i18n.spec.ts`
also checks the error and state codes of `apiErrors` and `services.details`). Texts that depend on numbers or
names are small functions, so each language can build its own sentence and plural forms. Numbers and dates are
formatted with `hub/lib/format.ts`, which follows the page language; what Intl does not know (the short units of
a duration, "1°" or "1er" for the first of the month, "Go" for gigabytes) is in the `format` section of each
dictionary.

To add a language:

1. Copy `en.ts` to `xx.ts` (`xx` is the language code, for example `pt`) and translate it.
2. Import it in `hub/lib/messages/index.ts` and add one line to `LOCALES`, with the name of the language in that
   language. The detection before the first paint, the map labels and the tests' list of languages follow it.
3. Add a test to `hub/tests/i18n.spec.ts` with a browser in that language (texts, numbers and dates).

A language is not a place: adding French does not touch the map area, the address data or the Wikipedia
edition, which are chosen on the Raspberry Pi.

## Dependency updates

Dependabot opens its pull requests once a month, grouped (`.github/dependabot.yml`). Minor and patch npm
updates merge by themselves once the required checks pass: `.github/workflows/dependabot.yml` approves them and
turns on auto-merge, and `hub/package.json` and `hub/package-lock.json` have no code owner for this. Major npm
versions and GitHub Actions updates wait for the maintainer: check the release notes (and, for anything that
touches the map or the Pi, the hub itself) before merging. If main moved on, `@dependabot rebase` in a comment
brings a pull request up to date.

## Releases

Releases are made by [release-please](https://github.com/googleapis/release-please)
(`.github/workflows/release.yml`), from the Conventional Commits merged into `main`:

1. After every merge it opens or updates a **release pull request**, `chore(main): release X.Y.Z`, with the
   next version and the new `CHANGELOG.md` entry. `fix` bumps the patch, `feat` the minor, and `!` or a
   `BREAKING CHANGE:` footer the major version ([Semantic Versioning](https://semver.org/)); `docs`, `build`
   and the other types are listed but do not trigger a release on their own.
2. Merging the release pull request tags `vX.Y.Z` and publishes the GitHub release with the same notes.
3. Right after, `.github/workflows/package.yml` builds `raspberry-hub-X.Y.Z.tar.gz` (the `pi/` folder with the
   website already built, by `.github/scripts/build-package.sh`) and `SHA256SUMS`, attests them and attaches
   them to the release: that is what `sudo hub-install.sh upgrade` installs on the Raspberry Pi. It can be
   run again by hand for a tag ("Run workflow" on the Actions page).

**Never edit versions or `CHANGELOG.md` by hand.** The version lives in `version.txt` and
`.release-please-manifest.json`; release-please copies it into `hub/package.json` (shown in the footer of the
hub) and into `pi/hub-install.sh` (written to the Pi, so the hub can tell when the website and the Pi scripts
come from different releases). A change that needs a migration on the Pi is a breaking change: mark it with
`!` and describe the upgrade in [docs/upgrading.md](docs/upgrading.md).

Pull requests opened by GitHub Actions do not start other workflows, so `release.yml` starts CI on the
release pull request itself (`workflow_dispatch`); the "Commit convention" check is skipped there and counts
as passed.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
