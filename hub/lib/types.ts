// The shapes of the data the hub receives from the Raspberry Pi (hub-control.py, hub-search.py, hub-update.sh).

export type ServiceState = "on" | "off" | "paused" | "missing" | "unreachable" | "error" | "unknown";

export interface Service {
  id: string;
  name: string;
  description?: string;
  url: string;
  icon?: string;
  type?: "pihole" | "unit" | "link";
  added?: boolean;
}

export interface LiveState {
  state: ServiceState;
  /** Machine-readable detail ("unit_not_running", "no_response", ...), "" when there is nothing to add. */
  detail: string;
  /** For "no_response": the host that does not answer. */
  host?: string;
  switch: boolean;
  /** Visits per minute (for Pi-hole: DNS queries per minute); null when it cannot be measured. */
  activity?: number | null;
}

/** DNS summary read from Pi-hole: totals refer to the last 24 hours. */
export interface Dns {
  per_minute: number;
  total: number;
  blocked: number;
  percent_blocked: number;
  cached: number;
  forwarded: number;
  clients: number | null;
  blocked_domains: number | null;
  /** name is "root_servers" when Unbound resolves on its own */
  upstream: { name: string; encrypted: boolean };
}

export interface StatusResponse {
  time: number;
  authenticated: boolean;
  user: string | null;
  configured: boolean;
  /** Version of the Raspberry Pi scripts (written by hub-install.sh); null on installs older than 2.0 */
  version?: string | null;
  services: Record<string, LiveState>;
  dns?: Dns | null;
}

/** check_failed: the check after the last boot (hub-check.service) found something that did not come back */
export type HardwareAlert = "temperature" | "disk" | "power" | "load" | "check_failed";

/** Where the content folder (/srv/hub) is: the microSD, a USB disk, or something else */
export type StorageMedium = "sd" | "usb" | "other";

export interface SystemInfo {
  time: number;
  hostname: string;
  model: string;
  ip: string;
  cpu: { usage: number; cores: number[]; load: number[]; mhz: number | null; count: number };
  temp: number | null;
  mem: { total: number; used: number; swap_total: number; swap_used: number };
  disk: {
    total: number;
    used: number;
    percent_full: number;
    io_rate: number;
    content: { wikipedia: number; maps: number; addresses: number };
    /** The device that holds /srv/hub ("mmcblk0p2", "sda1"); missing on installs older than this field */
    device?: string;
    medium?: StorageMedium;
  };
  net: { interface: string; rx: number; tx: number; link_up: boolean; mbit: number | null };
  power: {
    undervoltage: boolean;
    throttled: boolean;
    undervoltage_past: boolean;
    throttled_past: boolean;
  } | null;
  /** The last hub-check.sh --report (after boot or an upgrade); null when there is none */
  check?: { time: string; failed: number; failures: string[] } | null;
  uptime: number;
  /** The time zone of the Raspberry Pi ("Europe/Rome"); missing on installs older than this field */
  timezone?: string | null;
  processes: { name: string; cpu: number }[];
  alerts: HardwareAlert[];
}

export interface History {
  /** [seconds, cpu %, temperature °C] every 5 seconds, last hour */
  recent: { step: number; points: [number, number, number | null][] };
  /** [seconds, cpu %, temperature °C, memory %, load] every minute, last 24 hours */
  day: { step: number; points: [number, number, number, number, number][] };
  /** Under-voltage and throttling episodes of the last 24 hours (read every 30 s) */
  power?: { events: [number, PowerEvent][] };
}

export type PowerEvent = "undervoltage" | "throttled";

/** /control/system/history?period=month, asked for only while the month is shown */
export interface MonthHistory {
  /** [start of the hour, cpu % average, cpu % peak, temperature °C average, temperature °C peak, under-voltage
   *  episodes, throttling episodes] every hour, last 30 days; the last point is the hour so far. Temperatures
   *  are null when there was no reading. */
  month: {
    step: number;
    points: [number, number, number, number | null, number | null, number?, number?][];
  };
}

export interface ContentStatus {
  updated: string;
  wikipedia: { edition: string | null; bytes: number | null; result: string | null; running: boolean };
  maps: { build: string | null; bytes: number | null; result: string | null; running: boolean };
  addresses: { date: string | null; bytes: number | null; result: string | null; running: boolean };
  /** The latest release found by the daily check (hub-update.sh check-version); null when it is switched off
   *  (CHECK_FOR_UPDATES=no) or has not run yet. Missing on installs older than this field. */
  latest?: LatestRelease | null;
}

export interface LatestRelease {
  version: string;
  /** The release page on GitHub, with its notes */
  url: string;
  published?: string;
  checked?: string;
}

/** One step of an upgrade started from the hub, as hub-upgrade.py writes it to /srv/hub/state/upgrade.json */
export type UpgradeStep = "start" | "download" | "verify" | "install" | "check" | "done" | "failed";

export interface UpgradeProgress {
  version: string;
  from: string;
  step: UpgradeStep;
  /** "ok", or "error: <English text>" */
  result: string | null;
  /** Machine-readable reason of a failure: "download_failed", "checksum_mismatch", ... */
  error: string | null;
  /** "check_failed": installed and answering, but hub-check.sh reports a problem */
  warning?: string | null;
  started: string;
  updated: string | null;
}

/** GET /control/upgrade */
export interface UpgradeStatus {
  installed: string | null;
  /** With the release notes (Markdown) */
  latest: (LatestRelease & { notes?: string }) | null;
  newer: boolean;
  progress: UpgradeProgress | null;
}

export interface SearchResult {
  type: "street" | "house_number" | "place" | "poi" | "postcode";
  name: string;
  /** Where it is, without words to translate: "20121 Milano", "Milano, Lombardia" */
  detail: string;
  /** For places and points of interest: "city", "lake", "station", ... */
  class?: string;
  /** For postcodes: how many streets of that city have it */
  streets?: number;
  lat: number;
  lon: number;
  /** west, south, east, north */
  bbox: [number, number, number, number] | null;
  missing_number?: string;
  exact_number?: boolean;
}

export interface ServiceFields {
  name: string;
  description: string;
  url: string;
  icon?: { data: string };
}
