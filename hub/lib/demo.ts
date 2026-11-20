// The demo on GitHub Pages (npm run demo, NEXT_PUBLIC_DEMO=1): there is no Raspberry Pi behind it, so the
// requests of lib/hub.tsx are answered here, in the browser, with the made-up data of dev/pretend-pi.mjs (the
// same the mock serves). Switches, added services, the login and the password live in memory: a reload starts
// over. Never part of the website installed on a Raspberry Pi.
import { NAS, contentStatus, dns, makeHistory, makeMonth, readings, search, serviceStates } from "@/dev/pretend-pi.mjs";
import { ApiError, DEMO_PASSWORD, DEMO_USER, PREFIX } from "./hub";
import type { Service } from "./types";

const VERSION = process.env.NEXT_PUBLIC_VERSION ?? "";
const started = Date.now();
const history = makeHistory();
const month = makeMonth();
// the demo has no Wikipedia: switched on, it says the content is not downloaded yet
const off = new Set(["wikipedia"]);
const notDownloaded = new Set(["wikipedia"]);
let blocking = true;
let loggedIn = false;
let password = DEMO_PASSWORD;
let services: Service[] | null = null;

/** The services of a new installation (pi/services.json, copied next to the demo), and one added link. */
async function list(): Promise<Service[]> {
  if (!services) {
    let shipped: Service[] = [];
    try {
      shipped = (await (await fetch(`${PREFIX}/services.json`)).json()).services ?? [];
    } catch {
      // nothing to show but the added link
    }
    // there is no Pi-hole dashboard or network monitor to open in the demo: Pi-hole links to its own site
    services = [
      ...shipped.filter((s) => s.id !== "netmon").map((s) => (s.type === "pihole" ? { ...s, url: "https://pi-hole.net/" } : s)),
      { ...NAS },
    ];
  }
  return services;
}

const states = async () => serviceStates(await list(), { off, blocking, notDownloaded });

function fail(status: number, code: string, message: string, data: Record<string, unknown> = {}): never {
  throw new ApiError(status, code, message, { error: code, message, ...data });
}

/** An image sent by "Add service" (base64 without a header) as a data: address, since nothing stores it. */
function imageUrl(data: string): string {
  const type = data.startsWith("iVBOR") ? "png" : data.startsWith("/9j/") ? "jpeg" : data.startsWith("UklGR") ? "webp" : "";
  if (!type) fail(400, "icon_format", "Format not accepted. Use a PNG, JPEG or WebP image.");
  return `data:image/${type};base64,${data}`;
}

/** What hub-control.py, hub-update.sh and Caddy would answer, for the requests the hub makes. */
export async function demoApi<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? "GET";
  const body = (options.body ?? {}) as Record<string, unknown>;
  const [route, query] = path.split("?");
  const answer = (data: unknown) => data as T;

  if (method === "GET") {
    if (route === "/services.json") return answer({ services: await list() });
    if (route === "/status.json") return answer(contentStatus(null));
    if (route === "/control/status") {
      return answer({ time: Math.round(Date.now() / 1000), authenticated: loggedIn, user: loggedIn ? DEMO_USER : null,
        configured: true, version: VERSION, services: await states(), dns: dns() });
    }
    if (route === "/control/system") return answer(readings({ started }));
    if (route === "/control/system/history") {
      if (new URLSearchParams(query).get("period") === "month") return answer({ month: { step: 3600, points: month } });
      return answer({ recent: { step: 5, points: history.recent }, day: { step: 60, points: history.day }, power: { events: history.power } });
    }
    if (route === "/control/upgrade") return answer({ installed: VERSION, latest: null, newer: false, progress: null });
    fail(404, "not_found", "Page not found.");
  }

  if (route === "/control/login") {
    if (body.username === DEMO_USER && body.password === password) {
      loggedIn = true;
      return answer({ ok: true, user: DEMO_USER });
    }
    fail(401, "bad_credentials", "Wrong username or password.", { attempts_left: 4 });
  }
  if (route === "/control/logout") {
    loggedIn = false;
    return answer({ ok: true });
  }
  if (!loggedIn) fail(401, "login_required", "Log in to continue.");

  if (route === "/control/password") {
    if (body.current !== password) fail(403, "wrong_password", "The current password is not correct.");
    if (String(body.new ?? "").length < 8) fail(400, "password_too_short", "The new password must be at least 8 characters long.");
    password = String(body.new);
    return answer({ ok: true });
  }
  if (route === "/control/upgrade") fail(409, "up_to_date", "This version is already installed.");
  const toggle = /^\/control\/services\/([a-z0-9-]+)\/switch$/.exec(route);
  if (toggle) {
    if (toggle[1] === "pihole") blocking = Boolean(body.on);
    else if (body.on) off.delete(toggle[1]);
    else off.add(toggle[1]);
    return answer({ ok: true, services: await states() });
  }
  const one = /^\/control\/services(?:\/([a-z0-9-]+))?$/.exec(route);
  if (one) {
    const all = await list();
    const existing = one[1] ? all.find((s) => s.id === one[1] && s.added) : undefined;
    if (one[1] && !existing) fail(404, method === "DELETE" ? "not_removable" : "not_editable", "This service cannot be changed from the hub.");
    if (method === "DELETE") {
      services = all.filter((s) => s.id !== one[1]);
      return answer({ ok: true });
    }
    const name = String(body.name ?? "").trim();
    const url = String(body.url ?? "").trim();
    if (!name || name.length > 40) fail(400, "invalid_name", "Enter a name of at most 40 characters.");
    if (!/^(https?:\/\/\S{3,280}|\/\S{0,280})$/.test(url)) {
      fail(400, "invalid_url", "The address must start with http://, https:// or / for a page on this Raspberry Pi.");
    }
    const icon = (body.icon as { data?: string } | undefined)?.data;
    const service: Service = {
      ...(existing ?? { id: `u-${Math.random().toString(16).slice(2, 10)}` }),
      name, description: String(body.description ?? "").trim(), url, type: "link", added: true,
      ...(icon ? { icon: imageUrl(icon) } : {}),
    };
    services = existing ? all.map((s) => (s.id === service.id ? service : s)) : [...all, service];
    return answer({ ok: true, service });
  }
  return fail(404, "not_found", "Page not found.");
}

/** The address search of the map (hub-search.py), as a Response like fetch() gives. */
export function demoSearch(params: URLSearchParams): Response {
  return new Response(JSON.stringify(search(params.get("q"))), { headers: { "Content-Type": "application/json" } });
}
