#!/bin/bash
# Checks that raspberry-hub and the Raspberry Pi services are all up.
# Meant to run after a reboot: verifies that everything came back by itself.
#
#   sudo hub-check.sh          runs the checks and prints the result
#   sudo hub-check.sh --wait   first waits up to 3 minutes for the services to finish starting
#   sudo hub-check.sh --report /run/hub-check.json
#                              also writes the result as JSON, for the hub (hub-check.service does it after
#                              every boot; /run is in memory, so nothing is written to the SD card)
#
# Exits with 0 if every check passes. Services switched off from the hub do not count as errors, and neither
# do the parts of the pi-setup package when it is not installed.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C.UTF-8
CA=/etc/caddy/public/ca.crt          # public copy of the home CA (the same as http://raspberry/ca.crt)
PASSED=0; FAILED=0; SKIPPED=0; FAILURES=()
WAIT=no; REPORT=
while [ $# -gt 0 ]; do
  case "$1" in
    --wait) WAIT=yes ;;
    --report) REPORT="${2:?--report needs a file name}"; shift ;;
    *) echo "Usage: sudo hub-check.sh [--wait] [--report FILE]" >&2; exit 2 ;;
  esac
  shift
done
C() { curl -s --max-time 10 --cacert "$CA" --resolve raspberry:443:127.0.0.1 --resolve raspberry:80:127.0.0.1 "$@"; }
status_code() { C -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }
check() {   # $1 = description, the rest = command that must succeed
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then PASSED=$((PASSED + 1)); printf '  [ ok ]  %s\n' "$name"
  else FAILED=$((FAILED + 1)); FAILURES+=("$name"); printf '  [FAIL]  %s\n' "$name"; fi
}
skipped() { SKIPPED=$((SKIPPED + 1)); printf '  [ -- ]  %s\n' "$1"; }
active() { systemctl is-active --quiet "$1"; }
at_boot() { systemctl is-enabled --quiet "$1"; }
answers() { [ "$(status_code "$2")" = "$1" ]; }

if [ "$WAIT" = yes ]; then
  for _ in $(seq 1 36); do
    active caddy && active pihole-FTL && active hub-control && [ "$(status_code https://raspberry/control/status)" = 200 ] && break
    sleep 5
  done
fi

echo "raspberry-hub $(cat /usr/local/lib/raspberry-hub/VERSION 2>/dev/null || echo "(version unknown: run hub-install.sh)")"
echo "Raspberry Pi up for: $(uptime -p | sed 's/^up //')"
echo "Services"
for u in pihole-FTL unbound caddy hub-control; do
  check "$u running" active "$u"
  check "$u starts at boot" at_boot "$u"
done
check "hub-cert-sync.path watching for certificate renewals" active hub-cert-sync.path
for triple in kiwix-hub:wikipedia:/srv/hub/zim/wikipedia_it.zim hub-search:maps:/srv/hub/search/addresses.db; do
  IFS=: read -r u name needs <<<"$triple"
  check "$u starts at boot" at_boot "$u"
  if [ -e "/var/lib/hub-control/$name.off" ]; then skipped "$u switched off from the hub (stays off: correct)"
  elif [ ! -e "$needs" ]; then skipped "$u waiting for its content, not downloaded yet"
  else check "$u running" active "$u"; fi
done

echo "DNS"
check "Pi-hole resolves names" test -n "$(dig +short +time=3 +tries=1 www.debian.org @127.0.0.1 | tail -1)"
if [ "$(pihole-FTL --config dns.blocking.active 2>/dev/null)" = true ]; then
  check "ads are blocked" test "$(dig +short +time=3 +tries=1 doubleclick.net @127.0.0.1 | tail -1)" = 0.0.0.0
else skipped "ad blocking paused from the hub"; fi
check "Unbound answers" test -n "$(dig +short +time=3 +tries=1 -p 5335 www.wikipedia.org @127.0.0.1 | tail -1)"

echo "Hub over HTTPS (home CA certificate verified)"
check "http://raspberry redirects to https" answers 308 http://raspberry/
check "hub home page" answers 200 https://raspberry/
check "maps page" answers 200 https://raspberry/maps/
check "list of services" answers 200 https://raspberry/services.json
check "content status" answers 200 https://raspberry/status.json
check "service status (hub-control)" answers 200 https://raspberry/control/status
check "hardware monitor" test -n "$(C https://raspberry/control/system | python3 -c 'import sys,json; print(json.load(sys.stdin)["cpu"]["count"])' 2>/dev/null)"
check "Pi-hole dashboard behind Caddy" test "$(status_code https://raspberry/admin/login)" = 200
# the network monitor and the schedules below come from the pi-setup package, when it is installed
PISETUP=no; [ -e /usr/local/sbin/monthly-update.sh ] && PISETUP=yes
if [ "$PISETUP" = yes ]; then check "network monitor page" answers 200 https://raspberry/netmon/
else skipped "network monitor page (pi-setup package not installed)"; fi
check "certificate also valid for pi.hole" test "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --cacert "$CA" --resolve pi.hole:443:127.0.0.1 https://pi.hole/admin/login)" = 200
check "home CA downloadable" answers 200 http://raspberry/ca.crt
check "switches refuse visitors who are not logged in" test "$(status_code -X POST -H 'X-Hub: 1' -H 'Content-Type: application/json' -d '{"on":false}' https://raspberry/control/services/wikipedia/switch)" = 401

echo "Content"
if [ -e /var/lib/hub-control/wikipedia.off ]; then skipped "Wikipedia switched off from the hub"
elif [ ! -e /srv/hub/zim/wikipedia_it.zim ]; then skipped "Wikipedia not downloaded yet"
else check "Wikipedia answers" answers 200 https://raspberry/wiki/; fi
if [ -e /var/lib/hub-control/maps.off ]; then skipped "maps switched off from the hub"
else
  if [ -s /srv/hub/maps/basemap.pmtiles ]; then
    check "maps readable in pieces (range request)" test "$(status_code -r 0-1023 https://raspberry/tiles/basemap.pmtiles)" = 206
  else skipped "maps not downloaded yet"; fi
  if [ -s /srv/hub/search/addresses.db ]; then
    check "address search" test "$(C 'https://raspberry/search?q=roma' | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["results"]))' 2>/dev/null || echo 0)" -gt 0
  else skipped "address index not built yet"; fi
fi

echo "Schedules"
if [ "$PISETUP" = yes ]; then
  check "monthly update scheduled" test -s /etc/cron.d/monthly-update
  check "the monthly update includes the hub content" grep -q hub-update.sh /usr/local/sbin/monthly-update.sh
  check "weekly certificate check scheduled" test -s /etc/cron.d/pihole-cert
  check "network monitor active" active netmon.timer
else skipped "monthly update, certificate check and network monitor (pi-setup package not installed)"; fi
if grep -q '^CHECK_FOR_UPDATES=no' /etc/hub.conf 2>/dev/null; then skipped "daily check for new versions switched off"
else check "daily check for new versions scheduled" active hub-version-check.timer; fi

echo
echo "Result: $PASSED checks passed, $FAILED failed, $SKIPPED skipped."
if [ -n "$REPORT" ]; then
  printf '%s\n' "${FAILURES[@]}" | PASSED=$PASSED FAILED=$FAILED SKIPPED=$SKIPPED REPORT="$REPORT" python3 -c '
import json, os, sys, time
failures = [line for line in sys.stdin.read().splitlines() if line]
data = {"time": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "passed": int(os.environ["PASSED"]),
        "failed": int(os.environ["FAILED"]), "skipped": int(os.environ["SKIPPED"]), "failures": failures}
with open(os.environ["REPORT"] + ".tmp", "w", encoding="utf-8") as f:
    json.dump(data, f)
os.chmod(os.environ["REPORT"] + ".tmp", 0o644)
os.replace(os.environ["REPORT"] + ".tmp", os.environ["REPORT"])'
fi
[ "$FAILED" -eq 0 ]
