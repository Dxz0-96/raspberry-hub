# Security policy

## Supported versions

Only the latest release on `main` receives security fixes. Upgrade with `.\deploy.ps1 -Update` (see the
README).

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report them privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability** ([direct link](https://github.com/Dxz0-96/raspberry-hub/security/advisories/new)).
Include:

- what an attacker can do, and from where (same home network, a device on the network, the internet);
- the steps to reproduce it, and the version shown in the footer of the hub;
- any idea you have for a fix.

You will get an answer within 7 days. Once the problem is confirmed, a fix is prepared in a private fork,
released, and the advisory published with credit to you (unless you prefer otherwise).

## Scope and threat model

The hub is meant for a home network. It assumes the local network is not hostile, but it still defends the
parts that change the system:

- switches, password changes and added services require a login (scrypt password hash, lockout after 5
  wrong attempts, `HttpOnly` + `SameSite=Strict` + `Secure` session cookie, only token hashes stored);
- write requests must carry the `X-Hub: 1` header and a same-origin `Origin`;
- `hub-control.py` runs as an unprivileged user and can start or stop only the systemd units listed in
  `/etc/hub-control/allowed-units`, enforced by a polkit rule;
- uploaded icons are checked by content type, size-limited and served with a sandboxing Content Security Policy.

Exposing the hub to the internet is out of scope and not recommended.
