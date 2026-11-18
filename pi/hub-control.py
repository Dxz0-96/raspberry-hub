#!/usr/bin/env python3
"""Hub di casa: stato e interruttori dei servizi, servizi aggiunti dall'hub, monitor dell'hardware.

Senza accesso (chiunque sia in rete):
    GET  /controllo/stato                 stato di ogni servizio (con le visite al minuto), sessione, DNS
    GET  /controllo/sistema               misure dell'hardware in questo momento
    GET  /controllo/sistema/storico       ultima ora (un punto ogni 5 s) e ultime 24 ore (uno al minuto)
    POST /controllo/accesso               {utente, password} -> cookie di sessione
Con accesso:
    POST   /controllo/uscita
    POST   /controllo/password            {attuale, nuova}
    POST   /controllo/servizi/<id>/interruttore   {acceso: true|false}
    POST   /controllo/servizi             {nome, descrizione, url, icona?}   aggiunge un collegamento
    POST   /controllo/servizi/<id>        come sopra, modifica un collegamento aggiunto
    DELETE /controllo/servizi/<id>        rimuove un collegamento aggiunto

Gira come utente "hubctl", senza sudo. Puo' avviare e fermare solo le unita' elencate in
/etc/hub-control/unita-consentite (lo stesso elenco della regola polkit) e usare "pihole enable/disable"
perche' e' nel gruppo "pihole". Solo libreria standard. Ascolta su 127.0.0.1: lo pubblica Caddy.

Attivita' dei servizi: Caddy manda via UDP su 127.0.0.1:8084 una riga per ogni richiesta; qui si conta
quante ne arrivano al minuto per sezione (wiki, tiles, ...), solo in memoria.
Statistiche DNS: lette ogni 30 secondi dall'API di Pi-hole (127.0.0.1:8080) con la sua password interna
/etc/pihole/cli_pw, leggibile dal gruppo "pihole". Sola lettura; la sessione viene chiusa all'uscita.
"""
import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import secrets
import signal
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORTA = int(os.environ.get("HUB_CONTROL_PORT", "8083"))
HUB_DIR = os.environ.get("HUB_DIR", "/srv/hub")
FILE_SERVIZI = os.path.join(HUB_DIR, "config", "servizi.json")
DIR_ICONE = os.path.join(HUB_DIR, "icone")
DIR_STATO = os.environ.get("HUB_CONTROL_STATO", "/var/lib/hub-control")
FILE_CRED = os.environ.get("HUB_CONTROL_CRED", "/etc/hub-control/credenziali.json")
FILE_UNITA = os.environ.get("HUB_CONTROL_UNITA", "/etc/hub-control/unita-consentite")
FILE_SESSIONI = os.path.join(DIR_STATO, "sessioni.json")    # solo impronte dei gettoni, mai i gettoni
INTERFACCIA = os.environ.get("HUB_IFACE", "eth0")
DISCO = os.environ.get("HUB_DISCO", "mmcblk0")
COOKIE_SICURO = os.environ.get("HUB_COOKIE_INSICURO") != "1"      # "1" solo per le prove in HTTP
PORTA_REGISTRO = int(os.environ.get("HUB_LOG_PORT", "8084"))
API_PIHOLE = os.environ.get("HUB_PIHOLE_API", "http://127.0.0.1:8080/api")
FILE_CLI_PW = os.environ.get("HUB_PIHOLE_CLI_PW", "/etc/pihole/cli_pw")
FILE_UNBOUND = "/etc/unbound/unbound.conf.d/forward-dot.conf"

# La sessione resta valida finche' non si fa "Esci": il cookie dura 400 giorni (il massimo che i browser
# accettano) e viene rinnovato una volta al giorno mentre si usa l'hub. Le sessioni sopravvivono ai riavvii.
COOKIE_S = 400 * 86400
RINNOVO_S = 86400
SESSIONI_MAX = 50
ERRORI_MAX = 5
BLOCCO_S = 300
CORPO_MAX = 1_100_000
ICONA_MAX = 512 * 1024
TICK = os.sysconf("SC_CLK_TCK")
NCPU = os.cpu_count() or 1
ID_VALIDO = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
URL_VALIDO = re.compile(r"^(https?://[^\s<>\"'\\]{3,280}|/[^\s<>\"'\\]{0,280})$")


def leggi(percorso, predefinito=""):
    try:
        with open(percorso, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return predefinito


def esegui(comando, attesa=20):
    """(riuscito, testo). Non solleva eccezioni: un comando mancante e' solo un fallimento."""
    try:
        r = subprocess.run(comando, capture_output=True, text=True, timeout=attesa)
        return r.returncode == 0, (r.stdout + r.stderr).strip()
    except (OSError, subprocess.SubprocessError) as errore:
        return False, str(errore)


# =========================================================================== monitor dell'hardware
class Monitor(threading.Thread):
    """Campiona /proc e /sys ogni 5 secondi e tiene lo storico in memoria (niente scritture su disco)."""
    PASSO = 5

    def __init__(self):
        super().__init__(daemon=True)
        self.blocco = threading.Lock()
        self.ultimo = {}
        self.recente = deque(maxlen=720)          # un'ora a un punto ogni 5 s: [ora, cpu, temp]
        self.giorno = deque(maxlen=1440)          # 24 ore a un punto al minuto: [ora, cpu, temp, mem, carico]
        self._minuto = []
        self._alimentazione = (0.0, None)
        self._contenuti = (0.0, {})
        self.modello = leggi("/proc/device-tree/model").strip("\x00\n ") or "Raspberry Pi"
        self.nome = socket.gethostname()

    @staticmethod
    def _cpu():
        valori = {}
        for riga in leggi("/proc/stat").splitlines():
            if not riga.startswith("cpu"):
                break
            campi = riga.split()
            numeri = [int(x) for x in campi[1:9]]
            valori[campi[0]] = (sum(numeri), numeri[3] + numeri[4])
        return valori

    @staticmethod
    def _processi():
        tempi = {}
        for voce in os.listdir("/proc"):
            if not voce.isdigit():
                continue
            dati = leggi(f"/proc/{voce}/stat")
            fine = dati.rfind(")")
            if fine < 0:
                continue
            campi = dati[fine + 2:].split()
            if len(campi) > 12:
                tempi[int(voce)] = (dati[dati.find("(") + 1:fine], int(campi[11]) + int(campi[12]))
        return tempi

    @staticmethod
    def _rete():
        for riga in leggi("/proc/net/dev").splitlines():
            nome, _, resto = riga.partition(":")
            if nome.strip() == INTERFACCIA:
                campi = resto.split()
                return int(campi[0]), int(campi[8])
        return 0, 0

    @staticmethod
    def _settori():
        for riga in leggi("/proc/diskstats").splitlines():
            campi = riga.split()
            if len(campi) > 9 and campi[2] == DISCO:
                return int(campi[5]) + int(campi[9])
        return 0

    @staticmethod
    def _indirizzo():
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("192.0.2.1", 9))
                return s.getsockname()[0]
        except OSError:
            return ""

    def _leggi_alimentazione(self, ora):
        quando, valore = self._alimentazione
        if ora - quando < 30:
            return valore
        riuscito, testo = esegui(["vcgencmd", "get_throttled"], attesa=5)
        m = re.search(r"0x([0-9a-fA-F]+)", testo) if riuscito else None
        valore = None
        if m:
            bit = int(m.group(1), 16)
            valore = {"sottotensione": bool(bit & 0x1), "rallentato": bool(bit & 0x6),
                      "sottotensione_passata": bool(bit & 0x10000), "rallentato_passato": bool(bit & 0x60000)}
        self._alimentazione = (ora, valore)
        return valore

    def _leggi_contenuti(self, ora):
        quando, valore = self._contenuti
        if ora - quando < 60:
            return valore
        def peso(percorso):
            try:
                return os.path.getsize(os.path.realpath(percorso))
            except OSError:
                return 0
        zim = [os.path.join(HUB_DIR, "zim", f) for f in (os.listdir(os.path.join(HUB_DIR, "zim"))
               if os.path.isdir(os.path.join(HUB_DIR, "zim")) else []) if not os.path.islink(os.path.join(HUB_DIR, "zim", f))]
        valore = {"wikipedia": sum(peso(f) for f in zim),
                  "mappe": peso(os.path.join(HUB_DIR, "maps", "italia.pmtiles")),
                  "indirizzi": peso(os.path.join(HUB_DIR, "search", "indirizzi.db"))}
        self._contenuti = (ora, valore)
        return valore

    def run(self):
        cpu0, proc0, rete0, settori0, t0 = self._cpu(), self._processi(), self._rete(), self._settori(), time.monotonic()
        while True:
            time.sleep(self.PASSO)
            try:
                cpu1, proc1, rete1, settori1, t1 = self._cpu(), self._processi(), self._rete(), self._settori(), time.monotonic()
                self._campiona(cpu0, cpu1, proc0, proc1, rete0, rete1, settori0, settori1, t1 - t0)
                cpu0, proc0, rete0, settori0, t0 = cpu1, proc1, rete1, settori1, t1
            except Exception as errore:                # un campione sbagliato non deve fermare il monitor
                print(f"monitor: {errore!r}", flush=True)

    def _campiona(self, cpu0, cpu1, proc0, proc1, rete0, rete1, settori0, settori1, dt):
        ora = time.time()

        def uso(chiave):
            tot = cpu1[chiave][0] - cpu0[chiave][0]
            return round(max(0.0, min(100.0, 100.0 * (1 - (cpu1[chiave][1] - cpu0[chiave][1]) / tot))), 1) if tot > 0 else 0.0

        core = [uso(k) for k in sorted(cpu1) if k != "cpu" and k in cpu0]
        totale = uso("cpu") if "cpu" in cpu0 and "cpu" in cpu1 else 0.0
        carico = [float(x) for x in leggi("/proc/loadavg").split()[:3]] or [0.0, 0.0, 0.0]
        try:
            temp = round(int(leggi("/sys/class/thermal/thermal_zone0/temp").strip()) / 1000, 1)
        except ValueError:
            temp = None
        try:
            mhz = round(int(leggi("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq").strip()) / 1000)
        except ValueError:
            mhz = None

        mem = {}
        for riga in leggi("/proc/meminfo").splitlines():
            chiave, _, resto = riga.partition(":")
            if chiave in ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree"):
                mem[chiave] = int(resto.split()[0]) * 1024
        mem_tot = mem.get("MemTotal", 0)
        mem_usata = mem_tot - mem.get("MemAvailable", 0)

        try:
            fs = os.statvfs(HUB_DIR if os.path.isdir(HUB_DIR) else "/")
            disco_tot, disco_usato = fs.f_blocks * fs.f_frsize, (fs.f_blocks - fs.f_bfree) * fs.f_frsize
            disco_pieno = round(100 * (1 - fs.f_bavail / max(1, fs.f_blocks - fs.f_bfree + fs.f_bavail)), 1)
        except OSError:
            disco_tot = disco_usato = 0
            disco_pieno = 0.0

        tempi = {}
        for pid, (nome, tick) in proc1.items():
            prima = proc0.get(pid)
            if prima and prima[0] == nome and tick >= prima[1]:
                tempi[nome] = tempi.get(nome, 0) + tick - prima[1]
        processi = [{"nome": n, "cpu": round(100.0 * t / TICK / dt / NCPU, 1)}
                    for n, t in sorted(tempi.items(), key=lambda x: -x[1])[:5] if t > 0]

        alimentazione = self._leggi_alimentazione(ora)
        avvisi = []
        if temp is not None and temp >= 70:
            avvisi.append("temperatura")
        if disco_pieno >= 85:
            avvisi.append("disco")
        if alimentazione and (alimentazione["sottotensione"] or alimentazione["rallentato"]):
            avvisi.append("alimentazione")
        if carico[1] > NCPU:
            avvisi.append("carico")

        campione = {
            "ora": round(ora), "nome": self.nome, "modello": self.modello, "ip": self._indirizzo(),
            "cpu": {"uso": totale, "core": core, "carico": carico, "mhz": mhz, "n": NCPU},
            "temp": temp,
            "mem": {"totale": mem_tot, "usata": mem_usata, "swap_totale": mem.get("SwapTotal", 0),
                    "swap_usata": mem.get("SwapTotal", 0) - mem.get("SwapFree", 0)},
            "disco": {"totale": disco_tot, "usato": disco_usato, "pieno": disco_pieno,
                      "attivita": round(max(0, settori1 - settori0) * 512 / dt),
                      "contenuti": self._leggi_contenuti(ora)},
            "rete": {"interfaccia": INTERFACCIA, "giu": round(max(0, rete1[0] - rete0[0]) * 8 / dt),
                     "su": round(max(0, rete1[1] - rete0[1]) * 8 / dt),
                     "collegata": leggi(f"/sys/class/net/{INTERFACCIA}/operstate").strip() == "up",
                     "mbit": int(leggi(f"/sys/class/net/{INTERFACCIA}/speed").strip() or 0) if
                     leggi(f"/sys/class/net/{INTERFACCIA}/speed").strip().lstrip("-").isdigit() else None},
            "alimentazione": alimentazione,
            "acceso_da": round(float((leggi("/proc/uptime").split() or ["0"])[0])),
            "processi": processi, "avvisi": avvisi,
        }
        mem_pct = round(100.0 * mem_usata / mem_tot, 1) if mem_tot else 0.0
        with self.blocco:
            self.ultimo = campione
            self.recente.append([round(ora), totale, temp])
            self._minuto.append((totale, temp or 0.0, mem_pct, carico[0]))
            if len(self._minuto) >= 60 // self.PASSO:
                n = len(self._minuto)
                self.giorno.append([round(ora)] + [round(sum(c[i] for c in self._minuto) / n, 1) for i in range(4)])
                self._minuto = []

    def adesso(self):
        with self.blocco:
            return dict(self.ultimo)

    def storico(self):
        with self.blocco:
            return {"recente": {"passo": self.PASSO, "punti": list(self.recente)},
                    "giorno": {"passo": 60, "punti": list(self.giorno)}}


# =========================================================================== servizi
blocco_servizi = threading.Lock()


def leggi_servizi():
    try:
        with open(FILE_SERVIZI, encoding="utf-8") as f:
            elenco = json.load(f).get("servizi", [])
        return [s for s in elenco if isinstance(s, dict) and ID_VALIDO.match(str(s.get("id", "")))]
    except (OSError, ValueError, AttributeError):
        return []


def scrivi_servizi(elenco):
    provvisorio = FILE_SERVIZI + ".tmp"
    with open(provvisorio, "w", encoding="utf-8") as f:
        json.dump({"servizi": elenco}, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.chmod(provvisorio, 0o664)
    os.replace(provvisorio, FILE_SERVIZI)


def unita_consentite():
    return {riga.strip() for riga in leggi(FILE_UNITA).splitlines() if riga.strip() and not riga.startswith("#")}


def segnaposto(ident):
    return os.path.join(DIR_STATO, f"{ident}.off")


def bersaglio(servizio):
    """(host, porta) da provare per un collegamento, oppure None se non c'e' nulla da verificare."""
    indirizzo = servizio.get("verifica") or servizio.get("url") or ""
    if not re.match(r"^(https?|tcp)://", indirizzo):
        return None
    parti = urlparse(indirizzo)
    if not parti.hostname:
        return None
    return parti.hostname, parti.port or (443 if parti.scheme == "https" else 80)


class Sorvegliante(threading.Thread):
    """Tiene aggiornato lo stato dei servizi: unita' e Pi-hole ogni 5 s, collegamenti ogni 30 s."""

    def __init__(self):
        super().__init__(daemon=True)
        self.blocco = threading.Lock()
        self.stati = {}
        self._collegamenti = {}
        self._ultimo_giro_lento = 0.0
        self.sveglia = threading.Event()

    def run(self):
        while True:
            try:
                self.aggiorna()
            except Exception as errore:
                print(f"sorvegliante: {errore!r}", flush=True)
            self.sveglia.wait(5)
            self.sveglia.clear()

    def _stato(self, s, lento):
        tipo = s.get("tipo", "link")
        ident = s["id"]
        if tipo == "pihole":
            attivo, _ = esegui(["systemctl", "is-active", "--quiet", "pihole-FTL.service"], attesa=5)
            if not attivo:
                return "errore", "Pi-hole non è in esecuzione", False
            riuscito, testo = esegui(["pihole-FTL", "--config", "dns.blocking.active"], attesa=5)
            if not riuscito:
                return "sconosciuto", "Stato del blocco non leggibile", True
            return ("acceso", "Blocco attivo", True) if testo.strip().lower() == "true" else ("pausa", "Blocco in pausa", True)
        if tipo == "unita":
            unita = str(s.get("unita", ""))
            comandabile = unita in unita_consentite()
            if os.path.exists(segnaposto(ident)):
                return "spento", "Spento dall'hub", comandabile
            richiede = s.get("richiede")
            if richiede and not os.path.exists(richiede):
                return "mancante", "Contenuto non ancora scaricato", False
            attiva, _ = esegui(["systemctl", "is-active", "--quiet", unita], attesa=5)
            if attiva:
                return "acceso", "", comandabile
            if s.get("facoltativa"):
                return "acceso", str(s.get("senza_unita", "")), comandabile
            return "errore", "Il servizio non è in esecuzione", comandabile
        meta = bersaglio(s)
        if meta is None:
            return "acceso", "", False
        if lento or ident not in self._collegamenti:
            try:
                socket.create_connection(meta, timeout=2).close()
                self._collegamenti[ident] = ("acceso", "")
            except OSError:
                self._collegamenti[ident] = ("irraggiungibile", f"Non risponde da {meta[0]}")
        return (*self._collegamenti[ident], False)

    def aggiorna(self):
        adesso = time.monotonic()
        lento = adesso - self._ultimo_giro_lento >= 30
        if lento:
            self._ultimo_giro_lento = adesso
        nuovi = {}
        for s in leggi_servizi():
            stato, dettaglio, interruttore = self._stato(s, lento)
            nuovi[s["id"]] = {"stato": stato, "dettaglio": dettaglio, "interruttore": interruttore}
        with self.blocco:
            self.stati = nuovi

    def leggi(self):
        with self.blocco:
            return dict(self.stati)


def comanda(servizio, acceso):
    """Accende o spegne un servizio. Restituisce (riuscito, messaggio)."""
    tipo = servizio.get("tipo")
    if tipo == "pihole":
        riuscito, testo = esegui(["pihole", "enable" if acceso else "disable"], attesa=30)
        return riuscito, "" if riuscito else "Pi-hole non ha accettato il comando. Riprova tra poco."
    if tipo == "unita":
        unita = str(servizio.get("unita", ""))
        if unita not in unita_consentite():
            return False, "Questo servizio non si può comandare dall'hub."
        segno = segnaposto(servizio["id"])
        try:
            if acceso:
                if os.path.exists(segno):
                    os.remove(segno)
            else:
                with open(segno, "w", encoding="utf-8") as f:
                    f.write(time.strftime("%Y-%m-%d %H:%M:%S\n"))
                os.chmod(segno, 0o644)
        except OSError:
            return False, "Non riesco a salvare lo stato del servizio sul Raspberry."
        richiede = servizio.get("richiede")
        if acceso and richiede and not os.path.exists(richiede):
            return True, ""
        riuscito, testo = esegui(["systemctl", "--no-ask-password", "start" if acceso else "stop", unita], attesa=60)
        if not riuscito and not servizio.get("facoltativa"):
            return False, "Il Raspberry non è riuscito ad " + ("avviare" if acceso else "fermare") + " il servizio."
        return True, ""
    return False, "Questo servizio non ha un interruttore."


def tipo_immagine(dati):
    if dati[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if dati[:3] == b"\xff\xd8\xff":
        return "jpg"
    if dati[:4] == b"RIFF" and dati[8:12] == b"WEBP":
        return "webp"
    return None


def salva_icona(icona):
    """Salva l'immagine caricata e restituisce il suo indirizzo (/icone/...). Solleva ValueError con un messaggio."""
    try:
        dati = base64.b64decode(str(icona.get("dati", "")), validate=True)
    except (binascii.Error, ValueError, AttributeError):
        raise ValueError("L'immagine non è arrivata intera. Riprova a caricarla.")
    if not dati:
        raise ValueError("L'immagine è vuota.")
    if len(dati) > ICONA_MAX:
        raise ValueError("L'immagine supera i 512 KB. Scegline una più piccola.")
    estensione = tipo_immagine(dati)
    if not estensione:
        raise ValueError("Formato non accettato. Usa un'immagine PNG, JPEG o WebP.")
    nome = f"{secrets.token_hex(8)}.{estensione}"
    percorso = os.path.join(DIR_ICONE, nome)
    with open(percorso, "wb") as f:
        f.write(dati)
    os.chmod(percorso, 0o644)
    return f"/icone/{nome}"


def togli_icona(indirizzo):
    nome = os.path.basename(str(indirizzo or ""))
    if re.fullmatch(r"[0-9a-f]{16}\.(png|jpg|webp)", nome):
        try:
            os.remove(os.path.join(DIR_ICONE, nome))
        except OSError:
            pass


def campi_servizio(corpo, esistente=None):
    """Controlla i campi di un collegamento. Restituisce il dizionario pronto o solleva ValueError."""
    nome = " ".join(str(corpo.get("nome", "")).split())
    descrizione = " ".join(str(corpo.get("descrizione", "")).split())
    url = str(corpo.get("url", "")).strip()
    if not 1 <= len(nome) <= 40:
        raise ValueError("Scrivi un nome di al massimo 40 caratteri.")
    if len(descrizione) > 80:
        raise ValueError("La descrizione può avere al massimo 80 caratteri.")
    if not URL_VALIDO.match(url):
        raise ValueError("L'indirizzo deve iniziare con http://, https:// oppure con / per una pagina di questo Raspberry.")
    servizio = dict(esistente or {})
    servizio.update(nome=nome, descrizione=descrizione, url=url, tipo="link", aggiunto=True)
    if isinstance(corpo.get("icona"), dict):
        nuova = salva_icona(corpo["icona"])
        togli_icona(servizio.get("icona"))
        servizio["icona"] = nuova
    return servizio


# =========================================================================== attivita' e DNS
class Registro(threading.Thread):
    """Riceve da Caddy una riga JSON per ogni richiesta e tiene, solo in memoria, l'ultimo minuto."""

    def __init__(self):
        super().__init__(daemon=True)
        self.blocco = threading.Lock()
        self.eventi = deque(maxlen=60000)          # (istante, prima parte del percorso)

    def run(self):
        presa = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            presa.bind(("127.0.0.1", PORTA_REGISTRO))
        except OSError as errore:
            print(f"registro: porta {PORTA_REGISTRO} non disponibile ({errore})", flush=True)
            return
        while True:
            dati, _ = presa.recvfrom(65535)
            adesso = time.monotonic()
            for riga in dati.splitlines():
                try:
                    uri = json.loads(riga).get("request", {}).get("uri", "")
                except (ValueError, AttributeError):
                    continue
                sezione = uri.split("?", 1)[0].strip("/").split("/", 1)[0]
                with self.blocco:
                    self.eventi.append((adesso, sezione))

    def al_minuto(self):
        limite = time.monotonic() - 60
        conti = {}
        with self.blocco:
            for istante, sezione in reversed(self.eventi):
                if istante < limite:
                    break
                conti[sezione] = conti.get(sezione, 0) + 1
        return conti


def a_monte():
    """A chi chiede Unbound: Quad9 in DNS cifrato, oppure direttamente i server radice."""
    testo = leggi(FILE_UNBOUND)
    nomi = re.findall(r"forward-addr:\s*\S+#(\S+)", testo)
    if not nomi:
        return {"nome": "Server radice", "cifrato": False}
    nome = nomi[0]
    for chiave, leggibile in (("quad9", "Quad9"), ("cloudflare", "Cloudflare"), ("google", "Google")):
        if chiave in nome.lower():
            nome = leggibile
    return {"nome": nome, "cifrato": bool(re.search(r"forward-tls-upstream:\s*yes", testo))}


class StatisticheDns(threading.Thread):
    """Ogni 30 secondi legge il riepilogo di Pi-hole: richieste, bloccate, cache, inoltrate."""
    PASSO = 30

    def __init__(self):
        super().__init__(daemon=True)
        self.blocco = threading.Lock()
        self.dati = None
        self.sid = None
        self._prima = None

    def _chiama(self, metodo, percorso, corpo=None):
        richiesta = urllib.request.Request(
            API_PIHOLE + percorso, method=metodo,
            data=json.dumps(corpo).encode() if corpo is not None else None,
            headers={"Content-Type": "application/json", **({"X-FTL-SID": self.sid} if self.sid else {})})
        with urllib.request.urlopen(richiesta, timeout=10) as risposta:
            testo = risposta.read()
            return json.loads(testo) if testo else None

    def _accedi(self):
        password = leggi(FILE_CLI_PW).strip()
        if not password:
            raise RuntimeError("password interna di Pi-hole non leggibile")
        self.sid = None
        self.sid = self._chiama("POST", "/auth", {"password": password})["session"]["sid"]

    def _riepilogo(self):
        if not self.sid:
            self._accedi()
        try:
            return self._chiama("GET", "/stats/summary")
        except urllib.error.HTTPError as errore:
            if errore.code != 401:
                raise
            self._accedi()                         # sessione scaduta o Pi-hole riavviato
            return self._chiama("GET", "/stats/summary")

    def _aggiorna(self):
        riepilogo = self._riepilogo()
        q = riepilogo["queries"]
        adesso = time.monotonic()
        al_minuto = round(float(q.get("frequency") or 0) * 60)
        if self._prima and q["total"] >= self._prima[1] and adesso - self._prima[0] >= 10:
            al_minuto = round((q["total"] - self._prima[1]) / (adesso - self._prima[0]) * 60)
        self._prima = (adesso, q["total"])
        dati = {
            "al_minuto": al_minuto,
            "totale": q["total"], "bloccate": q["blocked"],
            "percentuale_bloccate": round(float(q["percent_blocked"]), 1),
            "dalla_cache": q["cached"], "inoltrate": q["forwarded"],
            "client": (riepilogo.get("clients") or {}).get("active"),
            "domini_bloccati": (riepilogo.get("gravity") or {}).get("domains_being_blocked"),
            "a_monte": a_monte(),
        }
        with self.blocco:
            self.dati = dati

    def run(self):
        while True:
            try:
                self._aggiorna()
            except Exception as errore:            # Pi-hole spento o in riavvio: si riprova al giro dopo
                print(f"dns: {errore!r}", flush=True)
                self.sid = None
                with self.blocco:
                    self.dati = None
            time.sleep(self.PASSO)

    def leggi(self):
        with self.blocco:
            return dict(self.dati) if self.dati else None

    def chiudi(self):
        if self.sid:
            try:
                self._chiama("DELETE", "/auth")
            except (OSError, ValueError):
                pass


def attivita_servizio(servizio, conti, dns):
    """Visite al minuto di un servizio (per Pi-hole: richieste DNS al minuto). None se non si puo' sapere."""
    if servizio.get("tipo") == "pihole":
        return dns["al_minuto"] if dns else None
    if servizio.get("id") == "mappe":
        return sum(conti.get(sezione, 0) for sezione in ("tiles", "cerca", "mappe"))
    url = str(servizio.get("url", ""))
    if url.startswith("/"):
        return conti.get(url.split("#", 1)[0].strip("/").split("/", 1)[0], 0)
    return None                                    # collegamento a un altro dispositivo: non passa da qui


# =========================================================================== accesso
class Accessi:
    def __init__(self):
        self.blocco = threading.Lock()
        self.sessioni = self._carica()   # impronta del gettone -> {"utente", "creata", "rinnovata"}
        self.errori = {}                 # indirizzo -> [quanti, bloccato_fino_a]

    @staticmethod
    def _impronta_gettone(gettone):
        return hashlib.sha256(str(gettone).encode()).hexdigest()

    @staticmethod
    def _carica():
        try:
            with open(FILE_SESSIONI, encoding="utf-8") as f:
                dati = json.load(f)
            return {k: v for k, v in dati.items() if isinstance(v, dict) and v.get("utente")}
        except (OSError, ValueError, AttributeError):
            return {}

    def _salva(self):
        """Da chiamare con il blocco preso. Scrittura atomica, leggibile solo dal servizio."""
        try:
            provvisorio = FILE_SESSIONI + ".tmp"
            with open(os.open(provvisorio, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
                json.dump(self.sessioni, f)
            os.replace(provvisorio, FILE_SESSIONI)
        except OSError as errore:
            print(f"sessioni: non salvate ({errore})", flush=True)

    @staticmethod
    def credenziali():
        try:
            with open(FILE_CRED, encoding="utf-8") as f:
                cred = json.load(f)
            return cred if cred.get("utente") and cred.get("hash") and cred.get("salt") else None
        except (OSError, ValueError, AttributeError):
            return None

    @staticmethod
    def impronta(password, salt, n=16384, r=8, p=1, lunghezza=32):
        return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=lunghezza, maxmem=64 * 1024 * 1024)

    def password_giusta(self, cred, password):
        try:
            atteso = base64.b64decode(cred["hash"])
            calcolato = self.impronta(password, base64.b64decode(cred["salt"]), int(cred.get("n", 16384)),
                                      int(cred.get("r", 8)), int(cred.get("p", 1)), len(atteso))
        except (ValueError, KeyError, binascii.Error):
            return False
        return hmac.compare_digest(calcolato, atteso)

    def bloccato_per(self, indirizzo):
        with self.blocco:
            voce = self.errori.get(indirizzo)
            if voce and voce[1] > time.time():
                return int(voce[1] - time.time()) + 1
            return 0

    def entra(self, indirizzo, utente, password):
        """(gettone, None) se le credenziali sono giuste, altrimenti (None, tentativi rimasti)."""
        cred = self.credenziali()
        giuste = bool(cred) and hmac.compare_digest(str(utente).encode(), str(cred["utente"]).encode()) \
            and self.password_giusta(cred, str(password))
        with self.blocco:
            if giuste:
                self.errori.pop(indirizzo, None)
                gettone = secrets.token_urlsafe(32)
                adesso = time.time()
                # via le sessioni mai usate da oltre 400 giorni e, se sono troppe, le piu' vecchie
                self.sessioni = {k: v for k, v in self.sessioni.items() if adesso - v.get("rinnovata", 0) < COOKIE_S}
                for k in sorted(self.sessioni, key=lambda k: self.sessioni[k].get("rinnovata", 0))[:-(SESSIONI_MAX - 1)]:
                    del self.sessioni[k]
                self.sessioni[self._impronta_gettone(gettone)] = {"utente": cred["utente"], "creata": round(adesso),
                                                                   "rinnovata": round(adesso)}
                self._salva()
                return gettone, None
            voce = self.errori.setdefault(indirizzo, [0, 0.0])
            if voce[1] and voce[1] <= time.time():
                voce[0], voce[1] = 0, 0.0
            voce[0] += 1
            if voce[0] >= ERRORI_MAX:
                voce[0], voce[1] = 0, time.time() + BLOCCO_S
                return None, 0
            return None, ERRORI_MAX - voce[0]

    def utente(self, gettone):
        if not gettone:
            return None
        with self.blocco:
            voce = self.sessioni.get(self._impronta_gettone(gettone))
            return voce["utente"] if voce else None

    def da_rinnovare(self, gettone):
        """True una volta al giorno per sessione: e' il momento di rimandare il cookie con la durata piena."""
        if not gettone:
            return False
        with self.blocco:
            voce = self.sessioni.get(self._impronta_gettone(gettone))
            if not voce or time.time() - voce.get("rinnovata", 0) < RINNOVO_S:
                return False
            voce["rinnovata"] = round(time.time())
            self._salva()
            return True

    def esci(self, gettone, tranne_questa=False):
        with self.blocco:
            impronta = self._impronta_gettone(gettone or "")
            if tranne_questa:
                self.sessioni = {k: v for k, v in self.sessioni.items() if k == impronta}
            else:
                self.sessioni.pop(impronta, None)
            self._salva()

    def cambia_password(self, cred, nuova):
        salt = secrets.token_bytes(16)
        cred = dict(cred, salt=base64.b64encode(salt).decode(), n=16384, r=8, p=1,
                    hash=base64.b64encode(self.impronta(nuova, salt)).decode())
        with open(FILE_CRED, "w", encoding="utf-8") as f:       # scrive sul posto: il file resta root:hubctl 660
            json.dump(cred, f)
            f.write("\n")


monitor = Monitor()
sorvegliante = Sorvegliante()
accessi = Accessi()
registro = Registro()
statistiche = StatisticheDns()


# =========================================================================== HTTP
class Richiesta(BaseHTTPRequestHandler):
    server_version = "hub-control"
    protocol_version = "HTTP/1.1"

    def log_message(self, *argomenti):
        pass

    def rispondi(self, codice, corpo, intestazioni=()):
        dati = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codice)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(dati)))
        self.send_header("Cache-Control", "no-store")
        for nome, valore in intestazioni:
            self.send_header(nome, valore)
        self.end_headers()
        self.wfile.write(dati)

    def errore(self, codice, sigla, messaggio, **altro):
        self.rispondi(codice, {"errore": sigla, "messaggio": messaggio, **altro})

    def indirizzo(self):
        inoltrato = self.headers.get("X-Forwarded-For", "").split(",")[-1].strip()
        return inoltrato or self.client_address[0]

    def gettone(self):
        for pezzo in self.headers.get("Cookie", "").split(";"):
            nome, _, valore = pezzo.strip().partition("=")
            if nome == "hub_sessione":
                return valore
        return None

    def cookie(self, gettone, durata):
        return ("Set-Cookie", f"hub_sessione={gettone}; Path=/controllo; Max-Age={durata}; HttpOnly; SameSite=Strict"
                + ("; Secure" if COOKIE_SICURO else ""))

    def corpo(self):
        """Il corpo JSON della richiesta, oppure None dopo aver gia' risposto con un errore."""
        if self.headers.get("X-Hub") != "1":
            self.errore(403, "richiesta_esterna", "Richiesta non accettata.")
            return None
        origine = self.headers.get("Origin")
        if origine and urlparse(origine).netloc != self.headers.get("Host", ""):
            self.errore(403, "richiesta_esterna", "Richiesta non accettata.")
            return None
        try:
            lunghezza = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            lunghezza = -1
        if lunghezza < 0 or lunghezza > CORPO_MAX:
            self.close_connection = True
            self.errore(413, "troppo_grande", "Richiesta troppo grande.")
            return None
        try:
            dati = json.loads(self.rfile.read(lunghezza) or b"{}")
        except ValueError:
            self.errore(400, "non_valida", "Richiesta non valida.")
            return None
        if not isinstance(dati, dict):
            self.errore(400, "non_valida", "Richiesta non valida.")
            return None
        return dati

    def serve_accesso(self):
        utente = accessi.utente(self.gettone())
        if not utente:
            self.errore(401, "accesso_richiesto", "Accedi per continuare.")
        return utente

    def percorso(self):
        parti = [p for p in urlparse(self.path).path.split("/") if p]
        return parti[1:] if parti[:1] == ["controllo"] else None

    # ------------------------------------------------------------------ GET
    def do_GET(self):
        parti = self.percorso()
        if parti == ["stato"]:
            gettone = self.gettone()
            utente = accessi.utente(gettone)
            rinnovo = [self.cookie(gettone, COOKIE_S)] if utente and accessi.da_rinnovare(gettone) else []
            conti, dns = registro.al_minuto(), statistiche.leggi()
            elenco = {s["id"]: s for s in leggi_servizi()}
            servizi = {ident: {**vivo, "attivita": attivita_servizio(elenco.get(ident, {"id": ident}), conti, dns)}
                       for ident, vivo in sorvegliante.leggi().items()}
            return self.rispondi(200, {"ora": round(time.time()), "autenticato": bool(utente), "utente": utente,
                                       "configurato": accessi.credenziali() is not None,
                                       "servizi": servizi, "dns": dns}, rinnovo)
        if parti == ["sistema"]:
            return self.rispondi(200, monitor.adesso())
        if parti == ["sistema", "storico"]:
            return self.rispondi(200, monitor.storico())
        self.errore(404, "non_trovato", "Pagina non trovata.")

    # ------------------------------------------------------------------ POST
    def do_POST(self):
        parti = self.percorso()
        if parti is None:
            return self.errore(404, "non_trovato", "Pagina non trovata.")
        dati = self.corpo()
        if dati is None:
            return None

        if parti == ["accesso"]:
            indirizzo = self.indirizzo()
            if accessi.credenziali() is None:
                return self.errore(503, "non_configurato",
                                   "La password dell'hub non è ancora stata impostata. Sul Raspberry lancia: sudo hub-control-setpass")
            attesa = accessi.bloccato_per(indirizzo)
            if attesa:
                return self.errore(429, "bloccato", "Troppi tentativi. Riprova più tardi.", secondi=attesa)
            gettone, rimasti = accessi.entra(indirizzo, dati.get("utente", ""), dati.get("password", ""))
            if gettone:
                return self.rispondi(200, {"ok": True, "utente": accessi.utente(gettone)},
                                     [self.cookie(gettone, COOKIE_S)])
            if rimasti == 0:
                return self.errore(429, "bloccato", "Troppi tentativi. Riprova più tardi.", secondi=BLOCCO_S)
            return self.errore(401, "credenziali", "Utente o password non corretti.", tentativi_rimasti=rimasti)

        if parti == ["uscita"]:
            accessi.esci(self.gettone())
            return self.rispondi(200, {"ok": True}, [self.cookie("", 0)])

        if not self.serve_accesso():
            return None

        if parti == ["password"]:
            cred = accessi.credenziali()
            nuova = str(dati.get("nuova", ""))
            if not cred or not accessi.password_giusta(cred, str(dati.get("attuale", ""))):
                return self.errore(403, "password_attuale", "La password attuale non è corretta.")
            if len(nuova) < 8:
                return self.errore(400, "password_corta", "La nuova password deve avere almeno 8 caratteri.")
            try:
                accessi.cambia_password(cred, nuova)
            except OSError:
                return self.errore(500, "non_salvata", "Non riesco a salvare la password sul Raspberry.")
            accessi.esci(self.gettone(), tranne_questa=True)
            return self.rispondi(200, {"ok": True})

        if len(parti) == 3 and parti[0] == "servizi" and parti[2] == "interruttore":
            servizio = next((s for s in leggi_servizi() if s["id"] == parti[1]), None)
            if not servizio:
                return self.errore(404, "non_trovato", "Servizio non trovato.")
            if not isinstance(dati.get("acceso"), bool):
                return self.errore(400, "non_valida", "Richiesta non valida.")
            riuscito, messaggio = comanda(servizio, dati["acceso"])
            sorvegliante.aggiorna()
            if not riuscito:
                return self.errore(502, "comando_fallito", messaggio, servizi=sorvegliante.leggi())
            return self.rispondi(200, {"ok": True, "servizi": sorvegliante.leggi()})

        if parti == ["servizi"] or (len(parti) == 2 and parti[0] == "servizi"):
            with blocco_servizi:
                elenco = leggi_servizi()
                esistente = None
                if len(parti) == 2:
                    esistente = next((s for s in elenco if s["id"] == parti[1]), None)
                    if not esistente or not esistente.get("aggiunto"):
                        return self.errore(404, "non_trovato", "Questo servizio non si può modificare dall'hub.")
                elif sum(1 for s in elenco if s.get("aggiunto")) >= 40:
                    return self.errore(400, "troppi", "Hai raggiunto il massimo di 40 servizi aggiunti.")
                try:
                    servizio = campi_servizio(dati, esistente)
                except ValueError as problema:
                    return self.errore(400, "campo", str(problema))
                except OSError:
                    return self.errore(500, "non_salvato", "Non riesco a salvare l'immagine sul Raspberry.")
                if esistente:
                    elenco = [servizio if s["id"] == servizio["id"] else s for s in elenco]
                else:
                    servizio["id"] = "u-" + secrets.token_hex(4)
                    elenco.append(servizio)
                try:
                    scrivi_servizi(elenco)
                except OSError:
                    return self.errore(500, "non_salvato", "Non riesco a salvare l'elenco dei servizi sul Raspberry.")
            sorvegliante.aggiorna()
            return self.rispondi(200, {"ok": True, "servizio": servizio})

        self.errore(404, "non_trovato", "Pagina non trovata.")

    # ------------------------------------------------------------------ DELETE
    def do_DELETE(self):
        parti = self.percorso()
        if parti is None or len(parti) != 2 or parti[0] != "servizi":
            return self.errore(404, "non_trovato", "Pagina non trovata.")
        if self.corpo() is None:
            return None
        if not self.serve_accesso():
            return None
        with blocco_servizi:
            elenco = leggi_servizi()
            servizio = next((s for s in elenco if s["id"] == parti[1]), None)
            if not servizio or not servizio.get("aggiunto"):
                return self.errore(404, "non_trovato", "Questo servizio non si può rimuovere dall'hub.")
            try:
                scrivi_servizi([s for s in elenco if s["id"] != parti[1]])
            except OSError:
                return self.errore(500, "non_salvato", "Non riesco a salvare l'elenco dei servizi sul Raspberry.")
            togli_icona(servizio.get("icona"))
        sorvegliante.aggiorna()
        self.rispondi(200, {"ok": True})


def main():
    monitor.start()
    sorvegliante.start()
    registro.start()
    statistiche.start()

    def termina(*_):
        statistiche.chiudi()                       # non lasciare sessioni aperte in Pi-hole
        os._exit(0)

    signal.signal(signal.SIGTERM, termina)
    signal.signal(signal.SIGINT, termina)
    server = ThreadingHTTPServer(("127.0.0.1", PORTA), Richiesta)
    server.daemon_threads = True
    print(f"hub-control in ascolto su 127.0.0.1:{PORTA}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
