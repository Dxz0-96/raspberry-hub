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
bash -n pi/*.sh pi/hub-cert-sync
shellcheck --severity=warning pi/*.sh pi/hub-cert-sync   # if you have ShellCheck
```

Also check that:

- interface changes work on a phone (the Playwright suite runs on a Pixel 7 profile too), in both themes and
  with the keyboard;
- new or changed text exists in **both** languages;
- anything that changes files, paths, settings or JSON formats on the Raspberry Pi comes with a migration in
  `pi/hub-migrate.py` and a test in `pi/tests/test_pi.py`, so existing installations upgrade with
  `.\deploy.ps1 -Update`;
- `CHANGELOG.md` has a line under "Unreleased" for anything a user would notice;
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

The interface is in English and Italian. All texts are in `hub/lib/messages/en.ts`, which defines the keys,
and `hub/lib/messages/it.ts`, which must have exactly the same keys (TypeScript reports anything missing).
Texts that depend on numbers or names are small functions, so each language can build its own sentence and
plural forms. Numbers and dates are formatted with `hub/lib/format.ts`, which follows the page language.

To add a language: copy `it.ts`, translate it, add the code to `LOCALES` and `MESSAGES` in
`hub/lib/i18n.tsx` and to the language check in `LANGUAGE_SCRIPT`, and add a test like
`hub/tests/i18n.spec.ts`.

## Releases

The version lives in `hub/package.json` and shows in the footer of the hub. To release, move the "Unreleased"
section of `CHANGELOG.md` under the new version number, bump `hub/package.json`, and tag the merge commit
`vX.Y.Z`. Versions follow [Semantic Versioning](https://semver.org/): a change that needs a migration on the
Pi is a major version.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
