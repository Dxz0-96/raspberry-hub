#!/bin/bash
# Checks the external sources of the content on the Raspberry Pi the way the scripts use them, without
# downloading the big files: the Kiwix listing, the Protomaps builds, the Photon address dump, the pinned
# go-pmtiles release and the map assets. Run every week by .github/workflows/sources.yml, so a change on their
# side is found before the monthly update on the Pi. From the repository root, by hand:
#
#   bash .github/scripts/check-sources.sh [report.md]
#
# Prints one line per check and exits with 1 if any failed; with a file name it also writes the failures there
# as Markdown (RUN_URL, if set, is linked at the end). Needs curl, python3, zstd and node.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPORT="${1:-}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
MAX_DUMP_AGE_DAYS=60      # the Photon dump is rebuilt every week: much older means it moved to a new name

# The settings and functions of the update itself, so this check cannot drift from it (sourced, hub-update.sh
# stops before doing anything), then the configuration a new installation gets.
saved_path=$PATH
# shellcheck source=pi/hub-update.sh
. "$ROOT/pi/hub-update.sh"
# shellcheck source=pi/hub.conf
. "$ROOT/pi/hub.conf"
PATH=$saved_path
eval "$(grep -E '^PMTILES_(VERSION|SHA256|URL)=' "$ROOT/pi/hub-install.sh")"

failures=()
ok()   { printf '[ ok ] %s\n' "$1"; }
fail() { printf '[FAIL] %s: %s\n' "$1" "$2"; failures+=("- **$1**: $2"); }
for tool in curl python3 zstd node; do
  command -v "$tool" >/dev/null || fail "Tools" "$tool is not installed, so some checks cannot run"
done

# --------------------------------------------------------------------------- Wikipedia (hub-update.sh wiki)
name="Wikipedia (Kiwix)"
latest=$(latest_wiki)
if [ -z "$latest" ]; then
  fail "$name" "no wikipedia_${WIKI_LANGUAGE}_all_${WIKI_VARIANT}_YYYY-MM.zim in the listing of $WIKI_URL"
else
  ok "$name: latest edition $latest"
  bytes=$(wiki_size "$latest")
  if [ "${bytes:-0}" -gt 0 ]; then ok "$name: size known ($(( bytes / 1048576 )) MB), so the free space check works"
  else fail "$name" "no Content-Length for $WIKI_URL$latest: the free space check before the download cannot work"; fi
  sha=$(wiki_sha256 "$latest")
  if [[ $sha =~ ^[0-9a-f]{64}$ ]]; then ok "$name: SHA-256 published"
  else fail "$name" "no SHA-256 at $WIKI_URL$latest.sha256: the update would refuse to install the edition"; fi
fi

# --------------------------------------------------------------------------- Maps (hub-update.sh maps)
name="Maps (Protomaps)"
build=$(latest_build)
if [ -z "$build" ]; then
  fail "$name" "no .pmtiles build with an upload date in $BUILDS_URL"
else
  ok "$name: latest build $build"
  # pmtiles extract reads the build in pieces: it needs range requests and a PMTiles version 3 header
  code=$(curl -sS --max-time 60 -r 0-126 -o "$WORK/header" -w '%{http_code}' "$TILES_URL$build")
  if [ "$code" != 206 ]; then
    fail "$name" "$TILES_URL$build answered $code to a range request instead of 206: pmtiles extract needs them"
  elif [ "$(head -c 7 "$WORK/header")" != PMTiles ] || [ "$(od -An -tu1 -j7 -N1 "$WORK/header" | tr -d ' ')" != 3 ]; then
    fail "$name" "$TILES_URL$build does not start with a PMTiles version 3 header"
  else
    ok "$name: range requests and PMTiles v3 header"
  fi
fi

# --------------------------------------------------------------------------- Addresses (hub-update.sh addresses)
name="Addresses (Photon dump)"
md5=$(dump_md5)
if [[ $md5 =~ ^[0-9a-f]{32}$ ]]; then ok "$name: MD5 published"
else fail "$name" "no MD5 at $ADDRESS_DUMP_URL.md5: a new dump version or path? (ADDRESS_DUMP_URL in pi/hub.conf)"; fi
# The first 4 MB, read by build-search-index.py exactly as on the Pi; the cut last line is skipped.
code=$(curl -sS --max-time 120 -r 0-4194303 -o "$WORK/dump.part" -w '%{http_code}' "$ADDRESS_DUMP_URL")
if [ "$code" != 206 ]; then
  fail "$name" "$ADDRESS_DUMP_URL answered $code to a range request instead of 206 (missing, or no resumable downloads)"
else
  { zstd -dc < "$WORK/dump.part" 2>/dev/null || true; } \
    | python3 "$ROOT/pi/build-search-index.py" --out "$WORK/sample.db" > "$WORK/build.log" 2>&1
  summary=$(python3 -c '
import sqlite3, sys
meta = dict(sqlite3.connect(sys.argv[1]).execute("SELECT key, value FROM meta"))
entries = sum(int(meta.get(k, 0)) for k in ("streets", "places", "house_numbers"))
print(meta.get("places_read", 0), entries, meta.get("data_date") or "-")' "$WORK/sample.db" 2>/dev/null) || summary="0 0 -"
  read -r places entries data_date <<< "$summary"
  age=$(( ( $(date +%s) - $(date -d "$data_date" +%s 2>/dev/null || echo 0) ) / 86400 ))
  if [ "${places:-0}" -eq 0 ]; then
    fail "$name" "build-search-index.py read no places from the start of the dump: has the format changed? $(tail -n 3 "$WORK/build.log" | tr '\n' ' ')"
  elif [ "${entries:-0}" -eq 0 ]; then
    fail "$name" "$places places read but none indexed: the fields build-search-index.py uses (centroid, name, address) have changed"
  elif ! [[ $data_date =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    fail "$name" "no data date in the dump header (NominatimDumpFile, data_timestamp)"
  elif [ "$age" -gt "$MAX_DUMP_AGE_DAYS" ]; then
    fail "$name" "the data is from $data_date, $age days ago: the dump is no longer updated, a new version may have a new name (ADDRESS_DUMP_URL in pi/hub.conf)"
  else
    ok "$name: $places places read from the start of the dump, $entries indexed, data from $data_date"
  fi
fi

# --------------------------------------------------------------------------- go-pmtiles (hub-install.sh prepare)
name="go-pmtiles $PMTILES_VERSION"
if ! curl -fsSL --max-time 300 -o "$WORK/pmtiles.tar.gz" "$PMTILES_URL"; then
  fail "$name" "$PMTILES_URL does not download: was the release removed? (PMTILES_VERSION in pi/hub-install.sh)"
elif [ "$(sha256sum "$WORK/pmtiles.tar.gz" | awk '{print $1}')" != "$PMTILES_SHA256" ]; then
  fail "$name" "the archive no longer matches PMTILES_SHA256 in pi/hub-install.sh"
elif ! tar -tzf "$WORK/pmtiles.tar.gz" pmtiles >/dev/null 2>&1; then
  fail "$name" "the archive has no pmtiles program in it"
else
  ok "$name: downloads and matches PMTILES_SHA256"
fi

# --------------------------------------------------------------------------- Map assets (npm run assets)
name="Map assets"
if output=$(MAP_ASSETS_DIR="$WORK/map-assets" node "$ROOT/hub/scripts/fetch-map-assets.mjs" 2>&1); then
  ok "$name: ${output#Map assets: }"
else
  reason=$(grep -m1 -E '^[A-Za-z]*Error:' <<< "$output" || tail -n 1 <<< "$output")
  fail "$name" "npm run assets fails: $reason"
fi

# --------------------------------------------------------------------------- result
if [ ${#failures[@]} -eq 0 ]; then
  echo "All the content sources answer as the scripts expect."
  exit 0
fi
if [ -n "$REPORT" ]; then
  {
    echo "The weekly check of the external content sources found a problem. Until it is fixed, the monthly update"
    echo "on the Raspberry Pi will probably fail at the same step (the content already installed keeps working)."
    echo
    printf '%s\n' "${failures[@]}"
    echo
    echo "The check reads the same settings and functions as \`pi/hub-update.sh\`; it runs again every week and"
    echo "closes this issue when everything answers again."
    if [ -n "${RUN_URL:-}" ]; then echo; echo "Run: $RUN_URL"; fi
  } > "$REPORT"
fi
exit 1
