#!/bin/bash
# Aggiorna i contenuti dell'hub di casa: Wikipedia offline, mappe dell'Italia, indice degli indirizzi.
#
#   sudo hub-update.sh              tutto (e' cio' che fa l'aggiornamento mensile)
#   sudo hub-update.sh wiki         solo Wikipedia
#   sudo hub-update.sh mappe        solo le mappe
#   sudo hub-update.sh indirizzi    solo l'indice degli indirizzi
#   sudo hub-update.sh stima-mappe  dice quanto peserebbero le mappe, senza scaricarle
#   sudo hub-update.sh stato        riscrive soltanto /srv/hub/status.json
#
# Ogni contenuto nuovo viene scaricato a parte, verificato e scambiato con quello vecchio solo
# se e' integro: se qualcosa va storto resta in funzione la versione precedente.
# Impostazioni in /etc/hub.conf.
set -u
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C.UTF-8

WIKI_LINGUA=it
WIKI_VARIANTE=maxi
MAPPE_BBOX=6.6,35.4,18.6,47.2
MAPPE_MAXZOOM=15
DUMP_INDIRIZZI=https://download1.graphhopper.com/public/europe/italy/photon-dump-italy-1.0-latest.jsonl.zst
GIORNI_MINIMI=20
HUB_DIR=/srv/hub
[ -r /etc/hub.conf ] && . /etc/hub.conf

LIB=/usr/local/lib/raspberry-hub
ZIM="$HUB_DIR/zim"
MAPS="$HUB_DIR/maps"
SEARCH="$HUB_DIR/search"
ESITI="$HUB_DIR/stato"
WIKI_URL="https://download.kiwix.org/zim/wikipedia/"
BUILDS_URL="https://build-metadata.protomaps.dev/builds.json"

ts()  { date "+%F %T"; }
log() { echo "$(ts) $*"; }
esito() { echo "$2" > "$ESITI/$1.esito"; }          # $1 = wiki|mappe|indirizzi  $2 = ok | errore: ...
fallito() { log "ERRORE $1: $2"; esito "$1" "errore: $2"; return 1; }
libero_kb() { df -Pk "$HUB_DIR" | awk 'NR==2 {print $4}'; }
giorni_da() { echo $(( ( $(date +%s) - $(stat -c %Y "$1" 2>/dev/null || echo 0) ) / 86400 )); }

scrivi_stato() {
  HUB_DIR="$HUB_DIR" WIKI_LINGUA="$WIKI_LINGUA" python3 - <<'PY'
import json, os, re, time
hub = os.environ["HUB_DIR"]
def leggi(p):
    try:
        with open(p, encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None
def peso(p):
    try:
        return os.path.getsize(p)
    except OSError:
        return None
link = f"{hub}/zim/wikipedia_{os.environ['WIKI_LINGUA']}.zim"
vero = os.path.realpath(link) if os.path.exists(link) else None
m = re.search(r"_(\d{4}-\d{2})\.zim$", vero or "")
stato = {
    "aggiornato": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    "wikipedia": {"edizione": m.group(1) if m else None, "byte": peso(vero) if vero else None,
                  "esito": leggi(f"{hub}/stato/wiki.esito"), "in_corso": os.path.exists(f"{hub}/stato/wiki.in-corso")},
    "mappe": {"build": (leggi(f"{hub}/maps/italia.build") or "")[:8] or None,
              "byte": peso(f"{hub}/maps/italia.pmtiles"), "esito": leggi(f"{hub}/stato/mappe.esito"),
              "in_corso": os.path.exists(f"{hub}/stato/mappe.in-corso")},
    "indirizzi": {"dati": leggi(f"{hub}/search/indirizzi.data"), "byte": peso(f"{hub}/search/indirizzi.db"),
                  "esito": leggi(f"{hub}/stato/indirizzi.esito"),
                  "in_corso": os.path.exists(f"{hub}/stato/indirizzi.in-corso")},
}
tmp = f"{hub}/status.json.tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(stato, f, ensure_ascii=False)
os.chmod(tmp, 0o644)
os.replace(tmp, f"{hub}/status.json")
PY
}
in_corso() {      # $1 = wiki|mappe|indirizzi  $2 = si|no : segnala all'hub che il contenuto e' in arrivo
  if [ "$2" = si ]; then : > "$ESITI/$1.in-corso"; else rm -f "$ESITI/$1.in-corso"; fi
  scrivi_stato
}

# --------------------------------------------------------------------------- Wikipedia
do_wiki() {
  local modello ultimo dest link attuale byte serve sha atteso
  modello="wikipedia_${WIKI_LINGUA}_all_${WIKI_VARIANTE}_[0-9]{4}-[0-9]{2}\.zim"
  ultimo=$(curl -fsSL --max-time 120 "$WIKI_URL" | grep -oE "$modello" | sort -u | tail -1)
  [ -n "$ultimo" ] || { fallito wiki "elenco delle edizioni non leggibile ($WIKI_URL)"; return 1; }
  dest="$ZIM/$ultimo"
  link="$ZIM/wikipedia_${WIKI_LINGUA}.zim"
  attuale=$(readlink -f "$link" 2>/dev/null || true)
  if [ -s "$dest" ] && [ "$attuale" = "$dest" ]; then
    log "wiki: gia' all'ultima edizione ($ultimo)"; esito wiki ok; return 0
  fi

  in_corso wiki si
  if [ ! -s "$dest" ]; then
    byte=$(curl -fsSIL --max-time 60 "$WIKI_URL$ultimo" | awk 'tolower($1)=="content-length:" {v=$2} END {print v+0}' | tr -d '\r')
    serve=$(( byte / 1024 + 2097152 ))            # il file piu' 2 GB di margine
    if [ -f "$dest.part" ]; then serve=$(( serve - $(stat -c %s "$dest.part") / 1024 )); fi
    if [ "$(libero_kb)" -lt "$serve" ]; then
      fallito wiki "spazio insufficiente per $ultimo (servono $(( serve / 1048576 )) GB liberi)"; return 1
    fi
    log "wiki: scarico $ultimo ($(( byte / 1073741824 )) GB), riprende da dove era arrivato se interrotto"
    if ! wget -c -nv --tries=20 --waitretry=30 --timeout=60 -O "$dest.part" "$WIKI_URL$ultimo"; then
      fallito wiki "download interrotto, riprendera' al prossimo aggiornamento"; return 1
    fi
    atteso=$(curl -fsSL --max-time 60 "$WIKI_URL$ultimo.sha256" | awk '{print $1}')
    if [ ${#atteso} -ne 64 ]; then
      fallito wiki "impronta SHA-256 non disponibile, file non installato"; return 1
    fi
    log "wiki: verifico l'impronta SHA-256"
    sha=$(nice -n 10 sha256sum "$dest.part" | awk '{print $1}')
    if [ "$sha" != "$atteso" ]; then
      rm -f "$dest.part"
      fallito wiki "impronta SHA-256 diversa da quella pubblicata: file scartato"; return 1
    fi
    mv -f "$dest.part" "$dest"
    chmod 644 "$dest"
  fi

  ln -sfn "$ultimo" "$link.nuovo" && mv -Tf "$link.nuovo" "$link"
  # restart e non try-restart: alla prima installazione il servizio non era mai partito (mancava il file).
  # Se Wikipedia e' spenta dall'hub, la condizione dell'unita' la lascia ferma.
  systemctl restart kiwix-hub.service 2>/dev/null || true
  # via le edizioni precedenti della stessa variante
  find "$ZIM" -maxdepth 1 -type f -name "wikipedia_${WIKI_LINGUA}_all_*.zim" ! -name "$ultimo" -delete
  find "$ZIM" -maxdepth 1 -type f -name "*.zim.part" ! -name "$ultimo.part" -delete
  log "wiki: installata l'edizione $ultimo"
  esito wiki ok
}

# --------------------------------------------------------------------------- Mappe
ultimo_build() {
  curl -fsSL --max-time 120 "$BUILDS_URL" | python3 -c '
import json, sys
b = [x for x in json.load(sys.stdin) if str(x.get("key", "")).endswith(".pmtiles") and x.get("uploaded")]
b.sort(key=lambda x: x["uploaded"])
print(b[-1]["key"] if b else "")'
}

do_mappe() {
  local ultimo dest="$MAPS/italia.pmtiles" rc
  command -v pmtiles >/dev/null || { fallito mappe "comando pmtiles non installato"; return 1; }
  if [ -s "$dest" ] && [ "$(giorni_da "$MAPS/italia.build")" -lt "$GIORNI_MINIMI" ]; then
    log "mappe: quelle installate hanno meno di $GIORNI_MINIMI giorni, le tengo"; esito mappe ok; return 0
  fi
  ultimo=$(ultimo_build)
  [ -n "$ultimo" ] || { fallito mappe "elenco dei build non leggibile ($BUILDS_URL)"; return 1; }

  in_corso mappe si
  rm -f "$dest.nuovo"
  log "mappe: estraggo l'Italia dal build $ultimo (riquadro $MAPPE_BBOX, zoom fino a $MAPPE_MAXZOOM)"
  nice -n 10 pmtiles extract "https://build.protomaps.com/$ultimo" "$dest.nuovo" \
      --bbox="$MAPPE_BBOX" --maxzoom="$MAPPE_MAXZOOM" --download-threads=4 2>&1 \
    | tr '\r' '\n' | grep -vE '^[[:space:]]*$|%' | tail -n 12
  rc=${PIPESTATUS[0]}
  if [ "$rc" -ne 0 ] || [ ! -s "$dest.nuovo" ]; then
    rm -f "$dest.nuovo"; fallito mappe "estrazione non riuscita (codice $rc)"; return 1
  fi
  if ! pmtiles verify "$dest.nuovo" >/dev/null 2>&1; then
    rm -f "$dest.nuovo"; fallito mappe "il file estratto non supera la verifica: scartato"; return 1
  fi
  chmod 644 "$dest.nuovo"
  mv -f "$dest.nuovo" "$dest"
  echo "$ultimo" > "$MAPS/italia.build"
  log "mappe: installate ($(( $(stat -c %s "$dest") / 1048576 )) MB, build $ultimo)"
  esito mappe ok
}

do_stima_mappe() {
  local ultimo
  command -v pmtiles >/dev/null || { echo "comando pmtiles non installato" >&2; return 1; }
  ultimo=$(ultimo_build)
  [ -n "$ultimo" ] || { echo "elenco dei build non leggibile" >&2; return 1; }
  echo "Build piu' recente: $ultimo"
  pmtiles extract "https://build.protomaps.com/$ultimo" /dev/null \
      --bbox="$MAPPE_BBOX" --maxzoom="$MAPPE_MAXZOOM" --dry-run 2>&1 | tr '\r' '\n' | grep -vE '^[[:space:]]*$' | tail -n 8
}

# --------------------------------------------------------------------------- Indirizzi
do_indirizzi() {
  local db="$SEARCH/indirizzi.db" dump="$SEARCH/dump.jsonl.zst" atteso md5 rc
  if [ -s "$db" ] && [ "$(giorni_da "$db")" -lt "$GIORNI_MINIMI" ]; then
    log "indirizzi: l'indice installato ha meno di $GIORNI_MINIMI giorni, lo tengo"; esito indirizzi ok; return 0
  fi
  atteso=$(curl -fsSL --max-time 60 "$DUMP_INDIRIZZI.md5" | awk '{print $1}')
  [ ${#atteso} -eq 32 ] || { fallito indirizzi "impronta MD5 del dump non leggibile"; return 1; }
  if [ -s "$db" ] && [ "$(cat "$SEARCH/indirizzi.md5" 2>/dev/null)" = "$atteso" ]; then
    log "indirizzi: il dump pubblicato e' lo stesso gia' installato"; touch "$db"; esito indirizzi ok; return 0
  fi

  in_corso indirizzi si
  if [ "$(libero_kb)" -lt 6291456 ]; then
    fallito indirizzi "spazio insufficiente (servono 6 GB liberi durante la creazione)"; return 1
  fi
  # Se un tentativo precedente si e' fermato dopo il download (per esempio per un riavvio), il dump
  # gia' scaricato e integro si riusa senza riscaricarlo.
  if [ -s "$dump" ] && [ "$(md5sum "$dump" | awk '{print $1}')" = "$atteso" ]; then
    log "indirizzi: riuso il dump gia' scaricato"
  else
    rm -f "$dump"
    log "indirizzi: scarico il dump dell'Italia"
    if ! wget -c -nv --tries=20 --waitretry=30 --timeout=60 -O "$dump.part" "$DUMP_INDIRIZZI"; then
      fallito indirizzi "download interrotto, riprendera' al prossimo aggiornamento"; return 1
    fi
    md5=$(md5sum "$dump.part" | awk '{print $1}')
    if [ "$md5" != "$atteso" ]; then
      rm -f "$dump.part"; fallito indirizzi "impronta MD5 diversa da quella pubblicata: dump scartato"; return 1
    fi
    mv -f "$dump.part" "$dump"
  fi

  log "indirizzi: costruisco l'indice (sul Pi 3 puo' richiedere piu' di un'ora)"
  rm -f "$db.nuovo" "$db.nuovo-journal"
  mkdir -p "$SEARCH/tmp"
  zstd -dc "$dump" | SQLITE_TMPDIR="$SEARCH/tmp" nice -n 15 python3 "$LIB/build-search-index.py" --out "$db.nuovo"
  rc=${PIPESTATUS[1]}
  rm -rf "$SEARCH/tmp"
  if [ "$rc" -ne 0 ] || [ ! -s "$db.nuovo" ]; then
    rm -f "$db.nuovo" "$db.nuovo-journal"; fallito indirizzi "creazione dell'indice non riuscita (codice $rc)"; return 1
  fi
  if ! python3 "$LIB/build-search-index.py" --verifica "$db.nuovo"; then
    rm -f "$db.nuovo"; fallito indirizzi "l'indice nuovo non risponde alla ricerca di prova: scartato"; return 1
  fi
  python3 "$LIB/build-search-index.py" --data "$db.nuovo" > "$SEARCH/indirizzi.data.nuovo" 2>/dev/null || true
  chmod 644 "$db.nuovo"
  mv -f "$db.nuovo" "$db"
  mv -f "$SEARCH/indirizzi.data.nuovo" "$SEARCH/indirizzi.data" 2>/dev/null || true
  echo "$atteso" > "$SEARCH/indirizzi.md5"
  rm -f "$dump"
  # come sopra: parte anche la prima volta, salvo mappe spente dall'hub
  systemctl restart hub-search.service 2>/dev/null || true
  log "indirizzi: indice installato ($(( $(stat -c %s "$db") / 1048576 )) MB)"
  esito indirizzi ok
}

# --------------------------------------------------------------------------- avvio
COSA="${1:-tutto}"
case "$COSA" in
  tutto|wiki|mappe|indirizzi|stato|stima-mappe) ;;
  *) echo "Uso: sudo hub-update.sh [tutto|wiki|mappe|indirizzi|stima-mappe|stato]" >&2; exit 2 ;;
esac
[ "$(id -u)" -eq 0 ] || { echo "Va lanciato con sudo." >&2; exit 1; }
mkdir -p "$ZIM" "$MAPS" "$SEARCH" "$ESITI"

if [ "$COSA" = stima-mappe ]; then do_stima_mappe; exit $?; fi
if [ "$COSA" = stato ]; then scrivi_stato; exit 0; fi

# Un solo aggiornamento per contenuto alla volta (wiki, mappe e indirizzi possono girare insieme).
blocco() { exec {fd}>"/run/hub-update-$1.lock"; flock -n "$fd"; }
rc=0
for parte in wiki mappe indirizzi; do
  [ "$COSA" = tutto ] || [ "$COSA" = "$parte" ] || continue
  if ! blocco "$parte"; then log "$parte: un altro aggiornamento e' gia' in corso, salto"; continue; fi
  log "===== $parte: inizio"
  "do_$parte" || rc=1
  in_corso "$parte" no
done
log "===== fine (esito: $([ $rc -eq 0 ] && echo ok || echo 'con errori'))"
exit $rc
