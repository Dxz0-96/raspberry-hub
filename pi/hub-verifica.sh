#!/bin/bash
# Controlla che l'hub di casa e i servizi del Raspberry siano tutti in piedi.
# Pensato per essere lanciato dopo un riavvio: verifica che tutto sia ripartito da solo.
#
#   sudo hub-verifica.sh            esegue i controlli e stampa l'esito
#   sudo hub-verifica.sh --attendi  prima aspetta fino a 3 minuti che i servizi finiscano di avviarsi
#
# Esce con 0 se tutti i controlli passano. I servizi spenti dall'hub non contano come errore.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C.UTF-8
CA=/etc/caddy/pubblico/ca.crt        # copia pubblica della CA di casa (la stessa di http://raspberry/ca.crt)
OK=0; KO=0; SALTATI=0
C() { curl -s --max-time 10 --cacert "$CA" --resolve raspberry:443:127.0.0.1 --resolve raspberry:80:127.0.0.1 "$@"; }
codice() { C -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }
controllo() {   # $1 = descrizione, il resto = comando che deve riuscire
  local nome="$1"; shift
  if "$@" >/dev/null 2>&1; then OK=$((OK + 1)); printf '  [ ok ]  %s\n' "$nome"
  else KO=$((KO + 1)); printf '  [ERRORE] %s\n' "$nome"; fi
}
saltato() { SALTATI=$((SALTATI + 1)); printf '  [  -  ]  %s\n' "$1"; }
attivo() { systemctl is-active --quiet "$1"; }
al_boot() { systemctl is-enabled --quiet "$1"; }
ha_codice() { [ "$(codice "$2")" = "$1" ]; }

if [ "${1:-}" = "--attendi" ]; then
  for _ in $(seq 1 36); do
    attivo caddy && attivo pihole-FTL && attivo hub-control && [ "$(codice https://raspberry/controllo/stato)" = 200 ] && break
    sleep 5
  done
fi

echo "Raspberry acceso da: $(uptime -p | sed 's/^up //')"
echo "Servizi"
for u in pihole-FTL unbound caddy hub-control; do
  controllo "$u in esecuzione" attivo "$u"
  controllo "$u parte all'avvio" al_boot "$u"
done
controllo "hub-cert-sync.path in ascolto sui rinnovi del certificato" attivo hub-cert-sync.path
for terna in kiwix-hub:wikipedia:/srv/hub/zim/wikipedia_it.zim hub-search:mappe:/srv/hub/search/indirizzi.db; do
  IFS=: read -r u nome serve <<<"$terna"
  controllo "$u parte all'avvio" al_boot "$u"
  if [ -e "/var/lib/hub-control/$nome.off" ]; then saltato "$u spento dall'hub (resta spento: corretto)"
  elif [ ! -e "$serve" ]; then saltato "$u in attesa del suo contenuto, non ancora scaricato"
  else controllo "$u in esecuzione" attivo "$u"; fi
done

echo "DNS"
controllo "Pi-hole risolve i nomi" test -n "$(dig +short +time=3 +tries=1 www.debian.org @127.0.0.1 | tail -1)"
if [ "$(pihole-FTL --config dns.blocking.active 2>/dev/null)" = true ]; then
  controllo "la pubblicita' viene bloccata" test "$(dig +short +time=3 +tries=1 doubleclick.net @127.0.0.1 | tail -1)" = 0.0.0.0
else saltato "blocco della pubblicita' in pausa dall'hub"; fi
controllo "Unbound risponde" test -n "$(dig +short +time=3 +tries=1 -p 5335 www.wikipedia.org @127.0.0.1 | tail -1)"

echo "Hub in HTTPS (certificato della CA di casa verificato)"
controllo "http://raspberry rimanda a https" ha_codice 308 http://raspberry/
controllo "pagina principale dell'hub" ha_codice 200 https://raspberry/
controllo "pagina delle mappe" ha_codice 200 https://raspberry/mappe/
controllo "elenco dei servizi" ha_codice 200 https://raspberry/servizi.json
controllo "stato dei contenuti" ha_codice 200 https://raspberry/status.json
controllo "stato dei servizi (hub-control)" ha_codice 200 https://raspberry/controllo/stato
controllo "monitor dell'hardware" test -n "$(C https://raspberry/controllo/sistema | python3 -c 'import sys,json; print(json.load(sys.stdin)["cpu"]["n"])' 2>/dev/null)"
controllo "dashboard di Pi-hole dietro Caddy" test "$(codice https://raspberry/admin/login)" = 200
controllo "pagina del monitor di rete" ha_codice 200 https://raspberry/netmon/
controllo "certificato valido anche per pi.hole" test "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --cacert "$CA" --resolve pi.hole:443:127.0.0.1 https://pi.hole/admin/login)" = 200
controllo "CA di casa scaricabile" ha_codice 200 http://raspberry/ca.crt
controllo "gli interruttori rifiutano chi non ha fatto l'accesso" test "$(codice -X POST -H 'X-Hub: 1' -H 'Content-Type: application/json' -d '{"acceso":false}' https://raspberry/controllo/servizi/wikipedia/interruttore)" = 401

echo "Contenuti"
if [ -e /var/lib/hub-control/wikipedia.off ]; then saltato "Wikipedia spenta dall'hub"
elif [ ! -e /srv/hub/zim/wikipedia_it.zim ]; then saltato "Wikipedia non ancora scaricata"
else controllo "Wikipedia risponde" ha_codice 200 https://raspberry/wiki/; fi
if [ -e /var/lib/hub-control/mappe.off ]; then saltato "mappe spente dall'hub"
else
  if [ -s /srv/hub/maps/italia.pmtiles ]; then
    controllo "mappe leggibili a pezzi (richiesta parziale)" test "$(codice -r 0-1023 https://raspberry/tiles/italia.pmtiles)" = 206
  else saltato "mappe non ancora scaricate"; fi
  if [ -s /srv/hub/search/indirizzi.db ]; then
    controllo "ricerca degli indirizzi" test "$(C 'https://raspberry/cerca?q=roma' | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["risultati"]))' 2>/dev/null || echo 0)" -gt 0
  else saltato "indice degli indirizzi non ancora creato"; fi
fi

echo "Pianificazioni"
controllo "aggiornamento mensile pianificato" test -s /etc/cron.d/monthly-update
controllo "l'aggiornamento mensile include i contenuti dell'hub" grep -q hub-update.sh /usr/local/sbin/monthly-update.sh
controllo "controllo settimanale del certificato pianificato" test -s /etc/cron.d/pihole-cert
controllo "monitor di rete attivo" attivo netmon.timer

echo
echo "Esito: $OK controlli riusciti, $KO falliti, $SALTATI saltati."
[ "$KO" -eq 0 ]
