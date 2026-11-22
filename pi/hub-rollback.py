#!/usr/bin/env python3
"""The previous version of the hub, kept so that an upgrade can be undone.

    hub-rollback.py snapshot X.Y.Z       run by hub-install.sh before it installs X.Y.Z over another version
    sudo hub-install.sh rollback         puts the previous version back (hub-rollback.py restore)
    hub-rollback.py status               which version is kept, and since when

Before an upgrade changes anything (deploy.ps1 -Update, sudo hub-install.sh upgrade, the "Update" button of the
hub), the installer keeps the version being replaced in /var/lib/raspberry-hub/previous: its website, its scripts
and services, the Caddyfile and the settings the migrations may convert (/etc/hub.conf, the added services and
icons, the switch states, the password). A few MB; only the last version is kept. The downloaded content
(Wikipedia, maps, address index) is not copied: it stays as it is, and if the newer version changed it in a way
the older one cannot read, the rollback says which part "sudo hub-update.sh" should rebuild.

Running the same version again keeps the version already kept, so an upgrade run twice changes nothing.
The rollback stops the hub services, puts the files back (and removes the files the newer version added), turns
the services back on as they were, then runs hub-check.sh --wait. It refuses while an upgrade is running.

HUB_ROLLBACK_ROOT=/some/folder works on a copy of the file system instead of / and leaves systemd alone (tests).
Standard library only.
"""
import argparse
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import time

try:
    import fcntl
except ImportError:            # not on Linux: only the tests that need no lock run there
    fcntl = None

ROOT = os.environ.get("HUB_ROLLBACK_ROOT", "/")
TESTING = ROOT != "/"


def P(path):
    """An absolute path of the Raspberry Pi, inside ROOT."""
    return os.path.join(ROOT, path.lstrip("/"))


PREVIOUS = P("/var/lib/raspberry-hub/previous")
LIB = "/usr/local/lib/raspberry-hub"
LOCK = os.environ.get("HUB_UPGRADE_LOCK", "/run/hub-upgrade.lock")       # the same lock as hub-upgrade.py
# Folders that belong to the hub: put back as a whole, so files added by the newer version go.
FOLDERS = ["/srv/hub/site", LIB, "/srv/hub/config", "/srv/hub/icons", "/etc/hub-control", "/var/lib/hub-control"]
# Single files: the hub's, or changed by its migrations (monthly-update.sh of the pi-setup package).
FILES = ["/etc/hub.conf", "/etc/caddy/Caddyfile", "/etc/polkit-1/rules.d/50-hub-control.rules",
         "/etc/systemd/system.conf.d/hub-watchdog.conf", "/usr/local/sbin/monthly-update.sh"]
# The files of the hub in folders it shares with the system, found by their name.
SHARED = {"/usr/local/sbin": ["hub-*"],
          "/etc/systemd/system": ["hub-*.service", "hub-*.timer", "hub-*.path", "kiwix-hub.service"]}
# Downloaded content: not copied, only noted, to tell what a newer version changed (name -> hub-update.sh part).
CONTENT = {"/srv/hub/search/addresses.db": "addresses", "/srv/hub/maps/basemap.pmtiles": "maps"}
ZIM = "/srv/hub/zim"
# This unit runs the rollback started from the hub: removing it must not stop it.
SELF_UNIT = "hub-rollback.service"


def log(message):
    print(f"   {message}", flush=True)


def systemctl(*args):
    if TESTING:
        return True
    return subprocess.run(["systemctl", *args], capture_output=True, text=True).returncode == 0


def installed_version():
    try:
        with open(P(f"{LIB}/VERSION"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def manifest():
    try:
        with open(os.path.join(PREVIOUS, "manifest.json"), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) and re.fullmatch(r"\d+\.\d+\.\d+", str(data.get("version"))) else None
    except (OSError, ValueError):
        return None


def shared_files():
    """The files of the hub in the shared folders, as paths of the Raspberry Pi."""
    found = []
    for folder, patterns in SHARED.items():
        try:
            names = sorted(os.listdir(P(folder)))
        except OSError:
            continue
        for name in names:
            path = os.path.join(P(folder), name)
            if any(fnmatch.fnmatch(name, p) for p in patterns) and (os.path.isfile(path) or os.path.islink(path)):
                found.append(f"{folder}/{name}")
    return found


def units(paths):
    return [os.path.basename(p) for p in paths if p.startswith("/etc/systemd/system/")]


def enabled(unit):
    if TESTING or "@" in unit:
        return None
    result = subprocess.run(["systemctl", "is-enabled", unit], capture_output=True, text=True)
    return result.stdout.strip() or None


def content_now():
    """Name, modification time and size of the downloaded content, and where the Wikipedia links point."""
    notes = {}
    for path in CONTENT:
        try:
            stat = os.stat(P(path))
            notes[path] = [round(stat.st_mtime), stat.st_size]
        except OSError:
            pass
    try:
        for name in sorted(os.listdir(P(ZIM))):
            if re.fullmatch(r"wikipedia_[a-z][a-z-]*\.zim", name):
                notes[f"{ZIM}/{name}"] = os.readlink(P(f"{ZIM}/{name}")) if os.path.islink(P(f"{ZIM}/{name}")) else ""
    except OSError:
        pass
    return notes


# --------------------------------------------------------------------------- snapshot
def snapshot(new_version):
    current = installed_version()
    if not current:
        log("new installation: no earlier version to keep")
        return 0
    if current == new_version:
        kept = manifest()
        log(f"version {current} again: " + (f"version {kept['version']} stays kept for a rollback" if kept
                                             else "nothing to keep"))
        return 0
    paths = [p for p in FOLDERS + FILES if os.path.lexists(P(p))] + shared_files()
    work = PREVIOUS + ".new"
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, mode=0o755)
    # the password hash and the switch states are in it: only root reads the archive
    archive = os.path.join(work, "files.tar")
    with tarfile.open(archive, "w") as tar:
        os.chmod(archive, 0o600)
        for path in paths:
            tar.add(P(path), arcname=path.lstrip("/"))
    data = {"version": current, "replaced_by": new_version, "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "paths": paths, "units": {u: enabled(u) for u in units(paths)}, "content": content_now()}
    with open(os.path.join(work, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    os.chmod(os.path.join(work, "manifest.json"), 0o644)
    # only the last version is kept
    shutil.rmtree(PREVIOUS, ignore_errors=True)
    os.replace(work, PREVIOUS)
    size = os.path.getsize(os.path.join(PREVIOUS, "files.tar"))
    log(f"version {current} kept ({max(1, size // 1048576)} MB): sudo hub-install.sh rollback goes back to it")
    return 0


# --------------------------------------------------------------------------- restore
def remove(path):
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    elif os.path.lexists(path):
        os.remove(path)


def content_notes(data):
    """What the newer version changed in the downloaded content, and how to bring it in step if needed."""
    before, now = data.get("content", {}), content_now()
    notes = []
    for path, part in CONTENT.items():
        if path in before and path not in now:
            notes.append(f"{path} is gone since the upgrade: sudo hub-update.sh {part} makes it again")
        elif path in before and now.get(path) != before[path]:
            notes.append(f"{path} was rebuilt by version {data['replaced_by']}: it should keep working; if "
                         f"not, sudo hub-update.sh {part} rebuilds it as version {data['version']} does")
    for path in before:
        if path.startswith(ZIM) and path not in now:
            notes.append(f"{path} is gone since the upgrade: sudo hub-update.sh wiki downloads that edition again")
    return notes


def restore(yes):
    data = manifest()
    if not data:
        print("There is no previous version to go back to (one is kept by the next upgrade).", file=sys.stderr)
        return 1
    current = installed_version()
    if current == data["version"]:
        print(f"Version {current} is already the installed one.")
        return 0
    if not yes:
        try:
            if not sys.stdin.isatty():
                raise EOFError
            answer = input(f"Go back from {current or 'this version'} to {data['version']}, as it was on "
                           f"{data['time'][:16].replace('T', ' ')}? [y/N] ")
        except EOFError:
            print("Run it again with --yes to go back without the question.", file=sys.stderr)
            return 1
        if answer.strip().lower() not in ("y", "yes"):
            print("Nothing changed.")
            return 0

    print(f"== Going back to raspberry-hub {data['version']}", flush=True)
    systemctl("stop", "hub-control.service", "hub-search.service", "kiwix-hub.service")
    # files the newer version added in the shared folders: its units are turned off first
    keep = set(data["paths"])
    for path in shared_files():
        if path not in keep:
            unit = os.path.basename(path)
            if path.startswith("/etc/systemd/system/") and unit != SELF_UNIT and "@" not in unit:
                systemctl("disable", "--now", unit)
            remove(P(path))
            log(f"removed {path} (added by version {data['replaced_by']})")
    for path in FILES:
        if path not in keep and os.path.lexists(P(path)):
            remove(P(path))                                   # e.g. a watchdog setting the newer version wrote
    for path in FOLDERS:
        if path in keep:
            remove(P(path))
    with tarfile.open(os.path.join(PREVIOUS, "files.tar")) as tar:
        # "tar" keeps owners and permissions (run as root), and refuses paths outside ROOT
        tar.extractall(ROOT, filter="tar")
    log("website, scripts, services, Caddyfile and settings put back")

    systemctl("daemon-reload")
    for unit, state in data.get("units", {}).items():
        if state == "enabled":
            systemctl("enable", unit)
        elif state == "disabled":
            systemctl("disable", unit)
    if os.path.exists(P("/etc/systemd/system.conf.d/hub-watchdog.conf")) != ("/etc/systemd/system.conf.d/hub-watchdog.conf" in keep):
        systemctl("daemon-reexec")
    systemctl("restart", "hub-control.service")
    systemctl("start", "kiwix-hub.service", "hub-search.service")      # only if switched on and downloaded
    if not systemctl("reload", "caddy.service"):
        systemctl("try-restart", "caddy.service")
    for note in content_notes(data):
        log(f"NOTE: {note}")
    # used: the version it holds is the installed one now; the next upgrade keeps a new one
    shutil.rmtree(PREVIOUS, ignore_errors=True)
    print(f"== raspberry-hub {data['version']} is back. To install the newer version again: "
          "sudo hub-install.sh upgrade", flush=True)
    if not TESTING and os.path.exists("/usr/local/sbin/hub-check.sh"):
        subprocess.run(["/usr/local/sbin/hub-check.sh", "--wait", "--report", "/run/hub-check.json"])
    return 0


def status():
    data = manifest()
    if data:
        print(f"Version {data['version']} is kept (replaced by {data['replaced_by']} on {data['time'][:10]}): "
              "sudo hub-install.sh rollback goes back to it.")
    else:
        print("No previous version is kept.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["snapshot", "restore", "status"])
    parser.add_argument("version", nargs="?", help="with snapshot: the version about to be installed")
    parser.add_argument("--yes", action="store_true", help="restore without the question")
    args = parser.parse_args()
    if args.action == "status":
        return status()
    if not TESTING and os.geteuid() != 0:
        print("Run it with sudo.", file=sys.stderr)
        return 1
    if args.action == "snapshot":
        if not args.version:
            parser.error("snapshot needs the version about to be installed")
        return snapshot(args.version)
    lock = None
    try:
        if fcntl and not TESTING:
            lock = open(LOCK, "w")
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                print("An upgrade is running: go back when it has finished.", file=sys.stderr)
                return 1
        return restore(args.yes)
    finally:
        if lock:
            lock.close()


if __name__ == "__main__":
    sys.exit(main())
