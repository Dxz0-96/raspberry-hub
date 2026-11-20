#!/usr/bin/env python3
"""raspberry-hub: service status and switches, services added from the hub, hardware monitor.

No login required (anyone on the LAN):
    GET  /control/status                state of every service (with visits per minute), session, DNS, version
    GET  /control/system                hardware readings right now
    GET  /control/system/history        last hour (one point every 5 s) and last 24 hours (one per minute)
    GET  /control/system/history?period=month   last 30 days (one point per hour, average and peak)
    GET  /control/upgrade               installed version, latest release found by the daily check, upgrade progress
    POST /control/login                 {username, password} -> session cookie
Login required:
    POST   /control/logout
    POST   /control/password            {current, new}
    POST   /control/services/<id>/switch   {on: true|false}
    POST   /control/upgrade             {version}   starts the upgrade to the latest release (hub-upgrade@.service)
    POST   /control/services            {name, description, url, icon?}   adds a link
    POST   /control/services/<id>       same as above, edits a link added from the hub
    DELETE /control/services/<id>       removes a link added from the hub

Errors are JSON: {"error": <machine-readable code>, "message": <English text>, ...extra}. The hub
translates the code; the message is only a fallback.

Runs as the "hubctl" user, without sudo. It can start and stop only the units listed in
/etc/hub-control/allowed-units (the same list as the polkit rule) and run "pihole enable/disable"
because it is in the "pihole" group. Standard library only. Listens on 127.0.0.1: Caddy publishes it.

Service activity: Caddy sends one line per request over UDP to 127.0.0.1:8084; this counts how many
arrive per minute for each section (wiki, tiles, ...), in memory only.
DNS statistics: read every 30 seconds from the Pi-hole API (127.0.0.1:8080) with its internal password
/etc/pihole/cli_pw, readable by the "pihole" group. Read-only; the session is closed on exit.
"""
import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("HUB_CONTROL_PORT", "8083"))
HUB_DIR = os.environ.get("HUB_DIR", "/srv/hub")
SERVICES_FILE = os.path.join(HUB_DIR, "config", "services.json")
ICONS_DIR = os.path.join(HUB_DIR, "icons")
STATE_DIR = os.environ.get("HUB_CONTROL_STATE", "/var/lib/hub-control")
CREDENTIALS_FILE = os.environ.get("HUB_CONTROL_CREDENTIALS", "/etc/hub-control/credentials.json")
ALLOWED_UNITS_FILE = os.environ.get("HUB_CONTROL_UNITS", "/etc/hub-control/allowed-units")
SESSIONS_FILE = os.path.join(STATE_DIR, "sessions.json")    # token hashes only, never the tokens
MONTH_FILE = os.path.join(STATE_DIR, "history-month.json")  # the hourly history, so a restart does not empty it
MONTH_DAYS = 30
INTERFACE = os.environ.get("HUB_IFACE", "eth0")
DISK = os.environ.get("HUB_DISK", "mmcblk0")
SECURE_COOKIE = os.environ.get("HUB_INSECURE_COOKIE") != "1"      # "1" only for testing over plain HTTP
LOG_PORT = int(os.environ.get("HUB_LOG_PORT", "8084"))
PIHOLE_API = os.environ.get("HUB_PIHOLE_API", "http://127.0.0.1:8080/api")
CLI_PW_FILE = os.environ.get("HUB_PIHOLE_CLI_PW", "/etc/pihole/cli_pw")
UNBOUND_FILE = "/etc/unbound/unbound.conf.d/forward-dot.conf"
# written next to this script by hub-install.sh: the version of the Raspberry Pi side of the hub
VERSION_FILE = os.environ.get("HUB_VERSION_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "VERSION"))
# written as root by hub-update.sh check-version (daily) and by hub-upgrade.py: read only here
LATEST_FILE = os.path.join(HUB_DIR, "state", "latest.json")
UPGRADE_FILE = os.path.join(HUB_DIR, "state", "upgrade.json")
UPGRADE_FREE_BYTES = 200 * 1024 * 1024
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")

# A session stays valid until "Log out": the cookie lasts 400 days (the most browsers accept) and is
# renewed once a day while the hub is in use. Sessions survive reboots.
COOKIE_SECONDS = 400 * 86400
RENEW_SECONDS = 86400
MAX_SESSIONS = 50
MAX_FAILURES = 5
LOCKOUT_SECONDS = 300
MAX_BODY = 1_100_000
MAX_ICON = 512 * 1024
MAX_ADDED_SERVICES = 40
CLOCK_TICKS = os.sysconf("SC_CLK_TCK")
NCPU = os.cpu_count() or 1
VALID_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
VALID_TOKEN = re.compile(r"[A-Za-z0-9_-]{32,64}")
# http.server writes response headers exactly as given: a CR or LF in one would split the response.
UNSAFE_HEADER = re.compile(r"[\x00-\x1f\x7f]")
VALID_URL = re.compile(r"^(https?://[^\s<>\"'\\]{3,280}|/[^\s<>\"'\\]{0,280})$")


def read_text(path, default=""):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return default


def run(command, timeout=20):
    """(succeeded, output). Never raises: a missing command is just a failure."""
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        return result.returncode == 0, (result.stdout + result.stderr).strip()
    except (OSError, subprocess.SubprocessError) as error:
        return False, str(error)


# =========================================================================== hardware monitor
class Monitor(threading.Thread):
    """Samples /proc and /sys every 5 seconds and keeps the history in memory. Only the hourly history of the
    last month is written to disk (MONTH_FILE), when the service stops and at most once a day: the SD card is
    never written in the sampling loop, and a power cut loses at most a day of it."""
    STEP = 5

    def __init__(self):
        super().__init__(daemon=True)
        self.lock = threading.Lock()
        self.latest = {}
        self.recent = deque(maxlen=720)           # one hour at one point every 5 s: [time, cpu, temp]
        self.day = deque(maxlen=1440)             # 24 hours at one point per minute: [time, cpu, temp, mem, load]
        # 30 days at one point per hour, from every 5 s sample of that hour, so a short spike stays visible:
        # [start of the hour, cpu average, cpu peak, temp average, temp peak] (temperatures null if unknown)
        self.month = deque(maxlen=MONTH_DAYS * 24)
        self._minute = []
        self._hour = None
        self._saved = time.time()
        self._save_lock = threading.Lock()         # the daily save and the one at stop never write together
        self._power = (0.0, None)
        self._content = (0.0, {})
        self.model = read_text("/proc/device-tree/model").strip("\x00\n ") or "Raspberry Pi"
        self.hostname = socket.gethostname()
        self.load_month()

    @staticmethod
    def _cpu():
        values = {}
        for line in read_text("/proc/stat").splitlines():
            if not line.startswith("cpu"):
                break
            fields = line.split()
            numbers = [int(x) for x in fields[1:9]]
            values[fields[0]] = (sum(numbers), numbers[3] + numbers[4])
        return values

    @staticmethod
    def _processes():
        times = {}
        for entry in os.listdir("/proc"):
            if not entry.isdigit():
                continue
            data = read_text(f"/proc/{entry}/stat")
            end = data.rfind(")")
            if end < 0:
                continue
            fields = data[end + 2:].split()
            if len(fields) > 12:
                times[int(entry)] = (data[data.find("(") + 1:end], int(fields[11]) + int(fields[12]))
        return times

    @staticmethod
    def _network():
        for line in read_text("/proc/net/dev").splitlines():
            name, _, rest = line.partition(":")
            if name.strip() == INTERFACE:
                fields = rest.split()
                return int(fields[0]), int(fields[8])
        return 0, 0

    @staticmethod
    def _sectors():
        for line in read_text("/proc/diskstats").splitlines():
            fields = line.split()
            if len(fields) > 9 and fields[2] == DISK:
                return int(fields[5]) + int(fields[9])
        return 0

    @staticmethod
    def _ip_address():
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("192.0.2.1", 9))
                return s.getsockname()[0]
        except OSError:
            return ""

    def _read_power(self, now):
        when, value = self._power
        if now - when < 30:
            return value
        ok, output = run(["vcgencmd", "get_throttled"], timeout=5)
        match = re.search(r"0x([0-9a-fA-F]+)", output) if ok else None
        value = None
        if match:
            bits = int(match.group(1), 16)
            value = {"undervoltage": bool(bits & 0x1), "throttled": bool(bits & 0x6),
                     "undervoltage_past": bool(bits & 0x10000), "throttled_past": bool(bits & 0x60000)}
        self._power = (now, value)
        return value

    def _read_content(self, now):
        when, value = self._content
        if now - when < 60:
            return value

        def size(path):
            try:
                return os.path.getsize(os.path.realpath(path))
            except OSError:
                return 0
        zim_dir = os.path.join(HUB_DIR, "zim")
        zims = [os.path.join(zim_dir, f) for f in (os.listdir(zim_dir) if os.path.isdir(zim_dir) else [])
                if not os.path.islink(os.path.join(zim_dir, f))]
        value = {"wikipedia": sum(size(f) for f in zims),
                 "maps": size(os.path.join(HUB_DIR, "maps", "basemap.pmtiles")),
                 "addresses": size(os.path.join(HUB_DIR, "search", "addresses.db"))}
        self._content = (now, value)
        return value

    def run(self):
        cpu0, proc0, net0, sectors0, t0 = self._cpu(), self._processes(), self._network(), self._sectors(), time.monotonic()
        while True:
            time.sleep(self.STEP)
            try:
                cpu1, proc1, net1, sectors1, t1 = self._cpu(), self._processes(), self._network(), self._sectors(), time.monotonic()
                self._sample(cpu0, cpu1, proc0, proc1, net0, net1, sectors0, sectors1, t1 - t0)
                cpu0, proc0, net0, sectors0, t0 = cpu1, proc1, net1, sectors1, t1
            except Exception as error:                 # one bad sample must not stop the monitor
                print(f"monitor: {error!r}", flush=True)

    def _sample(self, cpu0, cpu1, proc0, proc1, net0, net1, sectors0, sectors1, dt):
        now = time.time()

        def usage(key):
            total = cpu1[key][0] - cpu0[key][0]
            return round(max(0.0, min(100.0, 100.0 * (1 - (cpu1[key][1] - cpu0[key][1]) / total))), 1) if total > 0 else 0.0

        cores = [usage(k) for k in sorted(cpu1) if k != "cpu" and k in cpu0]
        overall = usage("cpu") if "cpu" in cpu0 and "cpu" in cpu1 else 0.0
        load = [float(x) for x in read_text("/proc/loadavg").split()[:3]] or [0.0, 0.0, 0.0]
        try:
            temp = round(int(read_text("/sys/class/thermal/thermal_zone0/temp").strip()) / 1000, 1)
        except ValueError:
            temp = None
        try:
            mhz = round(int(read_text("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq").strip()) / 1000)
        except ValueError:
            mhz = None

        mem = {}
        for line in read_text("/proc/meminfo").splitlines():
            key, _, rest = line.partition(":")
            if key in ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree"):
                mem[key] = int(rest.split()[0]) * 1024
        mem_total = mem.get("MemTotal", 0)
        mem_used = mem_total - mem.get("MemAvailable", 0)

        try:
            fs = os.statvfs(HUB_DIR if os.path.isdir(HUB_DIR) else "/")
            disk_total, disk_used = fs.f_blocks * fs.f_frsize, (fs.f_blocks - fs.f_bfree) * fs.f_frsize
            disk_full = round(100 * (1 - fs.f_bavail / max(1, fs.f_blocks - fs.f_bfree + fs.f_bavail)), 1)
        except OSError:
            disk_total = disk_used = 0
            disk_full = 0.0

        ticks_by_name = {}
        for pid, (name, ticks) in proc1.items():
            before = proc0.get(pid)
            if before and before[0] == name and ticks >= before[1]:
                ticks_by_name[name] = ticks_by_name.get(name, 0) + ticks - before[1]
        processes = [{"name": n, "cpu": round(100.0 * t / CLOCK_TICKS / dt / NCPU, 1)}
                     for n, t in sorted(ticks_by_name.items(), key=lambda x: -x[1])[:5] if t > 0]

        power = self._read_power(now)
        alerts = []
        if temp is not None and temp >= 70:
            alerts.append("temperature")
        if disk_full >= 85:
            alerts.append("disk")
        if power and (power["undervoltage"] or power["throttled"]):
            alerts.append("power")
        if load[1] > NCPU:
            alerts.append("load")

        speed = read_text(f"/sys/class/net/{INTERFACE}/speed").strip()
        sample = {
            "time": round(now), "hostname": self.hostname, "model": self.model, "ip": self._ip_address(),
            "cpu": {"usage": overall, "cores": cores, "load": load, "mhz": mhz, "count": NCPU},
            "temp": temp,
            "mem": {"total": mem_total, "used": mem_used, "swap_total": mem.get("SwapTotal", 0),
                    "swap_used": mem.get("SwapTotal", 0) - mem.get("SwapFree", 0)},
            "disk": {"total": disk_total, "used": disk_used, "percent_full": disk_full,
                     "io_rate": round(max(0, sectors1 - sectors0) * 512 / dt),
                     "content": self._read_content(now)},
            "net": {"interface": INTERFACE, "rx": round(max(0, net1[0] - net0[0]) * 8 / dt),
                    "tx": round(max(0, net1[1] - net0[1]) * 8 / dt),
                    "link_up": read_text(f"/sys/class/net/{INTERFACE}/operstate").strip() == "up",
                    "mbit": int(speed) if speed.lstrip("-").isdigit() and int(speed) > 0 else None},
            "power": power,
            "uptime": round(float((read_text("/proc/uptime").split() or ["0"])[0])),
            "processes": processes, "alerts": alerts,
        }
        mem_percent = round(100.0 * mem_used / mem_total, 1) if mem_total else 0.0
        with self.lock:
            self.latest = sample
            self.recent.append([round(now), overall, temp])
            self._minute.append((overall, temp or 0.0, mem_percent, load[0]))
            if len(self._minute) >= 60 // self.STEP:
                n = len(self._minute)
                self.day.append([round(now)] + [round(sum(c[i] for c in self._minute) / n, 1) for i in range(4)])
                self._minute = []
        self.add_to_hour(now, overall, temp)

    # ------------------------------------------------------------------ last month
    def add_to_hour(self, now, cpu, temp):
        """Adds one sample to the hour it belongs to. When that closes the previous hour, the history is also
        saved if the last save is more than a day old: the safety net against a power cut."""
        hour = int(now // 3600)
        closed = False
        with self.lock:
            if self._hour and self._hour["hour"] != hour:
                point = self._hour_point(self._hour)
                if not self.month or point[0] > self.month[-1][0]:      # the clock may jump back at boot
                    self.month.append(point)
                self._hour = None
                closed = True
            if not self._hour:
                self._hour = {"hour": hour, "n": 0, "cpu": 0.0, "cpu_peak": 0.0, "temp_n": 0, "temp": 0.0,
                              "temp_peak": None}
            h = self._hour
            h["n"] += 1
            h["cpu"] += cpu
            h["cpu_peak"] = max(h["cpu_peak"], cpu)
            if temp is not None:
                h["temp_n"] += 1
                h["temp"] += temp
                h["temp_peak"] = temp if h["temp_peak"] is None else max(h["temp_peak"], temp)
        if closed and time.time() - self._saved >= 86400:
            self.save_month()

    @staticmethod
    def _hour_point(h):
        temp = round(h["temp"] / h["temp_n"], 1) if h["temp_n"] else None
        return [h["hour"] * 3600, round(h["cpu"] / h["n"], 1), round(h["cpu_peak"], 1), temp, h["temp_peak"]]

    @staticmethod
    def _valid_point(p):
        def number(v, nullable=False):
            return (v is None and nullable) or (isinstance(v, (int, float)) and not isinstance(v, bool))
        return (isinstance(p, list) and len(p) == 5 and isinstance(p[0], int) and not isinstance(p[0], bool)
                and number(p[1]) and number(p[2]) and number(p[3], True) and number(p[4], True))

    def load_month(self):
        """Reads the hourly history saved by the last run, without the points older than MONTH_DAYS. A missing
        or damaged file only means an empty history: it is rewritten when the service stops."""
        try:
            with open(MONTH_FILE, encoding="utf-8") as f:
                points = json.load(f).get("points", [])
        except FileNotFoundError:
            return
        except (OSError, ValueError, AttributeError) as error:
            print(f"monitor: the month history is not readable, starting empty ({error})", flush=True)
            return
        oldest = time.time() - MONTH_DAYS * 86400
        good = sorted((p for p in points if self._valid_point(p) and p[0] >= oldest), key=lambda p: p[0])
        with self.lock:
            for p in good:
                if not self.month or p[0] > self.month[-1][0]:
                    self.month.append(p)

    def save_month(self):
        """Writes the completed hours to MONTH_FILE (about 30 KB), replacing it in one step."""
        with self._save_lock:
            with self.lock:
                points = list(self.month)
                self._saved = time.time()
            temporary = MONTH_FILE + ".tmp"
            try:
                with open(temporary, "w", encoding="utf-8") as f:
                    json.dump({"step": 3600, "points": points}, f, separators=(",", ":"))
                os.replace(temporary, MONTH_FILE)
            except OSError as error:
                print(f"monitor: could not save the month history: {error}", flush=True)

    def current(self):
        with self.lock:
            return dict(self.latest)

    def history(self, period=""):
        with self.lock:
            if period == "month":
                oldest = time.time() - MONTH_DAYS * 86400
                points = [p for p in self.month if p[0] >= oldest]
                if self._hour and self._hour["n"]:                         # the hour so far
                    current = self._hour_point(self._hour)
                    if not points or current[0] > points[-1][0]:
                        points.append(current)
                return {"month": {"step": 3600, "points": points}}
            return {"recent": {"step": self.STEP, "points": list(self.recent)},
                    "day": {"step": 60, "points": list(self.day)}}


# =========================================================================== new versions
def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def semver(text):
    match = SEMVER.match(str(text or ""))
    return tuple(int(x) for x in match.groups()) if match else None


def upgrade_status():
    """What the hub needs for the notice and the "Update" button."""
    installed = read_text(VERSION_FILE).strip() or None
    latest = read_json(LATEST_FILE)
    latest = latest if isinstance(latest, dict) and semver(latest.get("version")) else None
    progress = read_json(UPGRADE_FILE)
    return {"installed": installed, "latest": latest,
            "newer": bool(latest and semver(installed) and semver(latest["version"]) > semver(installed)),
            "progress": progress if isinstance(progress, dict) else None}


def upgrade_running(progress):
    """An upgrade that has not ended and wrote in the last 2 hours (a reboot in the middle ends it)."""
    if not progress or progress.get("step") in (None, "done", "failed"):
        return False
    try:
        return time.time() - os.path.getmtime(UPGRADE_FILE) < 7200
    except OSError:
        return False


def start_upgrade(version):
    """(HTTP status, code, English message). Only the latest release found by the daily check is accepted:
    never a string or an address from the request, which is only compared with it."""
    info = upgrade_status()
    latest = info["latest"]
    if not latest or str(version) != latest["version"]:
        return 400, "not_latest", "Only the latest release found by the daily check can be installed."
    if not semver(info["installed"]):
        return 409, "version_unknown", "The installed version is unknown: update with sudo hub-install.sh upgrade."
    if not info["newer"]:
        return 409, "up_to_date", "This version is already installed."
    if upgrade_running(info["progress"]):
        return 409, "upgrade_running", "An update is already running."
    try:
        running = [f for f in os.listdir(os.path.join(HUB_DIR, "state")) if f.endswith(".running")]
    except OSError:
        running = []
    if running:
        return 409, "content_update_running", "Wikipedia, the maps or the addresses are being updated: try again later."
    if shutil.disk_usage("/").free < UPGRADE_FREE_BYTES:
        return 507, "no_space", "Not enough free space on the Raspberry Pi for the update."
    ok, _ = run(["systemctl", "--no-ask-password", "--no-block", "start", f"hub-upgrade@{latest['version']}.service"],
                timeout=30)
    if not ok:
        return 502, "upgrade_not_started", "The Raspberry Pi could not start the update."
    return 202, "", ""


# =========================================================================== services
services_lock = threading.Lock()


def read_services():
    try:
        with open(SERVICES_FILE, encoding="utf-8") as f:
            services = json.load(f).get("services", [])
        return [s for s in services if isinstance(s, dict) and VALID_ID.match(str(s.get("id", "")))]
    except (OSError, ValueError, AttributeError):
        return []


def write_services(services):
    temporary = SERVICES_FILE + ".tmp"
    with open(temporary, "w", encoding="utf-8") as f:
        json.dump({"services": services}, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.chmod(temporary, 0o664)
    os.replace(temporary, SERVICES_FILE)


def allowed_units():
    return {line.strip() for line in read_text(ALLOWED_UNITS_FILE).splitlines()
            if line.strip() and not line.startswith("#")}


def off_marker(ident):
    return os.path.join(STATE_DIR, f"{ident}.off")


def probe_target(service):
    """(host, port) to probe for a link, or None when there is nothing to check."""
    address = service.get("check") or service.get("url") or ""
    if not re.match(r"^(https?|tcp)://", address):
        return None
    parts = urlparse(address)
    if not parts.hostname:
        return None
    return parts.hostname, parts.port or (443 if parts.scheme == "https" else 80)


class Watcher(threading.Thread):
    """Keeps service states up to date: units and Pi-hole every 5 s, links every 30 s.

    Each state is (state, detail, has_switch[, host]). "detail" is a machine-readable code the hub
    translates; "" means there is nothing to add."""

    def __init__(self):
        super().__init__(daemon=True)
        self.lock = threading.Lock()
        self.states = {}
        self._links = {}
        self._last_slow_round = 0.0
        self.wake = threading.Event()

    def run(self):
        while True:
            try:
                self.refresh()
            except Exception as error:
                print(f"watcher: {error!r}", flush=True)
            self.wake.wait(5)
            self.wake.clear()

    def _state(self, s, slow):
        kind = s.get("type", "link")
        ident = s["id"]
        if kind == "pihole":
            running, _ = run(["systemctl", "is-active", "--quiet", "pihole-FTL.service"], timeout=5)
            if not running:
                return {"state": "error", "detail": "pihole_not_running", "switch": False}
            ok, output = run(["pihole-FTL", "--config", "dns.blocking.active"], timeout=5)
            if not ok:
                return {"state": "unknown", "detail": "blocking_unreadable", "switch": True}
            if output.strip().lower() == "true":
                return {"state": "on", "detail": "", "switch": True}
            return {"state": "paused", "detail": "", "switch": True}
        if kind == "unit":
            unit = str(s.get("unit", ""))
            controllable = unit in allowed_units()
            if os.path.exists(off_marker(ident)):
                return {"state": "off", "detail": "", "switch": controllable}
            requires = s.get("requires")
            if requires and not os.path.exists(requires):
                return {"state": "missing", "detail": "", "switch": False}
            active, _ = run(["systemctl", "is-active", "--quiet", unit], timeout=5)
            if active:
                return {"state": "on", "detail": "", "switch": controllable}
            if s.get("optional"):
                return {"state": "on", "detail": str(s.get("optional_detail", "")), "switch": controllable}
            return {"state": "error", "detail": "unit_not_running", "switch": controllable}
        target = probe_target(s)
        if target is None:
            return {"state": "on", "detail": "", "switch": False}
        if slow or ident not in self._links:
            try:
                socket.create_connection(target, timeout=2).close()
                self._links[ident] = {"state": "on", "detail": ""}
            except OSError:
                self._links[ident] = {"state": "unreachable", "detail": "no_response", "host": target[0]}
        return {**self._links[ident], "switch": False}

    def refresh(self):
        now = time.monotonic()
        slow = now - self._last_slow_round >= 30
        if slow:
            self._last_slow_round = now
        states = {s["id"]: self._state(s, slow) for s in read_services()}
        with self.lock:
            self.states = states

    def read(self):
        with self.lock:
            return dict(self.states)


def switch(service, on):
    """Turns a service on or off. Returns (succeeded, reason code, English message)."""
    kind = service.get("type")
    if kind == "pihole":
        ok, _ = run(["pihole", "enable" if on else "disable"], timeout=30)
        return (True, "", "") if ok else (False, "pihole_rejected", "Pi-hole did not accept the command. Try again shortly.")
    if kind == "unit":
        unit = str(service.get("unit", ""))
        if unit not in allowed_units():
            return False, "not_controllable", "This service cannot be controlled from the hub."
        marker = off_marker(service["id"])
        try:
            if on:
                if os.path.exists(marker):
                    os.remove(marker)
            else:
                with open(marker, "w", encoding="utf-8") as f:
                    f.write(time.strftime("%Y-%m-%d %H:%M:%S\n"))
                os.chmod(marker, 0o644)
        except OSError:
            return False, "state_not_saved", "Could not save the service state on the Raspberry Pi."
        requires = service.get("requires")
        if on and requires and not os.path.exists(requires):
            return True, "", ""
        ok, _ = run(["systemctl", "--no-ask-password", "start" if on else "stop", unit], timeout=60)
        if not ok and not service.get("optional"):
            if on:
                return False, "start_failed", "The Raspberry Pi could not start the service."
            return False, "stop_failed", "The Raspberry Pi could not stop the service."
        return True, "", ""
    return False, "no_switch", "This service has no switch."


class FieldError(ValueError):
    """A field of an added service is not valid: code for the hub, message as an English fallback."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def image_type(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def save_icon(icon):
    """Saves the uploaded image and returns its address (/icons/...). Raises FieldError."""
    try:
        data = base64.b64decode(str(icon.get("data", "")), validate=True)
    except (binascii.Error, ValueError, AttributeError):
        raise FieldError("icon_incomplete", "The image did not arrive in one piece. Try uploading it again.")
    if not data:
        raise FieldError("icon_empty", "The image is empty.")
    if len(data) > MAX_ICON:
        raise FieldError("icon_too_large", "The image is larger than 512 KB. Pick a smaller one.")
    extension = image_type(data)
    if not extension:
        raise FieldError("icon_format", "Format not accepted. Use a PNG, JPEG or WebP image.")
    name = f"{secrets.token_hex(8)}.{extension}"
    path = os.path.join(ICONS_DIR, name)
    with open(path, "wb") as f:
        f.write(data)
    os.chmod(path, 0o644)
    return f"/icons/{name}"


def remove_icon(address):
    name = os.path.basename(str(address or ""))
    if re.fullmatch(r"[0-9a-f]{16}\.(png|jpg|webp)", name):
        try:
            os.remove(os.path.join(ICONS_DIR, name))
        except OSError:
            pass


def service_fields(body, existing=None):
    """Validates the fields of a link. Returns the finished dictionary or raises FieldError."""
    name = " ".join(str(body.get("name", "")).split())
    description = " ".join(str(body.get("description", "")).split())
    url = str(body.get("url", "")).strip()
    if not 1 <= len(name) <= 40:
        raise FieldError("invalid_name", "Enter a name of at most 40 characters.")
    if len(description) > 80:
        raise FieldError("invalid_description", "The description can be at most 80 characters long.")
    if not VALID_URL.match(url):
        raise FieldError("invalid_url", "The address must start with http://, https:// or / for a page on this Raspberry Pi.")
    service = dict(existing or {})
    service.update(name=name, description=description, url=url, type="link", added=True)
    if isinstance(body.get("icon"), dict):
        new_icon = save_icon(body["icon"])
        remove_icon(service.get("icon"))
        service["icon"] = new_icon
    return service


# =========================================================================== activity and DNS
class RequestLog(threading.Thread):
    """Receives one JSON line from Caddy for every request and keeps the last minute, in memory only."""

    def __init__(self):
        super().__init__(daemon=True)
        self.lock = threading.Lock()
        self.events = deque(maxlen=60000)          # (instant, first path segment)

    def run(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.bind(("127.0.0.1", LOG_PORT))
        except OSError as error:
            print(f"request log: port {LOG_PORT} not available ({error})", flush=True)
            return
        while True:
            data, _ = sock.recvfrom(65535)
            now = time.monotonic()
            for line in data.splitlines():
                try:
                    uri = json.loads(line).get("request", {}).get("uri", "")
                except (ValueError, AttributeError):
                    continue
                section = uri.split("?", 1)[0].strip("/").split("/", 1)[0]
                with self.lock:
                    self.events.append((now, section))

    def per_minute(self):
        limit = time.monotonic() - 60
        counts = {}
        with self.lock:
            for instant, section in reversed(self.events):
                if instant < limit:
                    break
                counts[section] = counts.get(section, 0) + 1
        return counts


def upstream():
    """Who Unbound asks: Quad9 over encrypted DNS, or the root servers directly."""
    text = read_text(UNBOUND_FILE)
    names = re.findall(r"forward-addr:\s*\S+#(\S+)", text)
    if not names:
        return {"name": "root_servers", "encrypted": False}
    name = names[0]
    for key, readable in (("quad9", "Quad9"), ("cloudflare", "Cloudflare"), ("google", "Google")):
        if key in name.lower():
            name = readable
    return {"name": name, "encrypted": bool(re.search(r"forward-tls-upstream:\s*yes", text))}


class DnsStats(threading.Thread):
    """Every 30 seconds reads the Pi-hole summary: queries, blocked, cached, forwarded."""
    STEP = 30

    def __init__(self):
        super().__init__(daemon=True)
        self.lock = threading.Lock()
        self.data = None
        self.sid = None
        self._previous = None

    def _call(self, method, path, body=None):
        request = urllib.request.Request(
            PIHOLE_API + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json", **({"X-FTL-SID": self.sid} if self.sid else {})})
        with urllib.request.urlopen(request, timeout=10) as response:
            text = response.read()
            return json.loads(text) if text else None

    def _login(self):
        password = read_text(CLI_PW_FILE).strip()
        if not password:
            raise RuntimeError("Pi-hole internal password not readable")
        self.sid = None
        self.sid = self._call("POST", "/auth", {"password": password})["session"]["sid"]

    def _summary(self):
        if not self.sid:
            self._login()
        try:
            return self._call("GET", "/stats/summary")
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise
            self._login()                          # session expired or Pi-hole restarted
            return self._call("GET", "/stats/summary")

    def _refresh(self):
        summary = self._summary()
        q = summary["queries"]
        now = time.monotonic()
        per_minute = round(float(q.get("frequency") or 0) * 60)
        if self._previous and q["total"] >= self._previous[1] and now - self._previous[0] >= 10:
            per_minute = round((q["total"] - self._previous[1]) / (now - self._previous[0]) * 60)
        self._previous = (now, q["total"])
        data = {
            "per_minute": per_minute,
            "total": q["total"], "blocked": q["blocked"],
            "percent_blocked": round(float(q["percent_blocked"]), 1),
            "cached": q["cached"], "forwarded": q["forwarded"],
            "clients": (summary.get("clients") or {}).get("active"),
            "blocked_domains": (summary.get("gravity") or {}).get("domains_being_blocked"),
            "upstream": upstream(),
        }
        with self.lock:
            self.data = data

    def run(self):
        while True:
            try:
                self._refresh()
            except Exception as error:             # Pi-hole stopped or restarting: retry on the next round
                print(f"dns: {error!r}", flush=True)
                self.sid = None
                with self.lock:
                    self.data = None
            time.sleep(self.STEP)

    def read(self):
        with self.lock:
            return dict(self.data) if self.data else None

    def close(self):
        if self.sid:
            try:
                self._call("DELETE", "/auth")
            except (OSError, ValueError):
                pass


def service_activity(service, counts, dns):
    """Visits per minute to a service (for Pi-hole: DNS queries per minute). None when unknown."""
    if service.get("type") == "pihole":
        return dns["per_minute"] if dns else None
    if service.get("id") == "maps":
        return sum(counts.get(section, 0) for section in ("tiles", "search", "maps"))
    url = str(service.get("url", ""))
    if url.startswith("/"):
        return counts.get(url.split("#", 1)[0].strip("/").split("/", 1)[0], 0)
    return None                                    # a link to another device: its traffic does not pass here


# =========================================================================== login
class Sessions:
    def __init__(self):
        self.lock = threading.Lock()
        self.sessions = self._load()   # token hash -> {"user", "created", "renewed"}
        self.failures = {}             # address -> [count, locked_until]

    @staticmethod
    def _token_hash(token):
        return hashlib.sha256(str(token).encode()).hexdigest()

    @staticmethod
    def _load():
        try:
            with open(SESSIONS_FILE, encoding="utf-8") as f:
                data = json.load(f)
            return {k: v for k, v in data.items() if isinstance(v, dict) and v.get("user")}
        except (OSError, ValueError, AttributeError):
            return {}

    def _save(self):
        """Call with the lock held. Atomic write, readable by the service only."""
        try:
            temporary = SESSIONS_FILE + ".tmp"
            with open(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
                json.dump(self.sessions, f)
            os.replace(temporary, SESSIONS_FILE)
        except OSError as error:
            print(f"sessions: not saved ({error})", flush=True)

    @staticmethod
    def credentials():
        try:
            with open(CREDENTIALS_FILE, encoding="utf-8") as f:
                credentials = json.load(f)
            ok = credentials.get("username") and credentials.get("hash") and credentials.get("salt")
            return credentials if ok else None
        except (OSError, ValueError, AttributeError):
            return None

    @staticmethod
    def derive(password, salt, n=16384, r=8, p=1, length=32):
        return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=length, maxmem=64 * 1024 * 1024)

    def password_matches(self, credentials, password):
        try:
            expected = base64.b64decode(credentials["hash"])
            computed = self.derive(password, base64.b64decode(credentials["salt"]), int(credentials.get("n", 16384)),
                                   int(credentials.get("r", 8)), int(credentials.get("p", 1)), len(expected))
        except (ValueError, KeyError, binascii.Error):
            return False
        return hmac.compare_digest(computed, expected)

    def locked_for(self, address):
        with self.lock:
            entry = self.failures.get(address)
            if entry and entry[1] > time.time():
                return int(entry[1] - time.time()) + 1
            return 0

    def login(self, address, username, password):
        """(token, None) when the credentials are right, otherwise (None, attempts left)."""
        credentials = self.credentials()
        right = bool(credentials) and hmac.compare_digest(str(username).encode(), str(credentials["username"]).encode()) \
            and self.password_matches(credentials, str(password))
        with self.lock:
            if right:
                self.failures.pop(address, None)
                token = secrets.token_urlsafe(32)
                now = time.time()
                # drop sessions unused for more than 400 days and, if there are too many, the oldest ones
                self.sessions = {k: v for k, v in self.sessions.items() if now - v.get("renewed", 0) < COOKIE_SECONDS}
                for k in sorted(self.sessions, key=lambda k: self.sessions[k].get("renewed", 0))[:-(MAX_SESSIONS - 1)]:
                    del self.sessions[k]
                self.sessions[self._token_hash(token)] = {"user": credentials["username"], "created": round(now),
                                                          "renewed": round(now)}
                self._save()
                return token, None
            entry = self.failures.setdefault(address, [0, 0.0])
            if entry[1] and entry[1] <= time.time():
                entry[0], entry[1] = 0, 0.0
            entry[0] += 1
            if entry[0] >= MAX_FAILURES:
                entry[0], entry[1] = 0, time.time() + LOCKOUT_SECONDS
                return None, 0
            return None, MAX_FAILURES - entry[0]

    def user(self, token):
        if not token:
            return None
        with self.lock:
            entry = self.sessions.get(self._token_hash(token))
            return entry["user"] if entry else None

    def due_for_renewal(self, token):
        """True once a day per session: time to send the cookie again with its full lifetime."""
        if not token:
            return False
        with self.lock:
            entry = self.sessions.get(self._token_hash(token))
            if not entry or time.time() - entry.get("renewed", 0) < RENEW_SECONDS:
                return False
            entry["renewed"] = round(time.time())
            self._save()
            return True

    def logout(self, token, all_but_this=False):
        with self.lock:
            token_hash = self._token_hash(token or "")
            if all_but_this:
                self.sessions = {k: v for k, v in self.sessions.items() if k == token_hash}
            else:
                self.sessions.pop(token_hash, None)
            self._save()

    def change_password(self, credentials, new_password):
        salt = secrets.token_bytes(16)
        credentials = dict(credentials, salt=base64.b64encode(salt).decode(), n=16384, r=8, p=1,
                           hash=base64.b64encode(self.derive(new_password, salt)).decode())
        with open(CREDENTIALS_FILE, "w", encoding="utf-8") as f:   # in place: the file stays root:hubctl 660
            json.dump(credentials, f)
            f.write("\n")


monitor = Monitor()
watcher = Watcher()
sessions = Sessions()
request_log = RequestLog()
dns_stats = DnsStats()


# =========================================================================== HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "hub-control"
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def reply(self, status, body, headers=()):
        # Every header is built from checked values (see cookie()); this is the last line of defence, in
        # one place, so that a header added later cannot split the response either.
        safe = []
        for name, value in headers:
            name, value = str(name), str(value)
            if UNSAFE_HEADER.search(name) or UNSAFE_HEADER.search(value):
                print(f"refused the response header {name!r}: it contains a control character", flush=True)
                return self.reply(500, {"error": "internal_error", "message": "Something went wrong on the Raspberry Pi."})
            safe.append((name, value))
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for name, value in safe:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def fail(self, status, code, message, **extra):
        self.reply(status, {"error": code, "message": message, **extra})

    def client_address_text(self):
        forwarded = self.headers.get("X-Forwarded-For", "").split(",")[-1].strip()
        return forwarded or self.client_address[0]

    def token(self):
        """The session token from the cookie, only if it has the shape of one (secrets.token_urlsafe):
        it is sent back in Set-Cookie when the session is renewed, so nothing else may get through."""
        for piece in self.headers.get("Cookie", "").split(";"):
            name, _, value = piece.strip().partition("=")
            if name == "hub_session":
                return value if VALID_TOKEN.fullmatch(value) else None
        return None

    def cookie(self, token, max_age):
        token = token if VALID_TOKEN.fullmatch(token or "") else ""
        return ("Set-Cookie", f"hub_session={token}; Path=/control; Max-Age={max_age}; HttpOnly; SameSite=Strict"
                + ("; Secure" if SECURE_COOKIE else ""))

    def body(self):
        """The JSON body of the request, or None after having already replied with an error."""
        if self.headers.get("X-Hub") != "1":
            self.fail(403, "foreign_request", "Request not accepted.")
            return None
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host", ""):
            self.fail(403, "foreign_request", "Request not accepted.")
            return None
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self.close_connection = True
            self.fail(413, "too_large", "Request too large.")
            return None
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            self.fail(400, "invalid_request", "Invalid request.")
            return None
        if not isinstance(data, dict):
            self.fail(400, "invalid_request", "Invalid request.")
            return None
        return data

    def require_login(self):
        user = sessions.user(self.token())
        if not user:
            self.fail(401, "login_required", "Log in to continue.")
        return user

    def route(self):
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        return parts[1:] if parts[:1] == ["control"] else None

    # ------------------------------------------------------------------ GET
    def do_GET(self):
        parts = self.route()
        if parts == ["status"]:
            token = self.token()
            user = sessions.user(token)
            renewal = [self.cookie(token, COOKIE_SECONDS)] if user and sessions.due_for_renewal(token) else []
            counts, dns = request_log.per_minute(), dns_stats.read()
            by_id = {s["id"]: s for s in read_services()}
            services = {ident: {**live, "activity": service_activity(by_id.get(ident, {"id": ident}), counts, dns)}
                        for ident, live in watcher.read().items()}
            return self.reply(200, {"time": round(time.time()), "authenticated": bool(user), "user": user,
                                    "configured": sessions.credentials() is not None,
                                    "version": read_text(VERSION_FILE).strip() or None,
                                    "services": services, "dns": dns}, renewal)
        if parts == ["system"]:
            return self.reply(200, monitor.current())
        if parts == ["upgrade"]:
            return self.reply(200, upgrade_status())
        if parts == ["system", "history"]:
            # the month is asked for only while the hub shows it: the poll every minute stays light
            period = parse_qs(urlparse(self.path).query).get("period", [""])[0]
            if period not in ("", "month"):
                return self.fail(400, "invalid_request", "Invalid request.")
            return self.reply(200, monitor.history(period))
        self.fail(404, "not_found", "Page not found.")

    # ------------------------------------------------------------------ POST
    def do_POST(self):
        parts = self.route()
        if parts is None:
            return self.fail(404, "not_found", "Page not found.")
        data = self.body()
        if data is None:
            return None

        if parts == ["login"]:
            address = self.client_address_text()
            if sessions.credentials() is None:
                return self.fail(503, "not_configured",
                                 "The hub password has not been set yet. On the Raspberry Pi run: sudo hub-control-setpass")
            wait = sessions.locked_for(address)
            if wait:
                return self.fail(429, "locked", "Too many attempts. Try again later.", seconds=wait)
            token, attempts_left = sessions.login(address, data.get("username", ""), data.get("password", ""))
            if token:
                return self.reply(200, {"ok": True, "user": sessions.user(token)}, [self.cookie(token, COOKIE_SECONDS)])
            if attempts_left == 0:
                return self.fail(429, "locked", "Too many attempts. Try again later.", seconds=LOCKOUT_SECONDS)
            return self.fail(401, "bad_credentials", "Wrong username or password.", attempts_left=attempts_left)

        if parts == ["logout"]:
            sessions.logout(self.token())
            return self.reply(200, {"ok": True}, [self.cookie("", 0)])

        if not self.require_login():
            return None

        if parts == ["upgrade"]:
            status, code, message = start_upgrade(data.get("version"))
            if code:
                return self.fail(status, code, message)
            return self.reply(202, {"ok": True})

        if parts == ["password"]:
            credentials = sessions.credentials()
            new_password = str(data.get("new", ""))
            if not credentials or not sessions.password_matches(credentials, str(data.get("current", ""))):
                return self.fail(403, "wrong_password", "The current password is not correct.")
            if len(new_password) < 8:
                return self.fail(400, "password_too_short", "The new password must be at least 8 characters long.")
            try:
                sessions.change_password(credentials, new_password)
            except OSError:
                return self.fail(500, "not_saved", "Could not save the password on the Raspberry Pi.")
            sessions.logout(self.token(), all_but_this=True)
            return self.reply(200, {"ok": True})

        if len(parts) == 3 and parts[0] == "services" and parts[2] == "switch":
            service = next((s for s in read_services() if s["id"] == parts[1]), None)
            if not service:
                return self.fail(404, "not_found", "Service not found.")
            if not isinstance(data.get("on"), bool):
                return self.fail(400, "invalid_request", "Invalid request.")
            ok, reason, message = switch(service, data["on"])
            watcher.refresh()
            if not ok:
                return self.fail(502, reason, message, services=watcher.read())
            return self.reply(200, {"ok": True, "services": watcher.read()})

        if parts == ["services"] or (len(parts) == 2 and parts[0] == "services"):
            with services_lock:
                services = read_services()
                existing = None
                if len(parts) == 2:
                    existing = next((s for s in services if s["id"] == parts[1]), None)
                    if not existing or not existing.get("added"):
                        return self.fail(404, "not_editable", "This service cannot be edited from the hub.")
                elif sum(1 for s in services if s.get("added")) >= MAX_ADDED_SERVICES:
                    return self.fail(400, "too_many", "You have reached the limit of 40 added services.")
                try:
                    service = service_fields(data, existing)
                except FieldError as problem:
                    return self.fail(400, problem.code, str(problem))
                except OSError:
                    return self.fail(500, "icon_not_saved", "Could not save the image on the Raspberry Pi.")
                if existing:
                    services = [service if s["id"] == service["id"] else s for s in services]
                else:
                    service["id"] = "u-" + secrets.token_hex(4)
                    services.append(service)
                try:
                    write_services(services)
                except OSError:
                    return self.fail(500, "not_saved", "Could not save the list of services on the Raspberry Pi.")
            watcher.refresh()
            return self.reply(200, {"ok": True, "service": service})

        self.fail(404, "not_found", "Page not found.")

    # ------------------------------------------------------------------ DELETE
    def do_DELETE(self):
        parts = self.route()
        if parts is None or len(parts) != 2 or parts[0] != "services":
            return self.fail(404, "not_found", "Page not found.")
        if self.body() is None:
            return None
        if not self.require_login():
            return None
        with services_lock:
            services = read_services()
            service = next((s for s in services if s["id"] == parts[1]), None)
            if not service or not service.get("added"):
                return self.fail(404, "not_removable", "This service cannot be removed from the hub.")
            try:
                write_services([s for s in services if s["id"] != parts[1]])
            except OSError:
                return self.fail(500, "not_saved", "Could not save the list of services on the Raspberry Pi.")
            remove_icon(service.get("icon"))
        watcher.refresh()
        self.reply(200, {"ok": True})


def main():
    monitor.start()
    watcher.start()
    request_log.start()
    dns_stats.start()

    def stop(*_):
        monitor.save_month()                       # the one regular write of the history: when the service stops
        dns_stats.close()                          # do not leave sessions open in Pi-hole
        os._exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    print(f"hub-control listening on 127.0.0.1:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
