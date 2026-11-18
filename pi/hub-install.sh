#!/bin/bash
# Installa l'hub di casa sul Raspberry: Caddy, Wikipedia offline, mappe con ricerca degli indirizzi,
# interruttori dei servizi e monitor dell'hardware. Va lanciato con sudo dalla cartella che contiene
# questi file (di norma ~/pi-setup/hub). Si puo' rilanciare senza danni.
#
#   sudo bash hub-install.sh prepara    pacchetti, utenti, cartelle, script e servizi locali
#                                       (non tocca Pi-hole ne' le porte 80 e 443)
#   sudo bash hub-install.sh sito       installa il sito dell'hub da sito.tar.gz
#   sudo bash hub-install.sh attiva     certificato di casa, Caddy sulle porte 80/443,
#                                       web di Pi-hole spostato su 127.0.0.1:8080
#   sudo bash hub-install.sh mensile    aggiunge i contenuti dell'hub all'aggiornamento mensile e al backup
#   sudo bash hub-install.sh disattiva  torna indietro: Pi-hole di nuovo su 80/443, Caddy fermo
#   sudo bash hub-install.sh            prepara + sito + attiva + mensile
set -e
export DEBIAN_FRONTEND=noninteractive
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
[ "$(id -u)" -eq 0 ] || { echo "Va lanciato con sudo." >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
PISETUP="$(dirname "$HERE")"                      # il pacchetto pi-setup (install.sh, pihole-cert.sh, ...)
WHAT="${1:-tutto}"
# l'utente che possiede il sito (/srv/hub/site) e lo aggiorna con deploy.ps1: chi ha lanciato sudo
ADMIN="${ADMIN_USER:-${SUDO_USER:-}}"
[ -n "$ADMIN" ] && [ "$ADMIN" != root ] || { echo "Lancialo con sudo dal tuo utente, oppure indica ADMIN_USER=nome" >&2; exit 1; }
# l'indirizzo del Raspberry nella rete di casa: il primo dell'interfaccia principale, se non indicato
PI="${PI_IP:-$(hostname -I | awk '{print $1}')}"
LIB=/usr/local/lib/raspberry-hub
PORTA_PIHOLE="127.0.0.1:8080"
SPENTI_ALL_INIZIO="${SPENTI_ALL_INIZIO-wikipedia mappe}"   # servizi che partono spenti alla prima installazione
PMTILES_VERSIONE=1.31.2
PMTILES_SHA256=f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1   # Linux arm64

ftl_pronto() {     # aspetta che il web e il DNS di Pi-hole rispondano; $1 = host:porta del web
  local i code
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://$1/api/auth" 2>/dev/null || true)
    if { [ "$code" = 200 ] || [ "$code" = 401 ]; } && [ -n "$(dig +short +time=2 +tries=1 www.debian.org @127.0.0.1 2>/dev/null | tail -1)" ]; then
      return 0
    fi
    sleep 3
  done
  return 1
}

do_prepara() {
  echo "== Pacchetti"
  # Caddy non deve partire da solo durante l'installazione: le porte 80/443 sono ancora di Pi-hole.
  printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d; chmod 755 /usr/sbin/policy-rc.d
  trap 'rm -f /usr/sbin/policy-rc.d' EXIT
  apt-get update -qq
  apt-get install -y -qq caddy kiwix-tools zstd curl wget python3 >/dev/null
  rm -f /usr/sbin/policy-rc.d; trap - EXIT
  systemctl is-active --quiet caddy || systemctl disable caddy >/dev/null 2>&1 || true
  echo "   caddy $(caddy version | awk '{print $1}'), kiwix-serve $(kiwix-serve --version 2>&1 | awk 'NR==1 {print $2}')"

  echo "== pmtiles (estrazione delle mappe)"
  if [ "$(pmtiles version 2>/dev/null | awk 'NR==1 {print $NF}')" = "$PMTILES_VERSIONE" ] || pmtiles version 2>/dev/null | grep -q "$PMTILES_VERSIONE"; then
    echo "   gia' installato ($PMTILES_VERSIONE)"
  else
    [ "$(dpkg --print-architecture)" = arm64 ] || { echo "   ERRORE: previsto solo per arm64" >&2; exit 1; }
    tmp=$(mktemp -d)
    curl -fsSL --max-time 300 -o "$tmp/pmtiles.tar.gz" \
      "https://github.com/protomaps/go-pmtiles/releases/download/v$PMTILES_VERSIONE/go-pmtiles_${PMTILES_VERSIONE}_Linux_arm64.tar.gz"
    echo "$PMTILES_SHA256  $tmp/pmtiles.tar.gz" | sha256sum -c --quiet - \
      || { rm -rf "$tmp"; echo "   ERRORE: impronta del file diversa da quella attesa, non installo" >&2; exit 1; }
    tar -xzf "$tmp/pmtiles.tar.gz" -C "$tmp" pmtiles
    install -o root -g root -m 755 "$tmp/pmtiles" /usr/local/bin/pmtiles
    rm -rf "$tmp"
    echo "   installato in /usr/local/bin/pmtiles"
  fi

  echo "== Utente e cartelle"
  id hubctl >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin hubctl
  for g in pihole video; do getent group "$g" >/dev/null && usermod -aG "$g" hubctl; done
  install -d -o root -g root -m 755 /srv/hub /srv/hub/zim /srv/hub/maps /srv/hub/search /srv/hub/stato "$LIB"
  install -d -o "$ADMIN" -g "$ADMIN" -m 755 /srv/hub/site
  install -d -o hubctl -g hubctl -m 775 /srv/hub/config /srv/hub/icone
  install -d -o hubctl -g hubctl -m 755 /var/lib/hub-control
  install -d -o root -g hubctl -m 770 /etc/hub-control
  # Stato iniziale: Wikipedia e mappe partono spente e si accendono dall'hub quando servono.
  # Vale solo alla prima installazione: dopo, decide l'interruttore dell'hub (e la scelta resta ai riavvii).
  if [ ! -e /var/lib/hub-control/.stato-iniziale ]; then
    for s in $SPENTI_ALL_INIZIO; do
      install -o hubctl -g hubctl -m 644 /dev/null "/var/lib/hub-control/$s.off"
    done
    install -o hubctl -g hubctl -m 644 /dev/null /var/lib/hub-control/.stato-iniziale
    echo "   stato iniziale: spenti ${SPENTI_ALL_INIZIO:-nessuno}"
  fi
  install -d -o root -g root -m 755 /etc/caddy/servizi
  [ -e /etc/caddy/servizi/000-vuoto.caddy ] || echo "# I servizi agganciati con hub-servizio finiscono in questa cartella." > /etc/caddy/servizi/000-vuoto.caddy

  echo "== Script"
  for f in hub-search.py hub-control.py build-search-index.py; do install -o root -g root -m 755 "$HERE/$f" "$LIB/$f"; done
  for f in hub-update.sh hub-control-setpass hub-servizio hub-cert-sync hub-verifica.sh; do
    install -o root -g root -m 755 "$HERE/$f" "/usr/local/sbin/$f"
  done
  for f in "$LIB"/*.py /usr/local/sbin/hub-control-setpass /usr/local/sbin/hub-servizio; do python3 -m py_compile "$f"; done
  rm -rf "$LIB/__pycache__" /usr/local/sbin/__pycache__
  for f in hub-update.sh hub-cert-sync hub-verifica.sh; do bash -n "/usr/local/sbin/$f"; done
  [ -f /etc/hub.conf ] || install -o root -g root -m 644 "$HERE/hub.conf" /etc/hub.conf
  [ -f /srv/hub/config/servizi.json ] || install -o hubctl -g hubctl -m 664 "$HERE/servizi.json" /srv/hub/config/servizi.json
  for f in "$HERE"/icone/*; do
    [ -e "/srv/hub/icone/$(basename "$f")" ] || install -o hubctl -g hubctl -m 644 "$f" "/srv/hub/icone/$(basename "$f")"
  done
  [ -f /etc/hub-control/unita-consentite ] || printf '%s\n' kiwix-hub.service hub-search.service > /etc/hub-control/unita-consentite
  /usr/local/sbin/hub-servizio regola
  echo "   regola polkit: hubctl puo' avviare e fermare solo $(grep -v '^#' /etc/hub-control/unita-consentite | paste -sd' ' -)"

  echo "== Servizi"
  for u in kiwix-hub.service hub-search.service hub-control.service hub-cert-sync.path hub-cert-sync.service; do
    install -o root -g root -m 644 "$HERE/unita/$u" "/etc/systemd/system/$u"
  done
  systemctl daemon-reload
  systemctl enable kiwix-hub.service hub-search.service hub-control.service >/dev/null 2>&1
  systemctl restart hub-control.service
  systemctl start kiwix-hub.service hub-search.service 2>/dev/null || true   # partono solo se i contenuti ci sono
  /usr/local/sbin/hub-update.sh stato
  echo "   hub-control attivo; Wikipedia e ricerca partiranno appena scaricati i contenuti"
}

do_sito() {
  echo "== Sito dell'hub"
  [ -f "$HERE/sito.tar.gz" ] || { echo "   sito.tar.gz non c'e': salto (si installa dal PC con deploy.ps1)"; return 0; }
  rm -rf /srv/hub/site.nuovo; install -d -o "$ADMIN" -g "$ADMIN" -m 755 /srv/hub/site.nuovo
  tar -xzf "$HERE/sito.tar.gz" -C /srv/hub/site.nuovo --no-same-owner
  [ -f /srv/hub/site.nuovo/index.html ] || { rm -rf /srv/hub/site.nuovo; echo "   ERRORE: l'archivio non contiene index.html" >&2; exit 1; }
  chown -R "$ADMIN:$ADMIN" /srv/hub/site.nuovo; chmod -R u=rwX,go=rX /srv/hub/site.nuovo
  rm -rf /srv/hub/site.vecchio; mv /srv/hub/site /srv/hub/site.vecchio; mv /srv/hub/site.nuovo /srv/hub/site
  rm -rf /srv/hub/site.vecchio
  echo "   installato in /srv/hub/site"
}

do_attiva() {
  echo "== Certificato HTTPS di casa"
  if [ ! -s /etc/pihole-ca/ca.crt ] || [ ! -x /usr/local/sbin/pihole-cert.sh ]; then
    [ -f "$PISETUP/install.sh" ] || { echo "   ERRORE: non trovo $PISETUP/install.sh per creare la CA di casa" >&2; exit 1; }
    echo "   creo la CA di casa con install.sh homeca (Pi-hole si riavvia: DNS fermo per qualche secondo)"
    bash "$PISETUP/install.sh" homeca | sed 's/^/   /'
  fi
  [ -s /etc/pihole-ca/ca.crt ] || { echo "   ERRORE: la CA di casa non e' stata creata" >&2; exit 1; }
  openssl verify -CAfile /etc/pihole-ca/ca.crt <(openssl x509 -in /etc/pihole/tls.pem) >/dev/null 2>&1 \
    || { echo "   ERRORE: /etc/pihole/tls.pem non e' firmato dalla CA di casa (prova: sudo pihole-cert.sh renew)" >&2; exit 1; }
  /usr/local/sbin/hub-cert-sync
  systemctl enable --now hub-cert-sync.path >/dev/null 2>&1
  echo "   certificato valido fino al $(openssl x509 -in /etc/caddy/certs/tls.pem -noout -enddate | cut -d= -f2)"

  echo "== Caddy"
  if [ -f /etc/caddy/Caddyfile ] && ! grep -q "Hub di casa" /etc/caddy/Caddyfile && [ ! -f /etc/caddy/Caddyfile.originale ]; then
    cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.originale
  fi
  install -o root -g root -m 644 "$HERE/Caddyfile" /etc/caddy/Caddyfile.nuovo
  sed -i "s/@IP_RASPBERRY@/$PI/g" /etc/caddy/Caddyfile.nuovo
  caddy validate --config /etc/caddy/Caddyfile.nuovo --adapter caddyfile >/dev/null 2>/tmp/hub-caddy.err \
    || { sed 's/^/   /' /tmp/hub-caddy.err >&2; echo "   ERRORE: Caddyfile non valido, mi fermo senza toccare nulla" >&2; exit 1; }
  mv -f /etc/caddy/Caddyfile.nuovo /etc/caddy/Caddyfile
  echo "   configurazione valida"

  echo "== Web di Pi-hole su $PORTA_PIHOLE"
  attuale=$(pihole-FTL --config webserver.port)
  if [ "$attuale" != "$PORTA_PIHOLE" ]; then
    [ -f /etc/hub-control/pihole-porta-originale ] || echo "$attuale" > /etc/hub-control/pihole-porta-originale
    [ -x /usr/local/sbin/pihole-backup.sh ] && { /usr/local/sbin/pihole-backup.sh >/dev/null 2>&1 && echo "   backup della configurazione eseguito" || echo "   ATTENZIONE: backup non riuscito"; }
    systemctl stop caddy 2>/dev/null || true
    pihole-FTL --config webserver.port "$PORTA_PIHOLE" >/dev/null
    systemctl restart pihole-FTL
    if ! ftl_pronto "$PORTA_PIHOLE"; then
      echo "   ERRORE: Pi-hole non risponde sulla nuova porta, rimetto quella di prima" >&2
      pihole-FTL --config webserver.port "$attuale" >/dev/null; systemctl restart pihole-FTL
      exit 1
    fi
    echo "   spostato (prima era: $attuale)"
  else
    echo "   gia' a posto"
  fi

  echo "== Avvio"
  systemctl enable caddy >/dev/null 2>&1
  systemctl restart caddy
  sleep 3
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --cacert /etc/pihole-ca/ca.crt --resolve raspberry:443:127.0.0.1 https://raspberry/controllo/stato || true)
  if [ "$code" != 200 ]; then
    echo "   ERRORE: l'hub non risponde in HTTPS (codice $code). Per tornare indietro: sudo bash hub-install.sh disattiva" >&2
    journalctl -u caddy -n 15 --no-pager | sed 's/^/   /' >&2
    exit 1
  fi
  echo "   https://raspberry risponde con il certificato di casa"
  echo "   CA da importare sui dispositivi: http://raspberry/ca.crt"
}

do_mensile() {
  echo "== Aggiornamento mensile e backup"
  [ -f "$PISETUP/monthly-update.sh" ] && [ -f "$PISETUP/pihole-backup.sh" ] && [ -f "$PISETUP/install.sh" ] \
    || { echo "   non trovo il pacchetto pi-setup in $PISETUP: salto"; return 0; }
  PISETUP="$PISETUP" python3 - <<'PY'
import os, sys
base = os.environ["PISETUP"]

mensile = os.path.join(base, "monthly-update.sh")
testo = open(mensile, encoding="utf-8").read()
if "hub-update.sh" in testo:
    print("   monthly-update.sh: gia' aggiornato")
else:
    segno = '    echo "===== $(ts) riavvio ====="'
    if segno not in testo:
        sys.exit("   ERRORE: non trovo il punto del riavvio in monthly-update.sh, non lo modifico")
    blocco = '''    # Contenuti dell'hub: Wikipedia offline, mappe e indice degli indirizzi (vedi hub-update.sh).
    # Un errore qui non blocca il riavvio: viene registrato e segnalato.
    if [ -x /usr/local/sbin/hub-update.sh ]; then
      echo "===== $(ts) aggiorno i contenuti dell'hub (Wikipedia, mappe, indirizzi) ====="
      if timeout 6h /usr/local/sbin/hub-update.sh tutto; then
        echo "===== $(ts) contenuti dell'hub aggiornati ====="
      else
        echo "===== $(ts) ATTENZIONE: aggiornamento dei contenuti dell'hub non riuscito o incompleto ====="
        [ -x /usr/local/bin/netmon ] && /usr/local/bin/netmon notify "⚠️ Hub: aggiornamento di Wikipedia, mappe o indirizzi non riuscito: vedi /var/log/monthly-update.log" >/dev/null 2>&1
      fi
    fi

'''
    open(mensile, "w", encoding="utf-8", newline="\n").write(testo.replace(segno, blocco + segno, 1))
    print("   monthly-update.sh: aggiunto l'aggiornamento dei contenuti dell'hub prima del riavvio")

backup = os.path.join(base, "pihole-backup.sh")
testo = open(backup, encoding="utf-8").read()
if "etc/hub.conf" in testo:
    print("   pihole-backup.sh: gia' aggiornato")
else:
    segno = "for f in etc/unbound/unbound.conf.d etc/netmon.conf usr/local/sbin usr/local/bin/netmon \\\n"
    if segno not in testo:
        sys.exit("   ERRORE: non trovo l'elenco dei file in pihole-backup.sh, non lo modifico")
    aggiunta = ("         etc/hub.conf etc/caddy/Caddyfile etc/caddy/servizi etc/hub-control/unita-consentite \\\n"
                "         etc/polkit-1/rules.d/50-hub-control.rules usr/local/lib/raspberry-hub srv/hub/config srv/hub/icone \\\n"
                "         etc/systemd/system/kiwix-hub.service etc/systemd/system/hub-search.service \\\n"
                "         etc/systemd/system/hub-control.service etc/systemd/system/hub-cert-sync.path \\\n"
                "         etc/systemd/system/hub-cert-sync.service \\\n")
    open(backup, "w", encoding="utf-8", newline="\n").write(testo.replace(segno, segno + aggiunta, 1))
    print("   pihole-backup.sh: aggiunta la configurazione dell'hub all'elenco dei file")
PY
  bash -n "$PISETUP/monthly-update.sh" && bash -n "$PISETUP/pihole-backup.sh"
  chown --reference="$PISETUP" "$PISETUP/monthly-update.sh" "$PISETUP/pihole-backup.sh"
  bash "$PISETUP/install.sh" update | sed 's/^/   /'
  install -o root -g root -m 750 "$PISETUP/pihole-backup.sh" /usr/local/sbin/pihole-backup.sh
}

do_disattiva() {
  echo "== Ritorno alla situazione precedente"
  systemctl disable --now caddy >/dev/null 2>&1 || true
  originale=$(cat /etc/hub-control/pihole-porta-originale 2>/dev/null || echo "80o,443os,[::]:80o,[::]:443os")
  pihole-FTL --config webserver.port "$originale" >/dev/null
  systemctl restart pihole-FTL
  ftl_pronto 127.0.0.1 && echo "   Pi-hole di nuovo su: $originale" || echo "   ATTENZIONE: Pi-hole non risponde ancora, controlla: systemctl status pihole-FTL"
  echo "   Caddy fermo. Wikipedia, ricerca e contenuti restano installati (sudo systemctl disable --now kiwix-hub hub-search hub-control per fermarli)."
}

case "$WHAT" in
  prepara)   do_prepara ;;
  sito)      do_sito ;;
  attiva)    do_attiva ;;
  mensile)   do_mensile ;;
  disattiva) do_disattiva ;;
  tutto)     do_prepara; do_sito; do_attiva; do_mensile ;;
  *) echo "Uso: sudo bash hub-install.sh [prepara|sito|attiva|mensile|disattiva]" >&2; exit 1 ;;
esac
echo "== Fatto."
