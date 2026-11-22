#!/bin/bash
# Installs raspberry-hub on the Raspberry Pi: Caddy, offline Wikipedia, maps with address search,
# service switches and hardware monitor. Run it with sudo from the folder that holds these files
# (normally ~/pi-setup/hub). Safe to run again; running it again is also how you upgrade.
#
#   sudo bash hub-install.sh prepare   packages, users, folders, scripts and local services
#                                      (does not touch Pi-hole or ports 80 and 443)
#   sudo bash hub-install.sh site      installs the hub website from site.tar.gz
#   sudo bash hub-install.sh enable    home certificate (from the pi-setup package if it is there, otherwise
#                                      a home CA of the hub: hub-cert), Caddy on ports 80/443,
#                                      Pi-hole web interface moved to 127.0.0.1:8080
#   sudo bash hub-install.sh monthly   with pi-setup: adds the hub settings to its backup (the monthly content
#                                      update is hub-update.timer, with or without it)
#   sudo hub-install.sh backup [FILE]  saves the hub settings to a tarball (hub-backup-YYYY-MM-DD.tar.gz)
#   sudo bash hub-install.sh disable   rolls back: Pi-hole on 80/443 again, Caddy stopped
#   sudo bash hub-install.sh           prepare + site + enable + monthly
#
#   sudo bash hub-install.sh watchdog  applies WATCHDOG from /etc/hub.conf (hardware watchdog on or off)
#   sudo hub-install.sh configure [--country XX] [--wiki-language xx] [--wiki-variant maxi|nopic|mini]
#                                      chooses the country of the map and of the address search, and the
#                                      Wikipedia edition (see hub-configure.py; a new installation asks them once,
#                                      at a terminal; MAP_COUNTRY, WIKI_LANGUAGE and WIKI_VARIANT in the environment
#                                      answer in advance)
#   sudo hub-install.sh rollback [--yes]
#                                      goes back to the version kept before the last upgrade (hub-rollback.py)
#   sudo hub-install.sh upgrade [X.Y.Z] [--yes]
#                                      downloads a release package from GitHub, checks it and installs it
#                                      (the latest release unless a version is given; see hub-upgrade.py)
#
# After the first installation a copy lives in /usr/local/sbin, so "sudo hub-install.sh upgrade" works from
# anywhere; the other steps then use the package in ~/pi-setup/hub.
set -e
export DEBIAN_FRONTEND=noninteractive
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
[ "$(id -u)" -eq 0 ] || { echo "Run it with sudo." >&2; exit 1; }
WHAT="${1:-all}"
# the user who owns the website (/srv/hub/site) and updates it with deploy.ps1: whoever ran sudo, or the
# owner of the website already installed (an upgrade started by the hub runs as root, without sudo)
ADMIN="${ADMIN_USER:-${SUDO_USER:-$(stat -c %U /srv/hub/site 2>/dev/null || true)}}"
[ -n "$ADMIN" ] && [ "$ADMIN" != root ] || { echo "Run it with sudo from your own user, or set ADMIN_USER=name" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
# the copy in /usr/local/sbin has no package next to it: use the one in ~/pi-setup/hub
[ -f "$HERE/hub-control.py" ] || HERE="$(getent passwd "$ADMIN" | cut -d: -f6)/pi-setup/hub"
PISETUP="$(dirname "$HERE")"                      # the pi-setup package (install.sh, pihole-cert.sh, ...)
# the address of the Raspberry Pi on the home network: the first one of the main interface, unless given
PI="${PI_IP:-$(hostname -I | awk '{print $1}')}"
LIB=/usr/local/lib/raspberry-hub
HUB_VERSION=2.1.0   # x-release-please-version (updated by release-please, do not edit by hand)
PIHOLE_PORT="127.0.0.1:8080"
OFF_AT_FIRST_INSTALL="${OFF_AT_FIRST_INSTALL-wikipedia maps}"   # services that start switched off on a new install
PMTILES_VERSION=1.31.2
PMTILES_SHA256=f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1   # Linux arm64
PMTILES_URL="https://github.com/protomaps/go-pmtiles/releases/download/v$PMTILES_VERSION/go-pmtiles_${PMTILES_VERSION}_Linux_arm64.tar.gz"

ftl_ready() {      # waits until the Pi-hole web interface and DNS answer; $1 = host:port of the web interface
  local code
  for _ in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://$1/api/auth" 2>/dev/null || true)
    if { [ "$code" = 200 ] || [ "$code" = 401 ]; } && [ -n "$(dig +short +time=2 +tries=1 www.debian.org @127.0.0.1 2>/dev/null | tail -1)" ]; then
      return 0
    fi
    sleep 3
  done
  return 1
}

do_prepare() {
  echo "== Packages"
  # Caddy must not start by itself during the installation: ports 80/443 still belong to Pi-hole.
  printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d; chmod 755 /usr/sbin/policy-rc.d
  trap 'rm -f /usr/sbin/policy-rc.d' EXIT
  apt-get update -qq
  apt-get install -y -qq caddy kiwix-tools zstd curl wget python3 >/dev/null
  rm -f /usr/sbin/policy-rc.d; trap - EXIT
  systemctl is-active --quiet caddy || systemctl disable caddy >/dev/null 2>&1 || true
  echo "   caddy $(caddy version | awk '{print $1}'), kiwix-serve $(kiwix-serve --version 2>&1 | awk 'NR==1 {print $2}')"

  echo "== pmtiles (map extraction)"
  if [ "$(pmtiles version 2>/dev/null | awk 'NR==1 {print $NF}')" = "$PMTILES_VERSION" ] || pmtiles version 2>/dev/null | grep -q "$PMTILES_VERSION"; then
    echo "   already installed ($PMTILES_VERSION)"
  else
    [ "$(dpkg --print-architecture)" = arm64 ] || { echo "   ERROR: only arm64 is supported" >&2; exit 1; }
    tmp=$(mktemp -d)
    curl -fsSL --max-time 300 -o "$tmp/pmtiles.tar.gz" "$PMTILES_URL"
    echo "$PMTILES_SHA256  $tmp/pmtiles.tar.gz" | sha256sum -c --quiet - \
      || { rm -rf "$tmp"; echo "   ERROR: the file checksum does not match the expected one, not installing" >&2; exit 1; }
    tar -xzf "$tmp/pmtiles.tar.gz" -C "$tmp" pmtiles
    install -o root -g root -m 755 "$tmp/pmtiles" /usr/local/bin/pmtiles
    rm -rf "$tmp"
    echo "   installed to /usr/local/bin/pmtiles"
  fi

  echo "== The version being replaced"
  # kept before anything of it changes, to go back to it: sudo hub-install.sh rollback
  python3 "$HERE/hub-rollback.py" snapshot "$HUB_VERSION"

  echo "== Upgrade from earlier versions"
  systemctl stop hub-control.service hub-search.service 2>/dev/null || true
  HUB_PISETUP="$PISETUP" python3 "$HERE/hub-migrate.py"

  echo "== User and folders"
  id hubctl >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin hubctl
  for g in pihole video; do getent group "$g" >/dev/null && usermod -aG "$g" hubctl; done
  install -d -o root -g root -m 755 /srv/hub /srv/hub/zim /srv/hub/maps /srv/hub/search /srv/hub/state "$LIB"
  install -d -o "$ADMIN" -g "$ADMIN" -m 755 /srv/hub/site
  install -d -o hubctl -g hubctl -m 775 /srv/hub/config /srv/hub/icons
  install -d -o hubctl -g hubctl -m 755 /var/lib/hub-control
  install -d -o root -g hubctl -m 770 /etc/hub-control
  # Initial state: Wikipedia and maps start switched off and are turned on from the hub when needed.
  # Only on the first installation: after that the hub switch decides (and the choice survives reboots).
  if [ ! -e /var/lib/hub-control/.initial-state ]; then
    for s in $OFF_AT_FIRST_INSTALL; do
      install -o hubctl -g hubctl -m 644 /dev/null "/var/lib/hub-control/$s.off"
    done
    install -o hubctl -g hubctl -m 644 /dev/null /var/lib/hub-control/.initial-state
    echo "   initial state: switched off: ${OFF_AT_FIRST_INSTALL:-none}"
  fi
  install -d -o root -g root -m 755 /etc/caddy/services
  [ -e /etc/caddy/services/000-empty.caddy ] || echo "# Services hooked in with hub-service end up in this folder." > /etc/caddy/services/000-empty.caddy

  echo "== Scripts"
  for f in hub-search.py hub-control.py build-search-index.py hub-upgrade.py hub-configure.py hub-rollback.py; do install -o root -g root -m 755 "$HERE/$f" "$LIB/$f"; done
  install -o root -g root -m 644 "$HERE/countries.json" "$LIB/countries.json"
  install -o root -g root -m 755 "$HERE/kiwix-start" "$LIB/kiwix-start"
  # the hub compares it with the version of the website and suggests an update when they differ
  printf '%s\n' "$HUB_VERSION" > "$LIB/VERSION"; chmod 644 "$LIB/VERSION"
  echo "   raspberry-hub $HUB_VERSION"
  for f in hub-update.sh hub-control-setpass hub-service hub-cert-sync hub-cert hub-check.sh hub-install.sh; do
    install -o root -g root -m 755 "$HERE/$f" "/usr/local/sbin/$f"
  done
  for f in "$LIB"/*.py /usr/local/sbin/hub-control-setpass /usr/local/sbin/hub-service; do python3 -m py_compile "$f"; done
  rm -rf "$LIB/__pycache__" /usr/local/sbin/__pycache__
  for f in /usr/local/sbin/hub-update.sh /usr/local/sbin/hub-cert-sync /usr/local/sbin/hub-cert /usr/local/sbin/hub-check.sh \
           /usr/local/sbin/hub-install.sh "$LIB/kiwix-start"; do bash -n "$f"; done
  if [ ! -f /etc/hub.conf ]; then
    install -o root -g root -m 644 "$HERE/hub.conf" /etc/hub.conf
    # a new installation: which country and which Wikipedia to download, asked before anything is downloaded
    python3 "$LIB/hub-configure.py" --first-install ${MAP_COUNTRY:+--country "$MAP_COUNTRY"} \
      ${WIKI_LANGUAGE:+--wiki-language "$WIKI_LANGUAGE"} ${WIKI_VARIANT:+--wiki-variant "$WIKI_VARIANT"}
  fi
  [ -f /srv/hub/config/services.json ] || install -o hubctl -g hubctl -m 664 "$HERE/services.json" /srv/hub/config/services.json
  for f in "$HERE"/icons/*; do
    [ -e "/srv/hub/icons/$(basename "$f")" ] || install -o hubctl -g hubctl -m 644 "$f" "/srv/hub/icons/$(basename "$f")"
  done
  [ -f /etc/hub-control/allowed-units ] || printf '%s\n' kiwix-hub.service hub-search.service > /etc/hub-control/allowed-units
  /usr/local/sbin/hub-service rule
  echo "   polkit rule: hubctl may start and stop only $(grep -v '^#' /etc/hub-control/allowed-units | paste -sd' ' -)"

  echo "== Services"
  for u in kiwix-hub.service hub-search.service hub-control.service hub-cert-sync.path hub-cert-sync.service \
           hub-version-check.service hub-version-check.timer hub-upgrade@.service hub-check.service \
           hub-update.service hub-update.timer hub-cert.service hub-cert.timer hub-rollback.service; do
    install -o root -g root -m 644 "$HERE/units/$u" "/etc/systemd/system/$u"
  done
  systemctl daemon-reload
  systemctl enable kiwix-hub.service hub-search.service hub-control.service >/dev/null 2>&1
  # after every boot: did everything come back? The result is in /run/hub-check.json, and in the hub
  systemctl enable hub-check.service >/dev/null 2>&1
  # once a day: is there a newer release? (CHECK_FOR_UPDATES=no in /etc/hub.conf turns it off)
  systemctl enable --now hub-version-check.timer >/dev/null 2>&1
  # the 1st of the month: new Wikipedia edition, maps and addresses. Never twice: if pi-setup's monthly-update.sh
  # was edited by hand to call hub-update.sh (the block the hub wrote there is gone, see hub-migrate.py), it stays.
  if grep -qs 'hub-update\.sh' /usr/local/sbin/monthly-update.sh; then
    systemctl disable --now hub-update.timer >/dev/null 2>&1 || true
    echo "   monthly content update: /usr/local/sbin/monthly-update.sh calls hub-update.sh itself, hub-update.timer stays off"
  else
    systemctl enable --now hub-update.timer >/dev/null 2>&1
  fi
  # every week: renews the certificate of the home CA of the hub (does nothing with pi-setup's CA)
  systemctl enable --now hub-cert.timer >/dev/null 2>&1
  systemctl restart hub-control.service
  systemctl start kiwix-hub.service hub-search.service 2>/dev/null || true   # they start only if the content is there
  /usr/local/sbin/hub-update.sh status
  systemctl start --no-block hub-version-check.service 2>/dev/null || true
  echo "   hub-control running; Wikipedia and search start as soon as their content is downloaded"
  do_watchdog
}

do_watchdog() {
  echo "== Hardware watchdog"
  local conf=/etc/systemd/system.conf.d/hub-watchdog.conf
  local wanted='[Manager]
# raspberry-hub (WATCHDOG=yes in /etc/hub.conf): a Raspberry Pi that hangs reboots by itself.
# The watchdog of the Pi allows at most about 15 seconds.
RuntimeWatchdogSec=14s'
  if [ "$(sed -n 's/^WATCHDOG=//p' /etc/hub.conf 2>/dev/null | tail -n 1)" = yes ]; then
    if [ ! -e /dev/watchdog ] && [ ! -e /dev/watchdog0 ]; then
      echo "   WARNING: this system has no watchdog device (/dev/watchdog): left off"; return 0
    fi
    if [ "$(cat "$conf" 2>/dev/null)" = "$wanted" ]; then echo "   on"; return 0; fi
    install -d -m 755 /etc/systemd/system.conf.d
    printf '%s\n' "$wanted" > "$conf"
    systemctl daemon-reexec
    echo "   on: a Raspberry Pi that hangs reboots by itself after about 14 seconds"
  elif [ -e "$conf" ]; then
    rm -f "$conf"
    systemctl daemon-reexec
    echo "   off"
  else
    echo "   off (WATCHDOG=yes in /etc/hub.conf, then sudo hub-install.sh watchdog, to turn it on)"
  fi
}

do_site() {
  echo "== Hub website"
  [ -f "$HERE/site.tar.gz" ] || { echo "   site.tar.gz not found: skipping (it is installed from the PC with deploy.ps1)"; return 0; }
  rm -rf /srv/hub/site.new; install -d -o "$ADMIN" -g "$ADMIN" -m 755 /srv/hub/site.new
  tar -xzf "$HERE/site.tar.gz" -C /srv/hub/site.new --no-same-owner
  [ -f /srv/hub/site.new/index.html ] || { rm -rf /srv/hub/site.new; echo "   ERROR: the archive does not contain index.html" >&2; exit 1; }
  chown -R "$ADMIN:$ADMIN" /srv/hub/site.new; chmod -R u=rwX,go=rX /srv/hub/site.new
  rm -rf /srv/hub/site.old; mv /srv/hub/site /srv/hub/site.old; mv /srv/hub/site.new /srv/hub/site
  rm -rf /srv/hub/site.old
  echo "   installed to /srv/hub/site"
}

do_enable() {
  echo "== Home HTTPS certificate"
  if [ -x /usr/local/sbin/pihole-cert.sh ] || [ -f "$PISETUP/install.sh" ]; then
    # the pi-setup package: its home CA (pihole-cert.sh), as before
    if [ ! -s /etc/pihole-ca/ca.crt ] || [ ! -x /usr/local/sbin/pihole-cert.sh ]; then
      echo "   creating the home CA with install.sh homeca (Pi-hole restarts: DNS stops for a few seconds)"
      bash "$PISETUP/install.sh" homeca | sed 's/^/   /'
    fi
    [ -s /etc/pihole-ca/ca.crt ] || { echo "   ERROR: the home CA was not created" >&2; exit 1; }
    openssl verify -CAfile /etc/pihole-ca/ca.crt <(openssl x509 -in /etc/pihole/tls.pem) >/dev/null 2>&1 \
      || { echo "   ERROR: /etc/pihole/tls.pem is not signed by the home CA (try: sudo pihole-cert.sh renew)" >&2; exit 1; }
  else
    # without pi-setup: the home CA of the hub, renewed every week by hub-cert.timer
    PI_IP="$PI" /usr/local/sbin/hub-cert ensure | sed 's/^/   /'
  fi
  /usr/local/sbin/hub-cert-sync
  systemctl enable --now hub-cert-sync.path >/dev/null 2>&1
  echo "   certificate valid until $(openssl x509 -in /etc/caddy/certs/tls.pem -noout -enddate | cut -d= -f2)"

  echo "== Caddy"
  # "Hub di casa" marks the Caddyfile written by raspberry-hub 1.x
  if [ -f /etc/caddy/Caddyfile ] && ! grep -q -e "raspberry-hub" -e "Hub di casa" /etc/caddy/Caddyfile \
     && [ ! -f /etc/caddy/Caddyfile.orig ]; then
    cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.orig
  fi
  install -o root -g root -m 644 "$HERE/Caddyfile" /etc/caddy/Caddyfile.new
  sed -i "s/@RASPBERRY_IP@/$PI/g" /etc/caddy/Caddyfile.new
  caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/dev/null 2>/tmp/hub-caddy.err \
    || { sed 's/^/   /' /tmp/hub-caddy.err >&2; echo "   ERROR: invalid Caddyfile, stopping without changing anything" >&2; exit 1; }
  mv -f /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
  echo "   configuration valid"

  echo "== Pi-hole web interface on $PIHOLE_PORT"
  current=$(pihole-FTL --config webserver.port)
  if [ "$current" != "$PIHOLE_PORT" ]; then
    [ -f /etc/hub-control/pihole-original-port ] || echo "$current" > /etc/hub-control/pihole-original-port
    [ -x /usr/local/sbin/pihole-backup.sh ] && { /usr/local/sbin/pihole-backup.sh >/dev/null 2>&1 && echo "   configuration backed up" || echo "   WARNING: backup failed"; }
    systemctl stop caddy 2>/dev/null || true
    pihole-FTL --config webserver.port "$PIHOLE_PORT" >/dev/null
    systemctl restart pihole-FTL
    if ! ftl_ready "$PIHOLE_PORT"; then
      echo "   ERROR: Pi-hole does not answer on the new port, restoring the previous one" >&2
      pihole-FTL --config webserver.port "$current" >/dev/null; systemctl restart pihole-FTL
      exit 1
    fi
    echo "   moved (it was: $current)"
  else
    echo "   already in place"
  fi

  echo "== Start"
  systemctl enable caddy >/dev/null 2>&1
  systemctl restart caddy
  sleep 3
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --cacert /etc/pihole-ca/ca.crt --resolve raspberry:443:127.0.0.1 https://raspberry/control/status || true)
  if [ "$code" != 200 ]; then
    echo "   ERROR: the hub does not answer over HTTPS (code $code). To roll back: sudo bash hub-install.sh disable" >&2
    journalctl -u caddy -n 15 --no-pager | sed 's/^/   /' >&2
    exit 1
  fi
  echo "   https://raspberry answers with the home certificate"
  echo "   CA to import on your devices: http://raspberry/ca.crt"
}

do_monthly() {
  echo "== Monthly update and backup"
  # The content: hub-update.timer (installed by prepare), with or without pi-setup.
  echo "   content: $(systemctl is-enabled hub-update.timer 2>/dev/null || echo off) (hub-update.timer, the 1st of the month)"
  # pi-setup's own backup takes the hub configuration too, when the package is there. Its file list is found by
  # its text: if that changes, the hub has its own backup anyway (sudo hub-install.sh backup).
  [ -f "$PISETUP/pihole-backup.sh" ] || { echo "   pi-setup package not found in $PISETUP: sudo hub-install.sh backup saves the hub settings"; return 0; }
  PISETUP="$PISETUP" python3 - <<'PY' || echo "   WARNING: pihole-backup.sh not changed: sudo hub-install.sh backup saves the hub settings"
import os, sys
base = os.environ["PISETUP"]
LIST_ANCHOR = "for f in etc/unbound/unbound.conf.d etc/netmon.conf usr/local/sbin usr/local/bin/netmon \\\n"
FILES = ("         etc/hub.conf etc/caddy/Caddyfile etc/caddy/services etc/hub-control/allowed-units \\\n"
         "         etc/polkit-1/rules.d/50-hub-control.rules usr/local/lib/raspberry-hub srv/hub/config srv/hub/icons \\\n"
         "         etc/systemd/system/kiwix-hub.service etc/systemd/system/hub-search.service \\\n"
         "         etc/systemd/system/hub-control.service etc/systemd/system/hub-cert-sync.path \\\n"
         "         etc/systemd/system/hub-cert-sync.service \\\n")
FILES_1X = FILES.replace("etc/caddy/services", "etc/caddy/servizi") \
                .replace("etc/hub-control/allowed-units", "etc/hub-control/unita-consentite") \
                .replace("srv/hub/icons", "srv/hub/icone")

backup = os.path.join(base, "pihole-backup.sh")
text = open(backup, encoding="utf-8").read()
if FILES in text:
    print("   pihole-backup.sh: already up to date")
elif FILES_1X in text:
    open(backup, "w", encoding="utf-8", newline="\n").write(text.replace(FILES_1X, FILES, 1))
    print("   pihole-backup.sh: hub file list updated")
else:
    if LIST_ANCHOR not in text:
        sys.exit("   cannot find the file list in pihole-backup.sh")
    open(backup, "w", encoding="utf-8", newline="\n").write(text.replace(LIST_ANCHOR, LIST_ANCHOR + FILES, 1))
    print("   pihole-backup.sh: added the hub configuration to the file list")
PY
  bash -n "$PISETUP/pihole-backup.sh"
  chown --reference="$PISETUP" "$PISETUP/pihole-backup.sh"
  install -o root -g root -m 750 "$PISETUP/pihole-backup.sh" /usr/local/sbin/pihole-backup.sh
}

# The settings of the hub, in a few MB: the password hash, added services and icons, switch states, the Caddy
# configuration and the home CA of the hub. Not the downloaded content, which can always be downloaded again.
BACKUP_PATHS="etc/hub.conf etc/hub-control etc/hub-ca etc/caddy srv/hub/config srv/hub/icons var/lib/hub-control"

do_backup() {   # $1 = the archive (default: hub-backup-YYYY-MM-DD.tar.gz in the home of the admin user)
  echo "== Backup of the hub settings"
  local out paths=() p
  out="${1:-$(getent passwd "$ADMIN" | cut -d: -f6)/hub-backup-$(date +%F).tar.gz}"
  for p in $BACKUP_PATHS; do [ -e "/$p" ] && paths+=("$p"); done
  ( umask 077; tar -czf "$out" -C / "${paths[@]}" )
  chown "$ADMIN:" "$out"
  echo "   $out ($(du -h "$out" | cut -f1)): ${paths[*]}"
  echo "   It holds the password hash and the key of the home CA: keep it private."
  echo "   To restore it: sudo tar -xzf $out -C / && sudo bash hub-install.sh"
}

do_disable() {
  echo "== Rolling back"
  systemctl disable --now caddy >/dev/null 2>&1 || true
  original=$(cat /etc/hub-control/pihole-original-port 2>/dev/null || echo "80o,443os,[::]:80o,[::]:443os")
  pihole-FTL --config webserver.port "$original" >/dev/null
  systemctl restart pihole-FTL
  ftl_ready 127.0.0.1 && echo "   Pi-hole back on: $original" || echo "   WARNING: Pi-hole does not answer yet, check: systemctl status pihole-FTL"
  echo "   Caddy stopped. Wikipedia, search and content stay installed (sudo systemctl disable --now kiwix-hub hub-search hub-control to stop them)."
}

case "$WHAT" in
  upgrade)
    # the installed copy when there is one: the package next to this script may be older
    upgrader="$LIB/hub-upgrade.py"; [ -f "$upgrader" ] || upgrader="$HERE/hub-upgrade.py"
    ADMIN_USER="$ADMIN" exec python3 "$upgrader" "${@:2}" ;;
  backup) do_backup "${2:-}" ;;
  rollback)
    # the installed copy: the one of the package may be of another version. exec: this script is replaced too
    roller="$LIB/hub-rollback.py"; [ -f "$roller" ] || roller="$HERE/hub-rollback.py"
    exec python3 "$roller" restore "${@:2}" ;;
  configure)
    ADMIN_USER="$ADMIN" python3 "$LIB/hub-configure.py" "${@:2}" ;;
  prepare) do_prepare ;;
  watchdog) do_watchdog ;;
  site)    do_site ;;
  enable)  do_enable ;;
  monthly) do_monthly ;;
  disable) do_disable ;;
  all)     do_prepare; do_site; do_enable; do_monthly ;;
  *) echo "Usage: sudo bash hub-install.sh [prepare|site|enable|monthly|disable|watchdog|configure [--country XX] [--wiki-language xx]|backup [FILE]|rollback|upgrade [X.Y.Z] [--yes]]" >&2; exit 1 ;;
esac
echo "== Done."
