#!/bin/bash
# Builds the release package: everything the Raspberry Pi needs, website included, so a release can be
# installed or upgraded from the Pi alone (sudo hub-install.sh upgrade). Run by .github/workflows/package.yml
# for every release; from the repository root, after npm ci in hub/:
#
#   bash .github/scripts/build-package.sh 2.1.0 dist
#
# Writes dist/raspberry-hub-2.1.0.tar.gz (one folder raspberry-hub-2.1.0/: the pi/ folder without the tests,
# site.tar.gz built from hub/, UPGRADING.md) and dist/SHA256SUMS.
set -euo pipefail
VERSION="${1:?usage: build-package.sh X.Y.Z [output folder]}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "${2:-dist}"
OUT="$(cd "${2:-dist}" && pwd)"
NAME="raspberry-hub-$VERSION"

[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not a version: $VERSION" >&2; exit 1; }
# the package must be what it says: the installer and the website carry the same version
grep -qE "^HUB_VERSION=$VERSION([[:space:]]|$)" "$ROOT/pi/hub-install.sh" \
  || { echo "pi/hub-install.sh is not at version $VERSION" >&2; exit 1; }
[ "$(cd "$ROOT/hub" && node -p 'require("./package.json").version')" = "$VERSION" ] \
  || { echo "hub/package.json is not at version $VERSION" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "== Website"
(cd "$ROOT/hub" && npm run assets && npm run build)
echo "== Package"
mkdir "$WORK/$NAME"
tar -C "$ROOT/pi" --exclude=tests --exclude=__pycache__ --exclude=site.tar.gz -cf - . | tar -C "$WORK/$NAME" -xf -
tar -czf "$WORK/$NAME/site.tar.gz" -C "$ROOT/hub/out" .
cp "$ROOT/docs/upgrading.md" "$WORK/$NAME/UPGRADING.md"
tar -czf "$OUT/$NAME.tar.gz" -C "$WORK" --owner=0 --group=0 --numeric-owner "$NAME"
(cd "$OUT" && sha256sum "$NAME.tar.gz" > SHA256SUMS)
echo "   $OUT/$NAME.tar.gz ($(( $(stat -c %s "$OUT/$NAME.tar.gz") / 1048576 )) MB)"
cat "$OUT/SHA256SUMS"
