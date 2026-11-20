#!/usr/bin/env python3
"""Upgrades raspberry-hub to a published release, from the Raspberry Pi alone.

    sudo hub-install.sh upgrade              the latest release
    sudo hub-install.sh upgrade 2.1.0        a given release
    sudo hub-install.sh upgrade --yes        no questions (the "Update" button of the hub runs it like this)

Downloads raspberry-hub-X.Y.Z.tar.gz and SHA256SUMS from the GitHub release, checks the checksum, unpacks the
package into ~/pi-setup/hub (as deploy.ps1 -Update does) and runs its own hub-install.sh, so the new version
installs itself and converts what changed. Before a new major version it shows the matching section of the
upgrade notes and asks for confirmation. At the end it checks that the hub answers with the new version.

Only one upgrade at a time, never during a content update, and only with enough free space. Pre-releases
are never installed, and neither are versions older than the installed one. Progress goes to
/srv/hub/state/upgrade.json, which the hub reads while an upgrade runs. Standard library only.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

try:
    import fcntl
    import pwd
except ImportError:            # not on Linux: only the tests that need neither run there
    fcntl = pwd = None

REPO = "Dxz0-96/raspberry-hub"
# Every location can be moved with an environment variable: the tests use a fake release and folders.
API = os.environ.get("HUB_RELEASES_API", f"https://api.github.com/repos/{REPO}/releases")
DOWNLOAD = os.environ.get("HUB_RELEASES_DOWNLOAD", f"https://github.com/{REPO}/releases/download")
LIB = os.environ.get("HUB_LIB", "/usr/local/lib/raspberry-hub")
HUB_DIR = os.environ.get("HUB_DIR", "/srv/hub")
STATE = os.path.join(HUB_DIR, "state")
PROGRESS = os.path.join(STATE, "upgrade.json")
LOG = os.path.join(STATE, "upgrade.log")
LOCK = os.environ.get("HUB_UPGRADE_LOCK", "/run/hub-upgrade.lock")
CONTROL_URL = os.environ.get("HUB_CONTROL_URL", "http://127.0.0.1:8083/control/status")
CHECK = os.environ.get("HUB_CHECK", "/usr/local/sbin/hub-check.sh")
FREE_BYTES = 200 * 1024 * 1024        # the package (a few MB), the site unpacked twice, and headroom
SEMVER = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


class Refused(Exception):
    """The upgrade cannot start or stopped: code for the hub, message for the terminal."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def version(text):
    """(2, 1, 0) for "2.1.0" or "v2.1.0"; None for anything else, pre-releases included."""
    match = SEMVER.match((text or "").strip())
    return tuple(int(x) for x in match.groups()) if match else None


def installed_version():
    try:
        with open(os.path.join(LIB, "VERSION"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def fetch(url, timeout=60):
    request = urllib.request.Request(url, headers={"User-Agent": "raspberry-hub-upgrade",
                                                   "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def release(wanted=None):
    """The release to install: {"version", "url", "notes"}. The latest one unless a version is given."""
    try:
        data = json.loads(fetch(f"{API}/latest" if not wanted else f"{API}/tags/v{wanted}"))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise Refused("not_found", f"There is no release {wanted or ''} on GitHub.".replace("  ", " ")) from None
        raise Refused("offline", f"GitHub did not answer ({error.code}).") from None
    except (OSError, ValueError) as error:
        raise Refused("offline", f"GitHub cannot be reached ({error}).") from None
    tag = str(data.get("tag_name", ""))
    if data.get("prerelease") or data.get("draft") or not version(tag):
        raise Refused("not_found", f"{tag or wanted} is not a published release.")
    return {"version": tag.lstrip("v"), "url": data.get("html_url", ""), "notes": data.get("body") or ""}


class Progress:
    """/srv/hub/state/upgrade.json: what the hub shows while the upgrade runs."""

    def __init__(self, target, current):
        self.data = {"version": target, "from": current, "step": "start", "result": None, "error": None,
                     "warning": None, "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "updated": None}

    def step(self, name, result=None, error=None, warning=None):
        """name: download, verify, install, check, then done or failed. error and warning are codes."""
        self.data.update(step=name, result=result, error=error, warning=warning,
                         updated=time.strftime("%Y-%m-%dT%H:%M:%S%z"))
        try:
            os.makedirs(STATE, exist_ok=True)
            temporary = PROGRESS + ".tmp"
            with open(temporary, "w", encoding="utf-8") as f:
                json.dump(self.data, f)
            os.chmod(temporary, 0o644)
            os.replace(temporary, PROGRESS)
        except OSError:
            pass                                   # the upgrade itself does not depend on it
        print(f"== {name}" + (f": {result}" if result else ""), flush=True)


def admin_user():
    """Whoever owns the website: the same user deploy.ps1 copies it as (sudo leaves SUDO_USER)."""
    name = os.environ.get("ADMIN_USER") or os.environ.get("SUDO_USER")
    if name and name != "root":
        return name
    try:
        return pwd.getpwuid(os.stat(os.path.join(HUB_DIR, "site")).st_uid).pw_name
    except (OSError, KeyError):
        raise Refused("no_admin", "Cannot tell which user the hub belongs to: run it with sudo from that user.") from None


def package_folder(admin):
    return os.environ.get("HUB_HOME") or os.path.join(pwd.getpwnam(admin).pw_dir, "pi-setup", "hub")


def upgrade_notes(folder, major):
    """The section of UPGRADING.md (docs/upgrading.md) about moving to the given major version."""
    try:
        with open(os.path.join(folder, "UPGRADING.md"), encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return ""
    match = re.search(rf"^## [^\n]*\bto {major}\.0\b.*?(?=^## |\Z)", text, re.M | re.S)
    return match.group(0).strip() if match else ""


def check_space(folder):
    probe = folder
    while not os.path.exists(probe):
        probe = os.path.dirname(probe)
    if shutil.disk_usage(probe).free < FREE_BYTES:
        raise Refused("no_space", f"Not enough free space: {FREE_BYTES // 1048576} MB are needed.")


def check_not_busy():
    try:
        running = [f for f in os.listdir(STATE) if f.endswith(".running")]
    except OSError:
        running = []
    if running:
        raise Refused("content_update_running", "A content update is running: try again when it has finished.")


def download(target, work):
    name = f"raspberry-hub-{target}.tar.gz"
    path = os.path.join(work, name)
    try:
        with open(path, "wb") as f:
            f.write(fetch(f"{DOWNLOAD}/v{target}/{name}", timeout=600))
        sums = fetch(f"{DOWNLOAD}/v{target}/SHA256SUMS").decode("utf-8", "replace")
    except (OSError, ValueError) as error:
        raise Refused("download_failed", f"The package of {target} could not be downloaded ({error}).") from None
    return path, sums


def verify(path, sums):
    name = os.path.basename(path)
    expected = next((line.split()[0] for line in sums.splitlines()
                     if len(line.split()) == 2 and line.split()[1].lstrip("*") == name), "")
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    if not re.fullmatch(r"[0-9a-f]{64}", expected) or digest.hexdigest() != expected:
        raise Refused("checksum_mismatch", "The package does not match its published SHA-256: not installed.")


def unpack(path, target, folder, admin):
    """Unpacks the package over the folder, keeping files that are not in it (as deploy.ps1 does)."""
    top = f"raspberry-hub-{target}"
    with tempfile.TemporaryDirectory(dir=os.path.dirname(path)) as work:
        with tarfile.open(path, "r:gz") as archive:
            if any(m.name != top and not m.name.startswith(top + "/") for m in archive.getmembers()):
                raise Refused("bad_package", f"The package does not contain only {top}/: not installed.")
            archive.extractall(work, filter="data")
        source = os.path.join(work, top)
        if not os.path.isfile(os.path.join(source, "hub-install.sh")):
            raise Refused("bad_package", "The package has no hub-install.sh: not installed.")
        os.makedirs(folder, exist_ok=True)
        shutil.copytree(source, folder, dirs_exist_ok=True)
    try:
        account = pwd.getpwnam(admin)
        for base, dirs, files in os.walk(folder):
            for name in [base, *(os.path.join(base, n) for n in dirs + files)]:
                os.chown(name, account.pw_uid, account.pw_gid)
    except (OSError, KeyError, AttributeError):
        pass                                       # not root (the tests): the files stay the caller's


def run_logged(command, env=None):
    """Runs a command, its output both on the terminal and in /srv/hub/state/upgrade.log."""
    with open(LOG, "a", encoding="utf-8") as log:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                   errors="replace", env=env)
        for line in process.stdout:
            sys.stdout.write(line)
            log.write(line)
            log.flush()
        return process.wait()


def answering_version(timeout):
    """The version hub-control reports once it answers again (it restarts during the installation)."""
    end = time.time() + timeout
    while time.time() < end:
        try:
            return json.loads(fetch(CONTROL_URL, timeout=5)).get("version")
        except (OSError, ValueError):
            time.sleep(3)
    return None


def upgrade(args):
    current = installed_version()
    if not version(current):
        raise Refused("not_installed", "raspberry-hub is not installed here yet: install it with hub-install.sh.")
    if args.version and not version(args.version):
        raise Refused("not_found", f"{args.version} is not a version (for example 2.1.0).")
    wanted = args.version.lstrip("v") if args.version else None
    found = release(wanted)
    target = found["version"]
    if version(target) == version(current):
        print(f"raspberry-hub {current} is already installed.")
        return 0
    if version(target) < version(current):
        raise Refused("not_newer", f"{target} is older than the installed {current}: not installing it.")

    admin = admin_user()
    folder = package_folder(admin)
    check_not_busy()
    check_space(folder)
    progress = Progress(target, current)
    os.makedirs(STATE, exist_ok=True)
    with open(LOG, "w", encoding="utf-8") as log:
        log.write(f"raspberry-hub {current} -> {target}, {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    try:
        with tempfile.TemporaryDirectory(dir=os.path.dirname(folder) if os.path.isdir(os.path.dirname(folder))
                                         else None) as work:
            progress.step("download")
            path, sums = download(target, work)
            progress.step("verify")
            verify(path, sums)
            if version(target)[0] > version(current)[0] and not args.yes:
                with tarfile.open(path, "r:gz") as archive:
                    archive.extractall(work, filter="data")
                notes = upgrade_notes(os.path.join(work, f"raspberry-hub-{target}"), version(target)[0])
                print(f"\n{target} is a new major version: read what changes before going on.\n")
                print(notes or f"See {found['url']} and docs/upgrading.md.")
                try:
                    if not sys.stdin.isatty():
                        raise EOFError
                    answer = input(f"\nUpgrade from {current} to {target}? [y/N] ")
                except EOFError:                   # nobody to ask (the hub, a script)
                    raise Refused("confirmation_needed",
                                  "A new major version needs a confirmation: run it again with --yes.") from None
                if answer.strip().lower() not in ("y", "yes"):
                    raise Refused("cancelled", "Nothing changed.")
            progress.step("install")
            unpack(path, target, folder, admin)
        bash = shutil.which("bash") or "/bin/bash"
        code = run_logged([bash, os.path.join(folder, "hub-install.sh"), "all"], {**os.environ, "ADMIN_USER": admin})
        if code != 0:
            raise Refused("install_failed", f"hub-install.sh stopped with code {code}: see {LOG}.")
        progress.step("check")
        answered = answering_version(180)
        if answered != target:
            raise Refused("check_failed", f"The hub answers with version {answered or 'none'} instead of {target}.")
        if os.path.exists(CHECK) and run_logged([CHECK, "--wait"]) != 0:
            progress.step("done", "ok", warning="check_failed")
            print(f"raspberry-hub {target} installed; hub-check.sh reports problems: see above.")
            return 0
        progress.step("done", "ok")
        print(f"raspberry-hub {target} installed.")
        return 0
    except Refused as problem:
        progress.step("failed", f"error: {problem}", problem.code)
        raise
    except Exception as problem:               # never leave the hub waiting on a step that will not end
        progress.step("failed", f"error: {problem!r}", "internal_error")
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("version", nargs="?", help="the version to install (default: the latest release)")
    parser.add_argument("--yes", action="store_true", help="no questions, also before a new major version")
    args = parser.parse_args()
    if os.environ.get("HUB_UPGRADE_ANY_USER") != "1" and os.geteuid() != 0:
        print("Run it with sudo.", file=sys.stderr)
        return 1
    lock = None
    try:
        if fcntl:
            lock = open(LOCK, "w")
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise Refused("upgrade_running", "Another upgrade is already running.") from None
        return upgrade(args)
    except Refused as problem:
        print(f"ERROR: {problem}", file=sys.stderr)
        return 1
    finally:
        if lock:
            lock.close()


if __name__ == "__main__":
    sys.exit(main())
