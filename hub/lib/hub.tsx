"use client";

// The state of the hub: services, session, hardware readings. The one place that talks to the Raspberry Pi.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Messages } from "./messages/en";
import type {
  ContentStatus,
  Dns,
  History,
  LiveState,
  MonthHistory,
  Service,
  ServiceFields,
  StatusResponse,
  SystemInfo,
  UpgradeStatus,
} from "./types";

/** Empty in production (same origin). In development it points to the mock Raspberry Pi: see dev/mock-server.mjs. */
export const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
/** The demo on GitHub Pages (npm run demo): no Raspberry Pi, lib/demo.ts answers in the browser. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
/** Where the site lives on its server: "" on the Raspberry Pi, "/raspberry-hub" for the demo on GitHub Pages.
 *  Links through next/link get it by themselves; files of the site (icons, map assets, tiles) need it. */
export const PREFIX = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** The login of the demo, shown in its banner */
export const DEMO_USER = "admin";
export const DEMO_PASSWORD = "demo";

export class ApiError extends Error {
  constructor(
    public status: number,
    /** Machine-readable code from hub-control.py ("bad_credentials", ...); "network" when nothing answered */
    public code: string,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** The message to show for a failed request, in the page language. */
export function errorMessage(t: Messages, problem: unknown, fallback: string): string {
  if (problem instanceof ApiError) {
    if (problem.code === "network") return t.common.piUnreachable;
    if (problem.code === "login_required") return t.common.sessionExpired;
    if (problem.code === "unavailable") return t.common.serviceUnavailable;
    return t.apiErrors[problem.code] ?? (problem.message || fallback);
  }
  return fallback;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  if (DEMO) return (await import("./demo")).demoApi<T>(path, options);
  const writes = options.method !== undefined && options.method !== "GET";
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method: options.method ?? "GET",
      credentials: BASE ? "include" : "same-origin",
      cache: "no-store",
      headers: writes ? { "Content-Type": "application/json", "X-Hub": "1" } : undefined,
      body: writes ? JSON.stringify(options.body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", "The Raspberry Pi is not responding.");
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof data?.error === "string" ? data.error : "unavailable",
      typeof data?.message === "string" ? data.message : "",
      data ?? {},
    );
  }
  return data as T;
}

/** Repeats a read at an interval, but only while the browser tab is visible. */
export function usePolling(read: () => void, milliseconds: number) {
  const latest = useRef(read);
  useEffect(() => {
    latest.current = read;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      latest.current();
      timer = setInterval(() => latest.current(), milliseconds);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const visibility = () => {
      if (document.hidden) stop();
      else if (!timer) start();
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [milliseconds]);
}

export interface Toast {
  /** Written when shown, so it follows a language change */
  text: (t: Messages) => string;
  tone: "error" | "done";
}

interface Hub {
  services: Service[] | null;
  states: Record<string, LiveState> | null;
  dns: Dns | null;
  content: ContentStatus | null;
  system: SystemInfo | null;
  history: History | null;
  /** The last 30 days, one point per hour: read only while a page shows it (see showMonth) */
  month: MonthHistory["month"] | null;
  /** Trends calls it with true while the month is on screen, so the poll every minute stays light otherwise */
  showMonth: (shown: boolean) => void;
  authenticated: boolean;
  user: string | null;
  configured: boolean;
  /** Version of the Raspberry Pi scripts, when the Pi reports it */
  piVersion: string | null;
  /** ids of the services whose switch is working */
  busy: Record<string, boolean>;
  toast: Toast | null;
  closeToast: () => void;
  loginOpen: boolean;
  openLogin: (then?: () => void) => void;
  closeLogin: () => void;
  logIn: (username: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  setSwitch: (id: string, on: boolean) => Promise<void>;
  saveService: (fields: ServiceFields, id?: string) => Promise<void>;
  removeService: (id: string) => Promise<void>;
  /** Starts the upgrade to the latest release (login required: if missing, the login opens first) */
  startUpgrade: (version: string, then: () => void) => Promise<void>;
}

/** The address search of the map: hub-search.py through Caddy (or the demo). */
export async function searchAddresses(params: URLSearchParams, signal: AbortSignal): Promise<Response> {
  if (DEMO) return (await import("./demo")).demoSearch(params);
  return fetch(`${BASE}/search?${params}`, { signal, cache: "no-store" });
}

/** The installed version, the latest release with its notes, and the progress of an upgrade. */
export function readUpgrade(): Promise<UpgradeStatus> {
  return api<UpgradeStatus>("/control/upgrade");
}

/** The version the Raspberry Pi scripts report: used to see when an upgrade has finished. */
export async function readPiVersion(): Promise<string | null> {
  return (await api<StatusResponse>("/control/status")).version ?? null;
}

const Context = createContext<Hub | null>(null);

export function useHub(): Hub {
  const hub = useContext(Context);
  if (!hub) throw new Error("useHub must be used inside <HubProvider>");
  return hub;
}

export function HubProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [content, setContent] = useState<ContentStatus | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [month, setMonth] = useState<MonthHistory["month"] | null>(null);
  const [monthShown, setMonthShown] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const afterLogin = useRef<(() => void) | undefined>(undefined);

  const readServices = useCallback(async () => {
    try {
      const data = await api<{ services: Service[] }>("/services.json");
      setServices(Array.isArray(data.services) ? data.services : []);
    } catch {
      setServices((before) => before ?? []);
    }
  }, []);

  const readStatus = useCallback(async () => {
    try {
      setStatus(await api<StatusResponse>("/control/status"));
    } catch {
      setStatus(null);
    }
  }, []);

  usePolling(() => {
    void readStatus();
    api<SystemInfo>("/control/system")
      .then((data) => setSystem(data.cpu ? data : null))
      .catch(() => setSystem(null));
  }, 5000);

  const readMonth = useCallback(() => {
    api<MonthHistory>("/control/system/history?period=month")
      .then((data) => setMonth(data.month))
      .catch(() => setMonth(null));
  }, []);

  usePolling(() => {
    void readServices();
    api<ContentStatus>("/status.json").then(setContent).catch(() => setContent(null));
    api<History>("/control/system/history").then(setHistory).catch(() => setHistory(null));
    if (monthShown) readMonth();
  }, 60000);

  // right away when the month appears, then with the poll above
  useEffect(() => {
    if (monthShown) readMonth();
  }, [monthShown, readMonth]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.tone === "error" ? 9000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const openLogin = useCallback((then?: () => void) => {
    afterLogin.current = then;
    setLoginOpen(true);
  }, []);

  const closeLogin = useCallback(() => {
    afterLogin.current = undefined;
    setLoginOpen(false);
  }, []);

  const logIn = useCallback(
    async (username: string, password: string) => {
      await api("/control/login", { method: "POST", body: { username, password } });
      await readStatus();
      const then = afterLogin.current;
      afterLogin.current = undefined;
      setLoginOpen(false);
      then?.();
    },
    [readStatus],
  );

  const logOut = useCallback(async () => {
    try {
      await api("/control/logout", { method: "POST" });
    } finally {
      await readStatus();
    }
  }, [readStatus]);

  /** Runs a protected action; if the session is missing or expired it opens the login and then retries. */
  const protectedAction = useCallback(
    async <T,>(action: () => Promise<T>, retry: () => void): Promise<T | undefined> => {
      try {
        return await action();
      } catch (problem) {
        if (problem instanceof ApiError && problem.status === 401) {
          await readStatus();
          openLogin(retry);
          return undefined;
        }
        throw problem;
      }
    },
    [openLogin, readStatus],
  );

  const setSwitch = useCallback(
    async (id: string, on: boolean) => {
      setBusy((before) => ({ ...before, [id]: true }));
      try {
        const response = await protectedAction(
          () =>
            api<{ services: Record<string, LiveState> }>(`/control/services/${id}/switch`, {
              method: "POST",
              body: { on },
            }),
          () => void setSwitch(id, on),
        );
        if (response?.services) {
          setStatus((before) => (before ? { ...before, services: response.services } : before));
        }
      } catch (problem) {
        setToast({ text: (t) => errorMessage(t, problem, t.services.switchFailed), tone: "error" });
        void readStatus();
      } finally {
        setBusy((before) => ({ ...before, [id]: false }));
      }
    },
    [protectedAction, readStatus],
  );

  const saveService = useCallback(
    async (fields: ServiceFields, id?: string) => {
      await api(id ? `/control/services/${id}` : "/control/services", { method: "POST", body: fields });
      await Promise.all([readServices(), readStatus()]);
      setToast({ text: (t) => (id ? t.services.edited : t.services.added), tone: "done" });
    },
    [readServices, readStatus],
  );

  const removeService = useCallback(
    async (id: string) => {
      await api(`/control/services/${id}`, { method: "DELETE" });
      await Promise.all([readServices(), readStatus()]);
      setToast({ text: (t) => t.services.removed, tone: "done" });
    },
    [readServices, readStatus],
  );

  const startUpgrade = useCallback(
    async (version: string, then: () => void) => {
      const started = await protectedAction(
        () => api("/control/upgrade", { method: "POST", body: { version } }),
        () => void startUpgrade(version, then),
      );
      if (started) then();
    },
    [protectedAction],
  );

  const changePassword = useCallback(async (current: string, next: string) => {
    await api("/control/password", { method: "POST", body: { current, new: next } });
    setToast({ text: (t) => t.password.changed, tone: "done" });
  }, []);

  const value = useMemo<Hub>(
    () => ({
      services,
      states: status?.services ?? null,
      dns: status?.dns ?? null,
      content,
      system,
      history,
      month,
      showMonth: setMonthShown,
      authenticated: status?.authenticated ?? false,
      user: status?.user ?? null,
      configured: status?.configured ?? true,
      piVersion: status?.version ?? null,
      busy,
      toast,
      closeToast: () => setToast(null),
      loginOpen,
      openLogin,
      closeLogin,
      logIn,
      logOut,
      changePassword,
      setSwitch,
      saveService,
      removeService,
      startUpgrade,
    }),
    [
      services, status, content, system, history, month, busy, toast, loginOpen,
      openLogin, closeLogin, logIn, logOut, changePassword, setSwitch, saveService, removeService, startUpgrade,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
