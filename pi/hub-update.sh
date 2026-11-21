#!/bin/bash
# Updates the raspberry-hub content: offline Wikipedia, maps, address index.
#
#   sudo hub-update.sh                everything (this is what the monthly update runs)
#   sudo hub-update.sh wiki           Wikipedia only
#   sudo hub-update.sh maps           maps only
#   sudo hub-update.sh addresses      address index only
#   sudo hub-update.sh estimate-maps [BOX]
#                                     tells how big the maps of MAP_BBOX (or of BOX: west,south,east,north) would be,
#                                     without downloading them
#   sudo hub-update.sh status         only rewrites /srv/hub/status.json
#   sudo hub-update.sh check-version  asks GitHub for the latest release (hub-version-check.timer, daily)
#
# Every new piece of content is downloaded on the side, verified and swapped with the old one only
# if it is intact: if something goes wrong the previous version keeps working.
# Settings in /etc/hub.conf.
set -u
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C.UTF-8

WIKI_LANGUAGE=it
WIKI_VARIANT=maxi
MAP_COUNTRY=IT
MAP_BBOX=6.6,35.4,18.6,47.2
MAP_MAXZOOM=15
ADDRESS_DUMP_URL=https://download1.graphhopper.com/public/europe/italy/photon-dump-italy-1.0-latest.jsonl.zst
ADDRESS_LANGUAGES=it
MIN_AGE_DAYS=20
HUB_DIR=/srv/hub
CHECK_FOR_UPDATES=yes
NOTIFY_NEW_VERSION=
# shellcheck source=hub.conf
[ -r /etc/hub.conf ] && . /etc/hub.conf

LIB=/usr/local/lib/raspberry-hub
ZIM="$HUB_DIR/zim"
MAPS="$HUB_DIR/maps"
SEARCH="$HUB_DIR/search"
STATE="$HUB_DIR/state"
# The external sources. .github/scripts/check-sources.sh reads them, and the functions below, every week: a
# change on their side is found before the monthly update.
WIKI_URL="https://download.kiwix.org/zim/wikipedia/"
BUILDS_URL="https://build-metadata.protomaps.dev/builds.json"
TILES_URL="https://build.protomaps.com/"
RELEASES_URL="https://api.github.com/repos/Dxz0-96/raspberry-hub/releases/latest"

ts()  { date "+%F %T"; }
log() { echo "$(ts) $*"; }
result() { echo "$2" > "$STATE/$1.result"; }          # $1 = wiki|maps|addresses  $2 = ok | error: ...
failed() { log "ERROR $1: $2"; result "$1" "error: $2"; return 1; }
free_kb() { df -Pk "$HUB_DIR" | awk 'NR==2 {print $4}'; }
age_days() { echo $(( ( $(date +%s) - $(stat -c %Y "$1" 2>/dev/null || echo 0) ) / 86400 )); }
remote_size() {   # $1 = address: the size of the file in bytes, 0 if unknown
  curl -fsSIL --max-time 60 "$1" | awk 'tolower($1)=="content-length:" {v=$2} END {print v+0}' | tr -d '\r'
}
# What the installed content was made from, next to it: when the settings change (another country, sudo
# hub-install.sh configure), the content is rebuilt even if it is recent. Content installed before these files
# existed was made from the settings of now.
made_from() {     # $1 = the file that says it, $2 = the content, $3 = the settings of now: true if they match
  if [ -s "$2" ] && [ ! -f "$1" ]; then echo "$3" > "$1"; fi
  [ ! -s "$2" ] || [ "$(cat "$1" 2>/dev/null)" = "$3" ]
}

write_status() {
  HUB_DIR="$HUB_DIR" WIKI_LANGUAGE="$WIKI_LANGUAGE" python3 - <<'PY'
import json, os, re, time
hub = os.environ["HUB_DIR"]
def latest():
    try:
        with open(f"{hub}/state/latest.json", encoding="utf-8") as f:
            data = json.load(f)
        return {k: data.get(k) for k in ("version", "url", "published", "checked")}
    except (OSError, ValueError, AttributeError):
        return None
def read(p):
    try:
        with open(p, encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None
def size(p):
    try:
        return os.path.getsize(p)
    except OSError:
        return None
link = f"{hub}/zim/wikipedia_{os.environ['WIKI_LANGUAGE']}.zim"
target = os.path.realpath(link) if os.path.exists(link) else None
m = re.search(r"_(\d{4}-\d{2})\.zim$", target or "")
status = {
    "updated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    "wikipedia": {"edition": m.group(1) if m else None, "bytes": size(target) if target else None,
                  "result": read(f"{hub}/state/wiki.result"), "running": os.path.exists(f"{hub}/state/wiki.running")},
    "maps": {"build": (read(f"{hub}/maps/basemap.build") or "")[:8] or None,
             "bytes": size(f"{hub}/maps/basemap.pmtiles"), "result": read(f"{hub}/state/maps.result"),
             "running": os.path.exists(f"{hub}/state/maps.running")},
    "addresses": {"date": read(f"{hub}/search/addresses.date"), "bytes": size(f"{hub}/search/addresses.db"),
                  "result": read(f"{hub}/state/addresses.result"),
                  "running": os.path.exists(f"{hub}/state/addresses.running")},
    # the latest release found by check-version (null when the check is switched off or never ran)
    "latest": latest(),
}
tmp = f"{hub}/status.json.tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(status, f, ensure_ascii=False)
os.chmod(tmp, 0o644)
os.replace(tmp, f"{hub}/status.json")
PY
}
running() {      # $1 = wiki|maps|addresses  $2 = yes|no : tells the hub that the content is on its way
  if [ "$2" = yes ]; then : > "$STATE/$1.running"; else rm -f "$STATE/$1.running"; fi
  write_status
}

# --------------------------------------------------------------------------- Wikipedia
latest_wiki() {   # the newest edition of the configured language and variant in the Kiwix listing
  curl -fsSL --max-time 120 "$WIKI_URL" \
    | grep -oE "wikipedia_${WIKI_LANGUAGE}_all_${WIKI_VARIANT}_[0-9]{4}-[0-9]{2}\.zim" | sort -u | tail -1
}
wiki_size() {     # $1 = file name: its size in bytes, 0 if unknown
  remote_size "$WIKI_URL$1"
}
wiki_sha256() {   # $1 = file name: the SHA-256 published next to it
  curl -fsSL --max-time 60 "$WIKI_URL$1.sha256" | awk '{print $1}'
}

do_wiki() {
  local latest dest link current bytes needed sha expected
  latest=$(latest_wiki)
  [ -n "$latest" ] || { failed wiki "list of editions not readable ($WIKI_URL)"; return 1; }
  dest="$ZIM/$latest"
  link="$ZIM/wikipedia_${WIKI_LANGUAGE}.zim"
  current=$(readlink -f "$link" 2>/dev/null || true)
  if [ -s "$dest" ] && [ "$current" = "$dest" ]; then
    log "wiki: already at the latest edition ($latest)"; result wiki ok; return 0
  fi

  running wiki yes
  if [ ! -s "$dest" ]; then
    bytes=$(wiki_size "$latest")
    needed=$(( bytes / 1024 + 2097152 ))            # the file plus 2 GB of headroom
    if [ -f "$dest.part" ]; then needed=$(( needed - $(stat -c %s "$dest.part") / 1024 )); fi
    if [ "$(free_kb)" -lt "$needed" ]; then
      failed wiki "not enough space for $latest ($(( needed / 1048576 )) GB free needed)"; return 1
    fi
    log "wiki: downloading $latest ($(( bytes / 1073741824 )) GB), resumes where it stopped if interrupted"
    if ! wget -c -nv --tries=20 --waitretry=30 --timeout=60 -O "$dest.part" "$WIKI_URL$latest"; then
      failed wiki "download interrupted, it will resume at the next update"; return 1
    fi
    expected=$(wiki_sha256 "$latest")
    if [ ${#expected} -ne 64 ]; then
      failed wiki "SHA-256 checksum not available, file not installed"; return 1
    fi
    log "wiki: verifying the SHA-256 checksum"
    sha=$(nice -n 10 sha256sum "$dest.part" | awk '{print $1}')
    if [ "$sha" != "$expected" ]; then
      rm -f "$dest.part"
      failed wiki "SHA-256 checksum differs from the published one: file discarded"; return 1
    fi
    mv -f "$dest.part" "$dest"
    chmod 644 "$dest"
  fi

  ln -sfn "$latest" "$link.new" && mv -Tf "$link.new" "$link"
  # restart and not try-restart: on the first installation the service never started (the file was missing).
  # If Wikipedia is switched off from the hub, the unit condition keeps it stopped.
  systemctl restart kiwix-hub.service 2>/dev/null || true
  # remove earlier editions of the same variant
  find "$ZIM" -maxdepth 1 -type f -name "wikipedia_${WIKI_LANGUAGE}_all_*.zim" ! -name "$latest" -delete
  find "$ZIM" -maxdepth 1 -type f -name "*.zim.part" ! -name "$latest.part" -delete
  log "wiki: installed edition $latest"
  result wiki ok
}

# --------------------------------------------------------------------------- Maps
latest_build() {
  curl -fsSL --max-time 120 "$BUILDS_URL" | python3 -c '
import json, sys
b = [x for x in json.load(sys.stdin) if str(x.get("key", "")).endswith(".pmtiles") and x.get("uploaded")]
b.sort(key=lambda x: x["uploaded"])
print(b[-1]["key"] if b else "")'
}

do_maps() {
  local latest dest="$MAPS/basemap.pmtiles" rc area="$MAP_BBOX z$MAP_MAXZOOM"
  command -v pmtiles >/dev/null || { failed maps "pmtiles command not installed"; return 1; }
  if ! made_from "$MAPS/basemap.area" "$dest" "$area"; then
    log "maps: the installed ones are of another area ($(cat "$MAPS/basemap.area")), extracting the new one"
  elif [ -s "$dest" ] && [ "$(age_days "$MAPS/basemap.build")" -lt "$MIN_AGE_DAYS" ]; then
    log "maps: the installed ones are less than $MIN_AGE_DAYS days old, keeping them"; result maps ok; return 0
  fi
  latest=$(latest_build)
  [ -n "$latest" ] || { failed maps "list of builds not readable ($BUILDS_URL)"; return 1; }

  running maps yes
  rm -f "$dest.new"
  log "maps: extracting the area from build $latest (box $MAP_BBOX, zoom up to $MAP_MAXZOOM)"
  nice -n 10 pmtiles extract "$TILES_URL$latest" "$dest.new" \
      --bbox="$MAP_BBOX" --maxzoom="$MAP_MAXZOOM" --download-threads=4 2>&1 \
    | tr '\r' '\n' | grep -vE '^[[:space:]]*$|%' | tail -n 12
  rc=${PIPESTATUS[0]}
  if [ "$rc" -ne 0 ] || [ ! -s "$dest.new" ]; then
    rm -f "$dest.new"; failed maps "extraction failed (code $rc)"; return 1
  fi
  if ! pmtiles verify "$dest.new" >/dev/null 2>&1; then
    rm -f "$dest.new"; failed maps "the extracted file does not pass verification: discarded"; return 1
  fi
  chmod 644 "$dest.new"
  mv -f "$dest.new" "$dest"
  echo "$latest" > "$MAPS/basemap.build"
  echo "$area" > "$MAPS/basemap.area"
  log "maps: installed ($(( $(stat -c %s "$dest") / 1048576 )) MB, build $latest)"
  result maps ok
}

do_estimate_maps() {   # $1 = box (west,south,east,north), MAP_BBOX if empty
  local latest box="${1:-$MAP_BBOX}"
  [[ $box =~ ^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$ ]] || { echo "not a box: $box (west,south,east,north)" >&2; return 2; }
  command -v pmtiles >/dev/null || { echo "pmtiles command not installed" >&2; return 1; }
  latest=$(latest_build)
  [ -n "$latest" ] || { echo "list of builds not readable" >&2; return 1; }
  echo "Latest build: $latest, box $box, zoom up to $MAP_MAXZOOM"
  pmtiles extract "$TILES_URL$latest" /dev/null \
      --bbox="$box" --maxzoom="$MAP_MAXZOOM" --dry-run 2>&1 | tr '\r' '\n' | grep -vE '^[[:space:]]*$' | tail -n 8
}

# --------------------------------------------------------------------------- Addresses
dump_md5() {      # the MD5 published next to the address dump
  curl -fsSL --max-time 60 "$ADDRESS_DUMP_URL.md5" | awk '{print $1}'
}

do_addresses() {
  local db="$SEARCH/addresses.db" dump="$SEARCH/dump.jsonl.zst" expected md5 rc needed same=yes
  local source="$ADDRESS_DUMP_URL $ADDRESS_LANGUAGES"
  if ! made_from "$SEARCH/addresses.source" "$db" "$source"; then
    same=no; log "addresses: the installed index comes from another dump, building the new one"
  elif [ -s "$db" ] && [ "$(age_days "$db")" -lt "$MIN_AGE_DAYS" ]; then
    log "addresses: the installed index is less than $MIN_AGE_DAYS days old, keeping it"; result addresses ok; return 0
  fi
  expected=$(dump_md5)
  [ ${#expected} -eq 32 ] || { failed addresses "MD5 checksum of the dump not readable"; return 1; }
  if [ "$same" = yes ] && [ -s "$db" ] && [ "$(cat "$SEARCH/addresses.md5" 2>/dev/null)" = "$expected" ]; then
    log "addresses: the published dump is the one already installed"; touch "$db"; result addresses ok; return 0
  fi

  running addresses yes
  # building takes about ten times the compressed dump in temporary files (Italy: 6 GB), at least 6 GB
  needed=$(( $(remote_size "$ADDRESS_DUMP_URL") * 10 / 1024 ))
  [ "$needed" -ge 6291456 ] || needed=6291456
  if [ "$(free_kb)" -lt "$needed" ]; then
    failed addresses "not enough space ($(( needed / 1048576 )) GB free needed while building)"; return 1
  fi
  # If an earlier attempt stopped after the download (for example because of a reboot), the dump
  # already downloaded and intact is reused without downloading it again.
  if [ -s "$dump" ] && [ "$(md5sum "$dump" | awk '{print $1}')" = "$expected" ]; then
    log "addresses: reusing the dump already downloaded"
  else
    rm -f "$dump"
    log "addresses: downloading the dump"
    if ! wget -c -nv --tries=20 --waitretry=30 --timeout=60 -O "$dump.part" "$ADDRESS_DUMP_URL"; then
      failed addresses "download interrupted, it will resume at the next update"; return 1
    fi
    md5=$(md5sum "$dump.part" | awk '{print $1}')
    if [ "$md5" != "$expected" ]; then
      rm -f "$dump.part"; failed addresses "MD5 checksum differs from the published one: dump discarded"; return 1
    fi
    mv -f "$dump.part" "$dump"
  fi

  log "addresses: building the index (on a Pi 3 this can take more than an hour)"
  rm -f "$db.new" "$db.new-journal"
  mkdir -p "$SEARCH/tmp"
  zstd -dc "$dump" | SQLITE_TMPDIR="$SEARCH/tmp" nice -n 15 python3 "$LIB/build-search-index.py" --out "$db.new" \
    --languages "$ADDRESS_LANGUAGES"
  rc=${PIPESTATUS[1]}
  rm -rf "$SEARCH/tmp"
  if [ "$rc" -ne 0 ] || [ ! -s "$db.new" ]; then
    rm -f "$db.new" "$db.new-journal"; failed addresses "building the index failed (code $rc)"; return 1
  fi
  if ! python3 "$LIB/build-search-index.py" --check "$db.new"; then
    rm -f "$db.new"; failed addresses "the new index does not answer the test search: discarded"; return 1
  fi
  python3 "$LIB/build-search-index.py" --date "$db.new" > "$SEARCH/addresses.date.new" 2>/dev/null || true
  chmod 644 "$db.new"
  mv -f "$db.new" "$db"
  mv -f "$SEARCH/addresses.date.new" "$SEARCH/addresses.date" 2>/dev/null || true
  echo "$expected" > "$SEARCH/addresses.md5"
  echo "$source" > "$SEARCH/addresses.source"
  rm -f "$dump"
  # as above: starts the first time too, unless the maps are switched off from the hub
  systemctl restart hub-search.service 2>/dev/null || true
  log "addresses: index installed ($(( $(stat -c %s "$db") / 1048576 )) MB)"
  result addresses ok
}

# --------------------------------------------------------------------------- New versions
# Once a day (hub-version-check.timer): the latest release on GitHub goes to state/latest.json, and the hub
# shows it when it is newer than the installed version. Offline: nothing changes, it tries again tomorrow.
do_check_version() {
  local latest="$STATE/latest.json"
  if [ "$CHECK_FOR_UPDATES" != yes ]; then
    rm -f "$latest"; write_status; log "new versions: not checked (CHECK_FOR_UPDATES=$CHECK_FOR_UPDATES)"; return 0
  fi
  if ! curl -fsSL --max-time 30 -H "Accept: application/vnd.github+json" -o "$latest.download" "$RELEASES_URL"; then
    rm -f "$latest.download"; log "new versions: GitHub not reachable, trying again tomorrow"; return 0
  fi
  STATE="$STATE" INSTALLED="$(cat "$LIB/VERSION" 2>/dev/null)" NOTIFY="$NOTIFY_NEW_VERSION" python3 - <<'PY'
import json, os, re, subprocess, time, urllib.request
state, installed, notify = os.environ["STATE"], os.environ["INSTALLED"].strip(), os.environ["NOTIFY"].strip()
def version(text):
    m = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", text or "")
    return tuple(map(int, m.groups())) if m else None
try:
    with open(f"{state}/latest.json.download", encoding="utf-8") as f:
        release = json.load(f)
except (OSError, ValueError):
    raise SystemExit("new versions: the answer of GitHub is not readable")
tag = str(release.get("tag_name", ""))
if release.get("prerelease") or release.get("draft") or not version(tag):
    raise SystemExit(f"new versions: {tag!r} is not a release, ignored")
latest = {"version": tag.lstrip("v"), "url": str(release.get("html_url", "")),
          "published": str(release.get("published_at", "")), "notes": str(release.get("body") or "")[:20000],
          "checked": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
with open(f"{state}/latest.json.tmp", "w", encoding="utf-8") as f:
    json.dump(latest, f, ensure_ascii=False)
os.chmod(f"{state}/latest.json.tmp", 0o644)
os.replace(f"{state}/latest.json.tmp", f"{state}/latest.json")
newer = version(installed) is not None and version(latest["version"]) > version(installed)
print(f"new versions: latest {latest['version']}, installed {installed or 'unknown'}"
      + (": a newer version is available" if newer else ""))
# One message per new version, and only if it was asked for in /etc/hub.conf (NOTIFY_NEW_VERSION).
marker = f"{state}/latest.notified"
try:
    notified = open(marker, encoding="utf-8").read().strip()
except OSError:
    notified = ""
if newer and notify and notified != latest["version"]:
    text = f"raspberry-hub {latest['version']} is available (installed: {installed}). {latest['url']}"
    try:
        if notify == "netmon":
            subprocess.run(["/usr/local/bin/netmon", "notify", text], timeout=60, check=True, capture_output=True)
        elif notify.startswith("https://"):
            request = urllib.request.Request(notify, data=text.encode("utf-8"), method="POST",
                                             headers={"Title": "raspberry-hub", "Click": latest["url"]})
            urllib.request.urlopen(request, timeout=30).close()
        else:
            raise ValueError(f"NOTIFY_NEW_VERSION={notify!r} is neither netmon nor an https:// address")
        with open(marker, "w", encoding="utf-8") as f:
            f.write(latest["version"] + "\n")
        print("new versions: message sent")
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"new versions: the message could not be sent ({error})")
PY
  rm -f "$latest.download"
  write_status
}

# --------------------------------------------------------------------------- start
# Sourced by .github/scripts/check-sources.sh for the settings and functions above: nothing below runs then.
if [ "${BASH_SOURCE[0]}" != "$0" ]; then return 0; fi

WHAT="${1:-all}"
# Italian names from version 1.x: pi-setup's monthly-update.sh may still call "hub-update.sh tutto".
case "$WHAT" in
  tutto) WHAT=all ;; mappe) WHAT=maps ;; indirizzi) WHAT=addresses ;; stato) WHAT=status ;; stima-mappe) WHAT=estimate-maps ;;
esac
case "$WHAT" in
  all|wiki|maps|addresses|status|estimate-maps|check-version) ;;
  *) echo "Usage: sudo hub-update.sh [all|wiki|maps|addresses|estimate-maps|status|check-version]" >&2; exit 2 ;;
esac
[ "$(id -u)" -eq 0 ] || { echo "Run it with sudo." >&2; exit 1; }
mkdir -p "$ZIM" "$MAPS" "$SEARCH" "$STATE"

if [ "$WHAT" = estimate-maps ]; then do_estimate_maps "${2:-}"; exit $?; fi
if [ "$WHAT" = status ]; then write_status; exit 0; fi
if [ "$WHAT" = check-version ]; then do_check_version; exit 0; fi

# Only one update per content at a time (wiki, maps and addresses can run together).
lock() { exec {fd}>"/run/hub-update-$1.lock"; flock -n "$fd"; }
rc=0
for part in wiki maps addresses; do
  [ "$WHAT" = all ] || [ "$WHAT" = "$part" ] || continue
  if ! lock "$part"; then log "$part: another update is already running, skipping"; continue; fi
  log "===== $part: start"
  "do_$part" || rc=1
  running "$part" no
done
log "===== end (result: $([ $rc -eq 0 ] && echo ok || echo 'with errors'))"
exit $rc
