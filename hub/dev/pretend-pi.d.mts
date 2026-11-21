// Types of dev/pretend-pi.mjs, for lib/demo.ts (the module itself is plain JavaScript, shared with the mock).
import type { ContentStatus, Dns, History, LatestRelease, LiveState, SearchResult, Service, SystemInfo } from "../lib/types";
import type { MonthHistory } from "../lib/types";

export function wave(t: number, base: number, amplitude: number): number;
export function makeHistory(nowMs?: number): History & { power: NonNullable<History["power"]> };
export function makeMonth(nowMs?: number): MonthHistory["month"]["points"];
export function readings(options: { started: number; disk?: "sd" | "usb"; alerts?: string[] }): SystemInfo;
export function dns(): Dns;
export function contentStatus(latest: LatestRelease | null): ContentStatus;
export const NAS: Service;
export function serviceStates(
  services: Service[],
  options: { off: Set<string>; blocking: boolean; notDownloaded?: Set<string> },
): Record<string, LiveState>;
export const PLACES: SearchResult[];
export function search(query: string | null): { q: string; results: SearchResult[]; ms: number };
