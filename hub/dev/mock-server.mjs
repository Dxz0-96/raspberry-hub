// Mock Raspberry Pi to try the hub on a PC: answers like hub-control.py, hub-search.py and Caddy,
// and serves the built site (out/ folder). No real data: everything stays in memory.
//
//   npm run build && npm run mock        then open http://localhost:8790
//   test login: admin / test1234
//   MOCK_TILES=path/to/a/file.pmtiles npm run mock    to try the map too
//   MOCK_PI=https://127.0.0.1:8443 MOCK_PI_CA=home-ca.crt npm run mock
//       real map and search: /tiles and /search go to the Raspberry Pi (for example through
//       "ssh -L 8443:127.0.0.1:443 user@raspberry-address"), checking its home certificate
//   MOCK_SEARCH=http://127.0.0.1:8082   search goes to a hub-search.py started on the PC with a test index
//   MOCK_OFF=wikipedia,maps             services that start switched off (default: wikipedia; "" = all on)
//   MOCK_ALERTS=temperature,disk        hardware alerts to show
//   MOCK_NO_PASSWORD=1                  as if the hub password had never been set
// Without MOCK_PI, /wiki answers with a fake Wikipedia (dev/fake-wikipedia.mjs).
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { fakeWikipedia } from "./fake-wikipedia.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "..", "out");
const ICONS = join(HERE, "..", "..", "pi", "icons");
const PORT = Number(process.env.PORT ?? 8790);
const TILES = process.env.MOCK_TILES;
const PI = process.env.MOCK_PI ? new URL(process.env.MOCK_PI) : null;
const PI_CA = process.env.MOCK_PI_CA ? readFileSync(process.env.MOCK_PI_CA) : undefined;

/** Forwards the request to the real Raspberry Pi, as if it arrived at https://raspberry. */
function toRaspberry(req, res) {
  const forward = httpsRequest(
    {
      host: PI.hostname,
      port: PI.port || 443,
      path: req.url,
      method: "GET",
      servername: "raspberry",
      ca: PI_CA,
      headers: { Host: "raspberry", ...(req.headers.range ? { Range: req.headers.range } : {}) },
    },
    (response) => {
      const kept = {};
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "location"]) {
        if (response.headers[name]) kept[name] = response.headers[name];
      }
      res.writeHead(response.statusCode ?? 502, kept);
      response.pipe(res);
    },
  );
  forward.on("error", (error) => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Raspberry Pi not reachable: ${error.message}`);
  });
  forward.end();
}
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
  ".woff": "font/woff", ".pbf": "application/x-protobuf", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon",
};

let services = JSON.parse(readFileSync(join(HERE, "..", "..", "pi", "services.json"), "utf8")).services;
services.push({ id: "u-nas", name: "NAS", description: "Home photos and documents", url: "http://192.168.1.20/", type: "link", added: true });
const icons = new Map();
const off = new Set((process.env.MOCK_OFF ?? "wikipedia").split(",").filter(Boolean));
let blocking = true;
let password = "test1234";
let failures = 0;
const sessions = new Set();
const started = Date.now();

const history = { recent: [], day: [] };
function wave(t, base, amplitude) {
  return base + amplitude * (0.5 + 0.5 * Math.sin(t / 380)) + (Math.sin(t / 47) + Math.sin(t / 13)) * amplitude * 0.12;
}
{
  const now = Math.floor(Date.now() / 1000);
  for (let t = now - 3600; t <= now; t += 5) {
    const peak = t > now - 1500 && t < now - 1100 ? 70 : 0;
    history.recent.push([t, Math.round((wave(t, 8, 14) + peak) * 10) / 10, Math.round((wave(t, 44, 6) + peak / 6) * 10) / 10]);
  }
  for (let t = now - 86400; t <= now; t += 60) {
    const peak = (t > now - 30000 && t < now - 28800) || (t > now - 1500 && t < now - 1100) ? 70 : 0;
    history.day.push([t, Math.round((wave(t, 8, 12) + peak) * 10) / 10, Math.round((wave(t, 43, 7) + peak / 6) * 10) / 10, 28, 0.4]);
  }
}

function system() {
  const t = Date.now() / 1000;
  const cpu = Math.max(1, wave(t, 8, 14));
  return {
    time: Math.round(t), hostname: "raspberry", model: "Raspberry Pi 3 Model B Rev 1.2", ip: "192.168.1.10",
    cpu: { usage: Math.round(cpu * 10) / 10, cores: [cpu * 1.3, cpu * 0.7, cpu * 1.1, cpu * 0.9].map((v) => Math.round(v * 10) / 10),
      load: [0.42, 0.31, 0.2], mhz: 1200, count: 4 },
    temp: Math.round(wave(t, 44, 6) * 10) / 10,
    mem: { total: 948879360, used: 262144000 + Math.round(Math.sin(t / 60) * 6e6), swap_total: 947908608, swap_used: 1572864 },
    disk: { total: 125229338624, used: 47244640256, percent_full: 38.6, io_rate: Math.random() > 0.5 ? 40960 : 0,
      content: { wikipedia: 31e9, maps: 4.7e9, addresses: 1.1e9 } },
    net: { interface: "eth0", rx: Math.round(1.2e6 + Math.sin(t / 9) * 4e5), tx: Math.round(3e5 + Math.cos(t / 7) * 1e5), link_up: true, mbit: 100 },
    power: { undervoltage: false, throttled: false, undervoltage_past: false, throttled_past: false },
    uptime: 166738 + Math.round((Date.now() - started) / 1000),
    processes: [{ name: "pihole-FTL", cpu: 3.1 }, { name: "kiwix-serve", cpu: 1.4 }, { name: "caddy", cpu: 0.6 }, { name: "unbound", cpu: 0.3 }, { name: "python3", cpu: 0.1 }],
    alerts: process.env.MOCK_ALERTS ? process.env.MOCK_ALERTS.split(",") : [],
  };
}

function states() {
  const result = {};
  for (const s of services) {
    if (s.type === "pihole") result[s.id] = { state: blocking ? "on" : "paused", detail: "", switch: true };
    else if (s.type === "unit") result[s.id] = off.has(s.id) ? { state: "off", detail: "", switch: true } : { state: "on", detail: "", switch: true };
    else if (s.id === "u-nas") result[s.id] = { state: "unreachable", detail: "no_response", host: "192.168.1.20", switch: false };
    else result[s.id] = { state: "on", detail: "", switch: false };
  }
  const t = Date.now() / 1000;
  const visits = { pihole: Math.round(280 + 120 * Math.sin(t / 40)), wikipedia: 35, maps: Math.round(60 + 60 * Math.sin(t / 25)), netmon: 2 };
  for (const [id, value] of Object.entries(visits)) if (result[id]) result[id].activity = value;
  return result;
}

function dns() {
  return {
    per_minute: Math.round(280 + 120 * Math.sin(Date.now() / 40000)), total: 27844, blocked: 13559,
    percent_blocked: 48.7, cached: 9667, forwarded: 2347, clients: 9, blocked_domains: 756319,
    upstream: { name: "Quad9", encrypted: true },
  };
}

const PLACES = [
  { type: "place", name: "Milano", detail: "Milano, Lombardia", class: "city", lat: 45.4642, lon: 9.19, bbox: [9.04, 45.386, 9.278, 45.536] },
  { type: "street", name: "Via Giuseppe Garibaldi", detail: "20121 Milano", lat: 45.4762, lon: 9.1854, bbox: [9.184, 45.472, 9.187, 45.481] },
  { type: "house_number", name: "Via Giuseppe Garibaldi 12", detail: "20121 Milano", lat: 45.4738, lon: 9.1851, bbox: null, exact_number: true },
  { type: "place", name: "Roma", detail: "Roma, Lazio", class: "city", lat: 41.8933, lon: 12.4829, bbox: [12.234, 41.655, 12.856, 42.141] },
  { type: "street", name: "Via Toledo", detail: "80132 Napoli", lat: 40.839, lon: 14.2484, bbox: [14.247, 40.835, 14.25, 40.846] },
  { type: "street", name: "Via Roma", detail: "10121 Torino", lat: 45.0667, lon: 7.682, bbox: [7.68, 45.062, 7.685, 45.071] },
];

function json(res, status, body, extra = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-store", ...extra });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); } catch { resolve({}); }
    });
  });
}
function session(req) {
  const token = /hub_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  return token && sessions.has(token) ? token : null;
}
function file(res, path, status = 200, req) {
  const stat = statSync(path);
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  const range = /bytes=(\d+)-(\d*)/.exec(req?.headers.range ?? "");
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1, "Accept-Ranges": "bytes", ETag: `"${stat.mtimeMs}-${stat.size}"` });
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(status, { "Content-Type": type, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
  createReadStream(path).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);
  if (req.headers.origin) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hub, Range");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, ETag");
  }
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if (p === "/services.json") return json(res, 200, { services });
  if (p === "/status.json") {
    return json(res, 200, {
      updated: new Date().toISOString(),
      wikipedia: { edition: "2026-08", bytes: 31e9, result: "ok", running: false },
      maps: { build: "20261116", bytes: 4.7e9, result: "ok", running: false },
      addresses: { date: "2026-11-08", bytes: 1.1e9, result: "ok", running: false },
    });
  }
  if (p === "/control/status") return json(res, 200, { time: Math.round(Date.now() / 1000), authenticated: Boolean(session(req)), user: session(req) ? "admin" : null, configured: process.env.MOCK_NO_PASSWORD !== "1", services: states(), dns: dns() });
  if (p === "/control/system") return json(res, 200, system());
  if (p === "/control/system/history") return json(res, 200, { recent: { step: 5, points: history.recent }, day: { step: 60, points: history.day } });

  if (process.env.MOCK_SEARCH && (p === "/search" || p.startsWith("/search/"))) {
    const target = new URL(req.url, process.env.MOCK_SEARCH);
    const forward = httpRequest(target, (response) => {
      res.writeHead(response.statusCode ?? 502, { "Content-Type": response.headers["content-type"] ?? "application/json" });
      response.pipe(res);
    });
    forward.on("error", () => json(res, 502, { error: "search_off" }));
    return forward.end();
  }
  if (PI && (p.startsWith("/tiles/") || p === "/search" || p.startsWith("/search/") || p === "/wiki" || p.startsWith("/wiki/"))) {
    return toRaspberry(req, res);
  }
  if (p === "/wiki" || p.startsWith("/wiki/")) {
    if (off.has("wikipedia")) return res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }).end("Wikipedia switched off from the hub");
    if (fakeWikipedia(req, res, url)) return;
  }
  if (p === "/search") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);
    const results = PLACES.filter((l) => words.every((w) => `${l.name} ${l.detail}`.toLowerCase().includes(w)));
    return json(res, 200, { q, results, ms: 3 });
  }

  if (p.startsWith("/control/") && (req.method === "POST" || req.method === "DELETE")) {
    if (req.headers["x-hub"] !== "1") return json(res, 403, { error: "foreign_request", message: "Request not accepted." });
    const data = await readBody(req);
    if (p === "/control/login") {
      if (data.username === "admin" && data.password === password) {
        failures = 0;
        const token = randomBytes(16).toString("hex");
        sessions.add(token);
        return json(res, 200, { ok: true, user: "admin" }, { "Set-Cookie": `hub_session=${token}; Path=/control; Max-Age=34560000; HttpOnly; SameSite=Strict` });
      }
      failures++;
      if (failures >= 5) { failures = 0; return json(res, 429, { error: "locked", message: "Too many attempts. Try again later.", seconds: 300 }); }
      return json(res, 401, { error: "bad_credentials", message: "Wrong username or password.", attempts_left: 5 - failures });
    }
    if (p === "/control/logout") { sessions.delete(session(req)); return json(res, 200, { ok: true }); }
    if (!session(req)) return json(res, 401, { error: "login_required", message: "Log in to continue." });
    if (p === "/control/password") {
      if (data.current !== password) return json(res, 403, { error: "wrong_password", message: "The current password is not correct." });
      if (String(data.new ?? "").length < 8) return json(res, 400, { error: "password_too_short", message: "The new password must be at least 8 characters long." });
      password = data.new;
      return json(res, 200, { ok: true });
    }
    const toggle = /^\/control\/services\/([a-z0-9-]+)\/switch$/.exec(p);
    if (toggle) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (toggle[1] === "pihole") blocking = Boolean(data.on);
      else if (data.on) off.delete(toggle[1]);
      else off.add(toggle[1]);
      return json(res, 200, { ok: true, services: states() });
    }
    const one = /^\/control\/services(?:\/([a-z0-9-]+))?$/.exec(p);
    if (one && req.method === "DELETE") { services = services.filter((s) => s.id !== one[1]); return json(res, 200, { ok: true }); }
    if (one) {
      if (!data.name) return json(res, 400, { error: "invalid_name", message: "Enter a name of at most 40 characters." });
      const existing = services.find((s) => s.id === one[1]);
      const service = { ...(existing ?? { id: `u-${randomBytes(4).toString("hex")}` }), name: data.name, description: data.description ?? "", url: data.url, type: "link", added: true };
      if (data.icon?.data) { const name = `${randomBytes(8).toString("hex")}.png`; icons.set(name, Buffer.from(data.icon.data, "base64")); service.icon = `/icons/${name}`; }
      services = existing ? services.map((s) => (s.id === service.id ? service : s)) : [...services, service];
      return json(res, 200, { ok: true, service });
    }
    return json(res, 404, { error: "not_found", message: "Page not found." });
  }

  if (p.startsWith("/icons/")) {
    const name = p.slice(7);
    if (icons.has(name)) return res.writeHead(200, { "Content-Type": "image/png" }).end(icons.get(name));
    const path = join(ICONS, normalize(name).replace(/^(\.\.[/\\])+/, ""));
    if (existsSync(path)) return file(res, path, 200, req);
    return res.writeHead(404).end();
  }
  if (p === "/tiles/basemap.pmtiles") {
    if (off.has("maps")) return res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }).end("Maps switched off from the hub");
    if (TILES && existsSync(TILES)) return file(res, TILES, 200, req);
    return res.writeHead(404).end();
  }

  // the built site, as Caddy serves it
  const relative = normalize(p).replace(/^(\.\.[/\\])+/, "");
  for (const candidate of [join(SITE, relative), join(SITE, relative, "index.html"), join(SITE, `${relative}.html`)]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return file(res, candidate, 200, req);
  }
  if (existsSync(join(SITE, "404.html"))) return file(res, join(SITE, "404.html"), 404, req);
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Site not built: run npm run build first");
}).listen(PORT, () => console.log(`Mock Raspberry Pi on http://localhost:${PORT} (test login: admin / test1234)`));
