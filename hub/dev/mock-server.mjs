// Mock Raspberry Pi to try the hub on a PC: answers like hub-control.py, hub-search.py and Caddy,
// and serves the built site (out/ folder). No real data: everything stays in memory. The made-up readings,
// history and places come from dev/pretend-pi.mjs, shared with the demo on GitHub Pages (lib/demo.ts).
//
//   npm run build && npm run mock        then open http://localhost:8790
//   test login: admin / test1234
//   MOCK_TILES=path/to/a/file.pmtiles npm run mock    to try the map too
//   MOCK_PI=https://127.0.0.1:8443 MOCK_PI_CA=home-ca.crt npm run mock
//       real map and search: /tiles and /search go to the Raspberry Pi (for example through
//       "ssh -L 8443:127.0.0.1:443 user@raspberry-address"), checking its home certificate
//   MOCK_SEARCH=http://127.0.0.1:8082   search goes to a hub-search.py started on the PC with a test index
//   MOCK_OFF=wikipedia,maps             services that start switched off (default: wikipedia; "" = all on)
//   MOCK_ALERTS=temperature,disk        hardware alerts to show (check_failed: the check after boot failed)
//   MOCK_DISK=usb                       the content is on a USB disk (sda1) instead of the microSD
//   MOCK_NO_PASSWORD=1                  as if the hub password had never been set
//   MOCK_PI_VERSION=1.0.0               version reported by the Raspberry Pi scripts (default: the site's)
//   MOCK_LATEST=9.1.0                   latest release found by the daily check (default: the installed one):
//                                       the hub shows the notice, and "Update" runs a pretend upgrade
// Without MOCK_PI, /wiki answers with a fake Wikipedia (dev/fake-wikipedia.mjs).
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { fakeWikipedia } from "./fake-wikipedia.mjs";
import { NAS, contentStatus, dns, makeHistory, makeMonth, readings, search, serviceStates } from "./pretend-pi.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "..", "out");
const ICONS = join(HERE, "..", "..", "pi", "icons");
const PORT = Number(process.env.PORT ?? 8790);
const TILES = process.env.MOCK_TILES;
const PI = process.env.MOCK_PI ? new URL(process.env.MOCK_PI) : null;
const PI_CA = process.env.MOCK_PI_CA ? readFileSync(process.env.MOCK_PI_CA) : undefined;
const PI_VERSION = process.env.MOCK_PI_VERSION ?? JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")).version;
const LATEST = process.env.MOCK_LATEST ?? PI_VERSION;
const NOTES = `## [${LATEST}](https://github.com/Dxz0-96/raspberry-hub/compare/v${PI_VERSION}...v${LATEST}) (2026-11-20)

### Features

* **hub:** last-month view in Trends, without the data table ([#34](https://github.com/Dxz0-96/raspberry-hub/issues/34)) ([3f1ee03](https://github.com/Dxz0-96/raspberry-hub/commit/3f1ee03))
* read the deploy settings from a .env file ([#32](https://github.com/Dxz0-96/raspberry-hub/issues/32)) ([9e68f4f](https://github.com/Dxz0-96/raspberry-hub/commit/9e68f4f))
`;
/** The version the Raspberry Pi scripts report: the pretend upgrade changes it, as the real one does. */
let piVersion = PI_VERSION;
/** /srv/hub/state/upgrade.json, written by hub-upgrade.py on the Raspberry Pi */
let upgrade = null;
function semver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? "");
  return m ? m.slice(1).map(Number) : null;
}
function newer(a, b) {
  const x = semver(a);
  const y = semver(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
const latest = () => ({ version: LATEST, url: `https://github.com/Dxz0-96/raspberry-hub/releases/tag/v${LATEST}`,
  published: "2026-11-20T15:10:00Z", checked: new Date().toISOString() });
/** A pretend upgrade: the same steps as hub-upgrade.py, a few seconds each. */
function pretendUpgrade(version) {
  const stamp = () => new Date().toISOString();
  upgrade = { version, from: piVersion, step: "start", result: null, error: null, warning: null, started: stamp(), updated: stamp() };
  ["download", "verify", "install", "check", "done"].forEach((step, i) => {
    setTimeout(() => {
      upgrade = { ...upgrade, step, result: step === "done" ? "ok" : null, updated: stamp() };
      if (step === "done") piVersion = version;
    }, (i + 1) * 3000);
  });
}

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

// The headers Caddy adds (pi/Caddyfile): to every response, and to the pages of the hub. The policy of the pages is
// read from the Caddyfile, so that the tests run the site under the same rules as the Raspberry Pi.
const CADDYFILE = readFileSync(join(HERE, "..", "..", "pi", "Caddyfile"), "utf8");
const PAGE_POLICY = /\(hub_pages\)[\s\S]*?Content-Security-Policy "([^"]+)"/.exec(CADDYFILE)?.[1];
if (!PAGE_POLICY) throw new Error("pi/Caddyfile: no Content-Security-Policy in the (hub_pages) snippet");
const EVERY_RESPONSE = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };
const HUB_PAGES = { "Content-Security-Policy": PAGE_POLICY, "X-Frame-Options": "SAMEORIGIN" };

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
  ".woff": "font/woff", ".pbf": "application/x-protobuf", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon",
};

let services = JSON.parse(readFileSync(join(HERE, "..", "..", "pi", "services.json"), "utf8")).services;
services.push({ ...NAS });
const icons = new Map();
const off = new Set((process.env.MOCK_OFF ?? "wikipedia").split(",").filter(Boolean));
let blocking = true;
let password = "test1234";
let failures = 0;
const sessions = new Set();
const started = Date.now();

// The made-up readings, shared with the demo on GitHub Pages (dev/pretend-pi.mjs)
const history = makeHistory();
const month = makeMonth();
const system = () => readings({ started, disk: process.env.MOCK_DISK === "usb" ? "usb" : "sd",
  alerts: process.env.MOCK_ALERTS ? process.env.MOCK_ALERTS.split(",") : [] });
const states = () => serviceStates(services, { off, blocking });

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
  // only pages served from this computer (npm run dev on another port) may call the mock with cookies
  for (const [name, value] of Object.entries(EVERY_RESPONSE)) res.setHeader(name, value);
  const origin = req.headers.origin ?? "";
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hub, Range");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, ETag");
  }
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if (p === "/services.json") return json(res, 200, { services });
  if (p === "/status.json") return json(res, 200, contentStatus(latest()));
  if (p === "/control/status") return json(res, 200, { time: Math.round(Date.now() / 1000), authenticated: Boolean(session(req)), user: session(req) ? "admin" : null, configured: process.env.MOCK_NO_PASSWORD !== "1", version: piVersion, services: states(), dns: dns() });
  if (p === "/control/upgrade" && req.method === "GET") {
    return json(res, 200, { installed: piVersion, latest: { ...latest(), notes: NOTES }, newer: newer(LATEST, piVersion), progress: upgrade });
  }
  if (p === "/control/system") return json(res, 200, system());
  if (p === "/control/system/history") {
    const period = url.searchParams.get("period") ?? "";
    if (period === "month") return json(res, 200, { month: { step: 3600, points: month } });
    if (period !== "") return json(res, 400, { error: "invalid_request", message: "Invalid request." });
    return json(res, 200, { recent: { step: 5, points: history.recent }, day: { step: 60, points: history.day }, power: { events: history.power } });
  }

  if (process.env.MOCK_SEARCH && (p === "/search" || p.startsWith("/search/"))) {
    // the host always comes from MOCK_SEARCH: only the path and the query come from the request
    const target = new URL(process.env.MOCK_SEARCH);
    target.pathname = url.pathname;
    target.search = url.search;
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
  if (p === "/search") return json(res, 200, search(url.searchParams.get("q")));

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
    if (p === "/control/upgrade") {
      // the same checks as start_upgrade() in hub-control.py, in the same order
      if (String(data.version) !== LATEST) return json(res, 400, { error: "not_latest", message: "Only the latest release found by the daily check can be installed." });
      if (!newer(LATEST, piVersion)) return json(res, 409, { error: "up_to_date", message: "This version is already installed." });
      if (upgrade && !["done", "failed"].includes(upgrade.step)) return json(res, 409, { error: "upgrade_running", message: "An update is already running." });
      pretendUpgrade(LATEST);
      return json(res, 202, { ok: true });
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
  for (const [name, value] of Object.entries(HUB_PAGES)) res.setHeader(name, value);
  const relative = normalize(p).replace(/^(\.\.[/\\])+/, "");
  for (const candidate of [join(SITE, relative), join(SITE, relative, "index.html"), join(SITE, `${relative}.html`)]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return file(res, candidate, 200, req);
  }
  if (existsSync(join(SITE, "404.html"))) return file(res, join(SITE, "404.html"), 404, req);
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Site not built: run npm run build first");
}).listen(PORT, () => console.log(`Mock Raspberry Pi on http://localhost:${PORT} (test login: admin / test1234)`));
