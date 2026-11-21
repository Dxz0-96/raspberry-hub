// A pretend Raspberry Pi: the made-up readings, history and places that the mock (dev/mock-server.mjs) serves
// over HTTP and the demo on GitHub Pages (lib/demo.ts) answers in the browser. One place for both, so they
// cannot drift. Plain JavaScript without Node.js modules: it runs in the browser too.

/** A smooth made-up reading around base, so the charts look alive. */
export function wave(t, base, amplitude) {
  return base + amplitude * (0.5 + 0.5 * Math.sin(t / 380)) + (Math.sin(t / 47) + Math.sin(t / 13)) * amplitude * 0.12;
}

const round = (v) => Math.round(v * 10) / 10;

/** The last hour (every 5 s), the last 24 hours (every minute) and the power episodes, as hub-control.py keeps them. */
export function makeHistory(nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const history = { recent: [], day: [], power: [] };
  for (let t = now - 3600; t <= now; t += 5) {
    const peak = t > now - 1500 && t < now - 1100 ? 70 : 0;
    history.recent.push([t, round(wave(t, 8, 14) + peak), round(wave(t, 44, 6) + peak / 6)]);
  }
  for (let t = now - 86400; t <= now; t += 60) {
    const peak = (t > now - 30000 && t < now - 28800) || (t > now - 1500 && t < now - 1100) ? 70 : 0;
    history.day.push([t, round(wave(t, 8, 12) + peak), round(wave(t, 43, 7) + peak / 6), 28, 0.4]);
  }
  // one under-voltage episode this morning, as with a weak power supply under load
  history.power.push([now - 5 * 3600, "undervoltage"], [now - 5 * 3600 + 60, "throttled"]);
  return history;
}

/**
 * The last 30 days, one point per hour: [start of the hour, cpu average, cpu peak, temperature average,
 * temperature peak, under-voltage episodes, throttling episodes], the last one being the hour so far. A warm
 * week, a busy night of the monthly update (with under-voltage) and a few hours without a temperature reading.
 */
export function makeMonth(nowMs = Date.now()) {
  const month = [];
  const hour = Math.floor(nowMs / 3600000) * 3600;
  for (let t = hour - 30 * 86400 + 3600; t <= hour; t += 3600) {
    const daysAgo = (hour - t) / 86400;
    const warm = daysAgo > 9 && daysAgo < 16 ? 6 * Math.sin(((daysAgo - 9) / 7) * Math.PI) : 0;
    const update = daysAgo > 19 && daysAgo < 19.25 ? 55 : 0;
    const cpu = wave(t, 7, 6) + update;
    const temp = wave(t, 42, 4) + warm + update / 8;
    const missing = daysAgo > 24 && daysAgo < 24.2;
    const spike = (t / 3600) % 5 === 0 ? 30 : 0; // a short spike every few hours: only the peak shows it
    const power = update ? 1 : 0;
    month.push([t, round(cpu), round(Math.min(100, cpu + 18 + spike)),
      missing ? null : round(temp), missing ? null : round(temp + 3), power, power]);
  }
  return month;
}

/** The hardware readings right now. started: when the pretend Pi started (ms); disk: "sd" or "usb". */
export function readings({ started, disk = "sd", alerts = [] }) {
  const t = Date.now() / 1000;
  const cpu = Math.max(1, wave(t, 8, 14));
  return {
    time: Math.round(t), hostname: "raspberry", model: "Raspberry Pi 3 Model B Rev 1.2", ip: "192.168.1.10",
    cpu: { usage: round(cpu), cores: [cpu * 1.3, cpu * 0.7, cpu * 1.1, cpu * 0.9].map(round), load: [0.42, 0.31, 0.2], mhz: 1200, count: 4 },
    temp: round(wave(t, 44, 6)),
    mem: { total: 948879360, used: 262144000 + Math.round(Math.sin(t / 60) * 6e6), swap_total: 947908608, swap_used: 1572864 },
    disk: { total: 125229338624, used: 47244640256, percent_full: 38.6, io_rate: Math.random() > 0.5 ? 40960 : 0,
      content: { wikipedia: 31e9, maps: 4.7e9, addresses: 1.1e9 },
      ...(disk === "usb" ? { device: "sda1", medium: "usb" } : { device: "mmcblk0p2", medium: "sd" }) },
    net: { interface: "eth0", rx: Math.round(1.2e6 + Math.sin(t / 9) * 4e5), tx: Math.round(3e5 + Math.cos(t / 7) * 1e5), link_up: true, mbit: 100 },
    power: { undervoltage: false, throttled: false, undervoltage_past: false, throttled_past: false },
    check: alerts.includes("check_failed")
      ? { time: new Date(started).toISOString(), failed: 2, failures: ["caddy running", "hub home page"] }
      : { time: new Date(started).toISOString(), failed: 0, failures: [] },
    uptime: 166738 + Math.round((Date.now() - started) / 1000),
    timezone: "Europe/Rome",
    processes: [{ name: "pihole-FTL", cpu: 3.1 }, { name: "kiwix-serve", cpu: 1.4 }, { name: "caddy", cpu: 0.6 }, { name: "unbound", cpu: 0.3 }, { name: "python3", cpu: 0.1 }],
    alerts,
  };
}

/** The DNS summary Pi-hole would give. */
export function dns() {
  return {
    per_minute: Math.round(280 + 120 * Math.sin(Date.now() / 40000)), total: 27844, blocked: 13559,
    percent_blocked: 48.7, cached: 9667, forwarded: 2347, clients: 9, blocked_domains: 756319,
    upstream: { name: "Quad9", encrypted: true },
  };
}

/** The content status (/srv/hub/status.json); latest: the release found by the daily check. */
export function contentStatus(latest) {
  return {
    updated: new Date().toISOString(),
    wikipedia: { language: "it", edition: "2026-08", bytes: 31e9, result: "ok", running: false },
    maps: { build: "20261116", bytes: 4.7e9, result: "ok", running: false },
    addresses: { date: "2026-11-08", bytes: 1.1e9, result: "ok", running: false },
    latest,
  };
}

/** A link added from the hub, next to the services shipped with a new install (pi/services.json). */
export const NAS = { id: "u-nas", name: "NAS", description: "Home photos and documents", url: "http://192.168.1.20/", type: "link", added: true };

/**
 * The live state of each service. off: ids switched off from the hub; blocking: Pi-hole blocking ads;
 * notDownloaded: ids whose content is not there (switched on, they are "missing", as hub-control says).
 */
export function serviceStates(services, { off, blocking, notDownloaded = new Set() }) {
  const result = {};
  for (const s of services) {
    if (s.type === "pihole") result[s.id] = { state: blocking ? "on" : "paused", detail: "", switch: true };
    else if (s.type === "unit") {
      result[s.id] = off.has(s.id) ? { state: "off", detail: "", switch: true }
        : notDownloaded.has(s.id) ? { state: "missing", detail: "", switch: true }
          : { state: "on", detail: "", switch: true };
    } else if (s.id === NAS.id) result[s.id] = { state: "unreachable", detail: "no_response", host: "192.168.1.20", switch: false };
    else result[s.id] = { state: "on", detail: "", switch: false };
  }
  const t = Date.now() / 1000;
  const visits = { pihole: Math.round(280 + 120 * Math.sin(t / 40)), wikipedia: 35, maps: Math.round(60 + 60 * Math.sin(t / 25)), netmon: 2 };
  for (const [id, value] of Object.entries(visits)) if (result[id]) result[id].activity = value;
  return result;
}

/** A few places for the address search, as hub-search.py answers them. */
export const PLACES = [
  { type: "place", name: "Milano", detail: "Milano, Lombardia", class: "city", lat: 45.4642, lon: 9.19, bbox: [9.04, 45.386, 9.278, 45.536] },
  { type: "street", name: "Via Giuseppe Garibaldi", detail: "20121 Milano", lat: 45.4762, lon: 9.1854, bbox: [9.184, 45.472, 9.187, 45.481] },
  { type: "house_number", name: "Via Giuseppe Garibaldi 12", detail: "20121 Milano", lat: 45.4738, lon: 9.1851, bbox: null, exact_number: true },
  { type: "place", name: "Roma", detail: "Roma, Lazio", class: "city", lat: 41.8933, lon: 12.4829, bbox: [12.234, 41.655, 12.856, 42.141] },
  { type: "street", name: "Via Toledo", detail: "80132 Napoli", lat: 40.839, lon: 14.2484, bbox: [14.247, 40.835, 14.25, 40.846] },
  { type: "street", name: "Via Roma", detail: "10121 Torino", lat: 45.0667, lon: 7.682, bbox: [7.68, 45.062, 7.685, 45.071] },
];

/** /search?q=...: every word of the query in the name or the detail. */
export function search(query) {
  const q = (query ?? "").toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  const results = PLACES.filter((l) => words.every((w) => `${l.name} ${l.detail}`.toLowerCase().includes(w)));
  return { q, results, ms: 3 };
}
