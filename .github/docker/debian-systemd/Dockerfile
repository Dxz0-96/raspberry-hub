# A Debian system with systemd, as close to a Raspberry Pi with Raspberry Pi OS (64-bit) / Debian as a container
# gets: used by .github/workflows/install.yml to run hub-install.sh for real. No Pi-hole, no vcgencmd: the
# scripts have to cope with that, as they do on other boards.
ARG DEBIAN=trixie
FROM debian:${DEBIAN}
ENV container=docker
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv dbus polkitd ca-certificates curl python3 \
      dnsutils procps hostname \
 && rm -rf /var/lib/apt/lists/* \
 # the user who installs the hub, and the group Pi-hole would create (hub-control.service joins it)
 && useradd --create-home --shell /bin/bash pi \
 && groupadd --system pihole
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
