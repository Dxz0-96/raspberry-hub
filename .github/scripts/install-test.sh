#!/bin/bash
# Installs the hub with the real hub-install.sh in a Debian container with systemd (.github/docker/debian-systemd)
# and checks the result: what a Raspberry Pi gets, minus Pi-hole (so no "enable" step) and minus vcgencmd.
# Run by .github/workflows/install.yml, as root inside the container, with the repository on /repo:
#
#   bash /repo/.github/scripts/install-test.sh fresh      a clean system
#   bash /repo/.github/scripts/install-test.sh from-1x    an installation of raspberry-hub 1.x, upgraded
#
# Both run prepare and site twice: the second time must change nothing.
set -euo pipefail
SCENARIO="${1:?usage: install-test.sh fresh|from-1x}"
HUB=/home/pi/pi-setup/hub
group() { echo "::group::$*"; }
end() { echo "::endgroup::"; }
fail() { echo "::error::$*"; exit 1; }
install_step() { ADMIN_USER=pi bash "$HUB/hub-install.sh" "$@"; }
json() { python3 -c "import json, sys; print(json.load(sys.stdin)$1)"; }
# the files the installer writes: a second run must leave them as they are
snapshot() {
  find /etc/hub.conf /etc/hub-control /srv/hub/config /srv/hub/icons /usr/local/lib/raspberry-hub \
       /usr/local/sbin /etc/systemd/system /etc/polkit-1/rules.d /etc/caddy/services -maxdepth 1 -type f \
       \( -path '*hub*' -o -path '*kiwix*' -o -path '/etc/caddy/services/*' \) -print0 2>/dev/null \
    | sort -z | xargs -0 sha256sum
}

group "The package, as deploy.ps1 -Update copies it to the Raspberry Pi"
mkdir -p "$HUB"
cp -a /repo/pi/. "$HUB/"
rm -rf "$HUB/tests" "$HUB/__pycache__" "$HUB/site.tar.gz"
site=$(mktemp -d)
printf '<!doctype html><title>raspberry</title>\n' > "$site/index.html"
tar -czf "$HUB/site.tar.gz" -C "$site" .
chown -R pi:pi /home/pi/pi-setup
end

if [ "$SCENARIO" = from-1x ]; then
  group "A raspberry-hub 1.x installation"
  python3 /repo/.github/scripts/fixture-1x.py
  end
fi

group "hub-install.sh prepare and site"
install_step prepare
install_step site
end

group "The same again: nothing to change"
snapshot > /tmp/before
install_step prepare | tee /tmp/second.log
install_step site
grep -q "nothing to migrate" /tmp/second.log || fail "the second run migrated something"
snapshot > /tmp/after
diff /tmp/before /tmp/after || fail "the second run changed installed files (above)"
echo "no-op: $(wc -l < /tmp/after) installed files unchanged"
end

group "Services and answers"
systemctl is-active --quiet hub-control || { journalctl -u hub-control -n 40 --no-pager; fail "hub-control is not running"; }
version=$(sed -n 's/^HUB_VERSION=\([0-9.]*\).*/\1/p' "$HUB/hub-install.sh")
status=""
for _ in $(seq 1 20); do status=$(curl -sf http://127.0.0.1:8083/control/status || true); [ -n "$status" ] && break; sleep 1; done
[ "$(json '["version"]' <<< "$status")" = "$version" ] || fail "/control/status does not report $version: $status"
sleep 6                                     # the monitor samples every 5 seconds
curl -sf http://127.0.0.1:8083/control/system \
  | python3 -c 'import json, sys; d = json.load(sys.stdin); assert d["cpu"]["count"] >= 1; print("hardware monitor:", d["model"], "/", d["disk"]["medium"], "/ power", d["power"])'
curl -sf http://127.0.0.1:8083/control/system/history | json '["recent"]["step"]' > /dev/null
curl -sf http://127.0.0.1:8083/control/upgrade | json '["installed"]' | grep -qx "$version" || fail "/control/upgrade"
for unit in hub-control.service kiwix-hub.service hub-search.service hub-check.service hub-version-check.timer \
            hub-update.timer hub-cert.timer; do
  systemctl is-enabled --quiet "$unit" || fail "$unit is not enabled"
done
# no pi-setup package here: the backup of the hub settings is the hub's own
ADMIN_USER=pi hub-install.sh backup /tmp/hub-backup.tar.gz > /dev/null
# the listing in a file: "tar | grep -q" fails under pipefail when grep stops early and tar gets SIGPIPE
tar -tzf /tmp/hub-backup.tar.gz > /tmp/hub-backup.list
grep -qx 'etc/hub.conf' /tmp/hub-backup.list || fail "the backup has no etc/hub.conf"
grep -q '^var/lib/hub-control/' /tmp/hub-backup.list || fail "the backup has no switch states"
[ "$(stat -c '%U %a' /tmp/hub-backup.tar.gz)" = "pi 600" ] || fail "the backup is not private to pi"
rm -f /tmp/hub-backup.tar.gz /tmp/hub-backup.list
# the same version installed twice replaced nothing: there is no previous version to go back to, and it says so
if hub-install.sh rollback --yes 2> /tmp/rollback.err; then fail "rollback went ahead without a kept version"; fi
grep -q "no previous version" /tmp/rollback.err || fail "rollback did not say why: $(cat /tmp/rollback.err)"
[ -f /srv/hub/site/index.html ] && [ "$(stat -c %U /srv/hub/site)" = pi ] || fail "the website is not installed for pi"
[ -s /srv/hub/status.json ] || fail "no /srv/hub/status.json"
grep -q '^CHECK_FOR_UPDATES=' /etc/hub.conf && grep -q '^WATCHDOG=no' /etc/hub.conf || fail "/etc/hub.conf lacks the new settings"
grep -q 'hub-upgrade@' /etc/polkit-1/rules.d/50-hub-control.rules || fail "the polkit rule does not allow the update button"
[ "$(command -v hub-install.sh)" = /usr/local/sbin/hub-install.sh ] || fail "hub-install.sh is not in /usr/local/sbin"
# Pi-hole, Caddy and the certificate are not set up here: only the checks of the hub itself must pass
hub-check.sh --report /run/hub-check.json || true
python3 - <<'PY'
import json
report = json.load(open("/run/hub-check.json"))
own = [f for f in report["failures"] if f.startswith(("hub-control", "kiwix-hub starts", "hub-search starts"))]
assert not own, f"checks of the hub failed: {own}"
print(f"hub-check.sh: {report['passed']} passed, {report['failed']} failed outside the hub (no Pi-hole here), "
      f"{report['skipped']} skipped")
PY
end

group "The Caddyfile is valid for the Caddy of this Debian"
# as hub-install.sh enable writes it, with a throwaway certificate in place of the one of the home CA
apt-get install -y -qq --no-install-recommends openssl > /dev/null
made_cert=no
if [ ! -e /etc/caddy/certs/tls.pem ]; then
  install -d /etc/caddy/certs
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1 -subj /CN=raspberry \
    -keyout /tmp/test-key.pem -out /tmp/test-cert.pem 2> /dev/null
  cat /tmp/test-cert.pem /tmp/test-key.pem > /etc/caddy/certs/tls.pem
  made_cert=yes
fi
sed 's/@RASPBERRY_IP@/192.0.2.10/g' "$HUB/Caddyfile" > /etc/caddy/Caddyfile.test
caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile.test || fail "the Caddyfile does not validate"
rm -f /etc/caddy/Caddyfile.test
if [ "$made_cert" = yes ]; then rm -rf /etc/caddy/certs /tmp/test-key.pem /tmp/test-cert.pem; fi
end

if [ "$SCENARIO" = from-1x ]; then
  group "raspberry-hub 1.x converted"
  json '["services"][1]["requires"]' < /srv/hub/config/services.json | grep -qx /srv/hub/maps/basemap.pmtiles \
    || fail "services.json not converted"
  grep -q '^WIKI_VARIANT=nopic' /etc/hub.conf && grep -q '^MAP_MAXZOOM=14' /etc/hub.conf || fail "hub.conf values lost"
  [ -f /etc/hub.conf.1x ] || fail "the 1.x hub.conf was not kept"
  [ -f /srv/hub/icons/0123456789abcdef.png ] && [ ! -e /srv/hub/icone ] || fail "icons not moved"
  [ -f /var/lib/hub-control/maps.off ] || fail "the switch state of the maps was lost"
  [ ! -e /usr/local/sbin/hub-servizio ] || fail "the 1.x command is still there"
  json '["username"]' < /etc/hub-control/credentials.json | grep -qx admin || fail "credentials not converted"
  [ "$(python3 -c 'import sqlite3; print(sqlite3.connect("/srv/hub/search/addresses.db").execute("SELECT value FROM meta WHERE key = '"'schema'"'").fetchone()[0])')" = 3 ] \
    || fail "the address index was not converted to schema 3"
  echo "files, settings, switch states, credentials and the address index converted"
  end
fi
echo "Installation on $(. /etc/os-release && echo "$PRETTY_NAME") ($(dpkg --print-architecture)): ok"
