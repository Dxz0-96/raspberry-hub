"use client";

import type { CSSProperties } from "react";
import { useHub } from "@/lib/hub";
import { bytesText, decimal } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/** The path of a DNS query at home, with the real numbers read from Pi-hole. */
function DnsPath() {
  const { dns } = useHub();
  const { t, locale } = useI18n();
  const count = (n: number) => decimal(n, locale, 0);
  const upstream = dns?.upstream.name === "root_servers" ? t.network.rootServers : dns?.upstream.name;
  const nodes = [
    {
      key: "devices",
      name: t.network.devices,
      value: dns ? count(dns.per_minute) : "–",
      detail: dns ? t.network.queriesPerMinute(dns.clients) : "",
    },
    { key: "router", name: t.network.router, detail: t.network.routerDetail, value: "" },
    {
      key: "pihole",
      name: "Pi-hole",
      value: dns ? `${decimal(dns.percent_blocked, locale)}%` : "–",
      detail: dns ? t.network.blockedFromCache(count(dns.cached)) : "",
      primary: true,
    },
    {
      key: "unbound",
      name: "Unbound",
      value: dns ? count(dns.forwarded) : "",
      detail: dns ? t.network.forwarded : t.network.cacheAndDnssec,
    },
    {
      key: "upstream",
      name: upstream ?? t.network.internet,
      detail: dns ? (dns.upstream.encrypted ? t.network.encryptedDns : t.network.directRecursion) : "",
      value: "",
    },
  ];
  return (
    <figure className="dns-path">
      <figcaption>{t.network.dnsCaption}</figcaption>
      <ol className="dns-path-nodes">
        {nodes.map((node) => (
          <li key={node.key} className={node.primary ? "primary" : undefined}>
            <span className="node-name">{node.name}</span>
            {node.value && <span className="node-value">{node.value}</span>}
            {node.detail && <span className="node-detail">{node.detail}</span>}
          </li>
        ))}
      </ol>
      <p className="diagram-note">
        {dns
          ? t.network.dnsSummary(count(dns.total), count(dns.blocked), count(dns.blocked_domains ?? 0))
          : t.network.dnsMissing}
      </p>
    </figure>
  );
}

/** How the disk of the content is used (the microSD, or a USB disk): system, Wikipedia, maps, address index,
 *  free space. */
function MicroSdBar() {
  const { system } = useHub();
  const { t, locale } = useI18n();
  if (!system) {
    return (
      <figure className="microsd">
        <figcaption>microSD</figcaption>
        <p className="diagram-note">{t.network.waiting}</p>
      </figure>
    );
  }
  const { total, used, content } = system.disk;
  const where = t.network.medium[system.disk.medium ?? "sd"] ?? t.network.medium.other;
  const contentTotal = content.wikipedia + content.maps + content.addresses;
  const segments = [
    { key: "system", name: t.network.system, bytes: Math.max(0, used - contentTotal) },
    { key: "wiki", name: t.network.wikipedia, bytes: content.wikipedia },
    { key: "maps", name: t.network.maps, bytes: content.maps },
    { key: "addresses", name: t.network.addresses, bytes: content.addresses },
    { key: "free", name: t.network.free, bytes: Math.max(0, total - used) },
  ];
  const size = (count: number) => bytesText(count, locale);
  const description = segments.map((s) => `${s.name} ${size(s.bytes)}`).join(", ");
  return (
    <figure className="microsd">
      <figcaption>
        <span>
          {where.charAt(0).toUpperCase() + where.slice(1)}
          {system.disk.medium && system.disk.medium !== "sd" && system.disk.device && (
            <span className="microsd-device"> {system.disk.device}</span>
          )}
        </span>
        <span className="microsd-total">{t.network.usedOf(size(used), size(total))}</span>
      </figcaption>
      <div className="storage-bar" role="img" aria-label={t.network.storageLabel(where, description)}>
        {segments
          .filter((s) => s.bytes > 0)
          .map((s) => (
            <span
              key={s.key}
              className={`storage-segment ${s.key}`}
              style={{ "--share": s.bytes / Math.max(1, total) } as CSSProperties}
              title={`${s.name}: ${size(s.bytes)}`}
            />
          ))}
      </div>
      <ul className="legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span className={`legend-swatch ${s.key}`} aria-hidden="true" />
            <span className="legend-name">{s.name}</span>
            <span className="legend-value">{size(s.bytes)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** The "Network and storage" section: the DNS path and the microSD. */
export function NetworkAndStorage() {
  const { t } = useI18n();
  return (
    <section className="network" aria-labelledby="network-title">
      <h2 id="network-title">{t.network.title}</h2>
      <div className="network-grid">
        <DnsPath />
        <MicroSdBar />
      </div>
    </section>
  );
}
