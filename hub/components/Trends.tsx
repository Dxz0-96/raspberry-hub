"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { useHub } from "@/lib/hub";
import { clock, decimal, shortDay } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/** A reading at time t. In the month, v is the average of the hour and peak its highest reading. */
interface Point { t: number; v: number; peak?: number }

type Period = "hour" | "day" | "month";

/**
 * A line chart for a single reading: current value in plain sight, the value of a point in time under the
 * pointer or, from the keyboard, with the arrow keys (the chart is a slider over its points). With peaks, a
 * band runs from the line up to them.
 */
function Chart({
  title,
  points,
  min,
  max,
  format,
  current,
  dated,
  empty,
}: {
  title: string;
  points: Point[];
  min: number;
  max: number;
  format: (v: number) => string;
  current: string;
  /** the times on the axis and in the texts carry the date too (the month) */
  dated: boolean;
  empty: string;
}) {
  const { t, locale } = useI18n();
  const [cursor, setCursor] = useState<number | null>(null);
  const last = points.length - 1;
  const index = cursor === null ? null : Math.min(cursor, last);
  const t0 = points[0]?.t ?? 0;
  const t1 = points[last]?.t ?? 1;
  const x = (time: number) => ((time - t0) / Math.max(1, t1 - t0)) * 100;
  const y = (v: number) => 100 - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
  const path = (values: Point[], read: (p: Point) => number) =>
    values.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(2)} ${y(read(p)).toFixed(2)}`).join("");
  const line = useMemo(
    () => path(points, (p) => p.v),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, min, max],
  );
  const band = useMemo(
    () =>
      points.some((p) => p.peak !== undefined)
        ? `${path(points, (p) => p.peak ?? p.v)}${path([...points].reverse(), (p) => p.v).replace(/^M/, "L")}Z`
        : "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, min, max],
  );

  const when = (time: number) => (dated ? t.trends.dayTime(shortDay(time, locale), clock(time, locale)) : clock(time, locale));
  const describe = (p: Point) =>
    p.peak !== undefined
      ? t.trends.hourAt(format(p.v), format(p.peak), shortDay(p.t, locale), clock(p.t, locale))
      : t.trends.valueAt(format(p.v), dated ? when(p.t) : clock(p.t, locale));

  function move(event: PointerEvent<HTMLDivElement>) {
    if (points.length < 2) return;
    const box = event.currentTarget.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const target = t0 + share * (t1 - t0);
    let nearest = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].t - target) < Math.abs(points[nearest].t - target)) nearest = i;
    }
    setCursor(nearest);
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setCursor(null);
      return;
    }
    const from = index ?? last;
    const page = Math.max(1, Math.round(points.length / 10));
    const next = ({
      ArrowLeft: from - 1, ArrowDown: from - 1, ArrowRight: from + 1, ArrowUp: from + 1,
      PageDown: from - page, PageUp: from + page, Home: 0, End: last,
    } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setCursor(Math.max(0, Math.min(last, next)));
  }

  const picked = index !== null ? points[index] : null;
  const values = points.map((p) => p.v);
  const peaks = points.map((p) => p.peak ?? p.v);
  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-title">{title}</span>
        <span className="chart-value">{picked ? describe(picked) : current}</span>
      </figcaption>
      <div className="chart-body">
        <div className="chart-axis" aria-hidden="true">
          <span>{format(max)}</span>
          <span>{format((max + min) / 2)}</span>
          <span>{format(min)}</span>
        </div>
        <div className="chart-area" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setCursor(null)}>
          {points.length >= 2 ? (
            <>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
                aria-label={t.trends.chartLabel(title, current, when(t0), when(t1),
                  format(Math.min(...values)), format(Math.max(...peaks)))}>
                <line className="chart-grid" x1="0" x2="100" y1="0.5" y2="0.5" />
                <line className="chart-grid" x1="0" x2="100" y1="50" y2="50" />
                <line className="chart-grid" x1="0" x2="100" y1="99.5" y2="99.5" />
                {band && <path className="chart-band" d={band} />}
                <path className="chart-line" d={line} />
              </svg>
              {picked && (
                <>
                  <span className="chart-cursor" style={{ left: `${x(picked.t)}%` }} />
                  <span className="chart-point" style={{ left: `${x(picked.t)}%`, top: `${y(picked.v)}%` }} />
                </>
              )}
              {/* a slider over the points, so the values can be read without a pointer */}
              <div className="chart-scrub" role="slider" tabIndex={0} aria-label={title}
                aria-valuemin={0} aria-valuemax={last} aria-valuenow={index ?? last}
                aria-valuetext={describe(points[index ?? last])}
                onKeyDown={key} onBlur={() => setCursor(null)} />
            </>
          ) : (
            <p className="chart-empty">{empty}</p>
          )}
        </div>
      </div>
      {points.length >= 2 && (
        <div className="chart-times" aria-hidden="true">
          <span>{when(t0)}</span>
          <span>{when((t0 + t1) / 2)}</span>
          <span>{when(t1)}</span>
        </div>
      )}
    </figure>
  );
}

/** Hardware alerts: they appear only when something needs attention. */
export function HardwareAlerts() {
  const { system } = useHub();
  const { t, locale } = useI18n();
  if (!system || system.alerts.length === 0) return null;
  return (
    <ul className="hardware-alerts">
      {system.alerts.map((kind) => (
        <li key={kind}>
          <TriangleAlert size={18} aria-hidden="true" />
          <span>
            {kind === "temperature" && t.alerts.temperature(decimal(system.temp ?? 0, locale))}
            {kind === "disk" && t.alerts.disk(Math.round(system.disk.percent_full).toString())}
            {kind === "power" && t.alerts.power}
            {kind === "load" && t.alerts.load(decimal(system.cpu.load[1], locale), system.cpu.count)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Processor and temperature over time, plus the busiest processes. */
export function Trends() {
  const { history, month, showMonth, system } = useHub();
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState<Period>("hour");

  // the month is read from the Raspberry Pi only while it is on screen
  useEffect(() => {
    showMonth(period === "month");
    return () => showMonth(false);
  }, [period, showMonth]);

  const cpu = useMemo<Point[]>(() => {
    if (period === "month") return (month?.points ?? []).map((p) => ({ t: p[0], v: p[1], peak: p[2] }));
    const raw = period === "hour" ? history?.recent.points : history?.day.points;
    return (raw ?? []).map((p) => ({ t: p[0], v: p[1] }));
  }, [period, history, month]);
  const temp = useMemo<Point[]>(() => {
    if (period === "month") {
      return (month?.points ?? []).filter((p) => p[3] !== null)
        .map((p) => ({ t: p[0], v: p[3] as number, peak: p[4] ?? (p[3] as number) }));
    }
    const raw = period === "hour" ? history?.recent.points : history?.day.points;
    return (raw ?? []).filter((p) => p[2] !== null).map((p) => ({ t: p[0], v: p[2] as number }));
  }, [period, history, month]);
  const range = useMemo(() => {
    if (temp.length === 0) return { min: 30, max: 70 };
    const values = temp.flatMap((p) => [p.v, p.peak ?? p.v]);
    return {
      min: Math.floor((Math.min(...values) - 4) / 10) * 10,
      max: Math.ceil((Math.max(...values) + 4) / 10) * 10,
    };
  }, [temp]);

  const periods: [Period, string][] = [["hour", t.trends.lastHour], ["day", t.trends.day], ["month", t.trends.month]];
  const dated = period === "month";
  const empty = dated ? t.trends.emptyMonth : t.trends.emptyHistory;
  return (
    <section className="trends" aria-labelledby="trends-title">
      <div className="trends-head">
        <h2 id="trends-title">{t.trends.title}</h2>
        <div className="period" role="group" aria-label={t.trends.period}>
          {periods.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="trends-grid">
        <Chart key={`cpu-${period}`} title={t.trends.cpu} points={cpu} min={0} max={100}
          format={(v) => `${Math.round(v)}%`} dated={dated} empty={empty}
          current={system ? `${Math.round(system.cpu.usage)}%` : "–"} />
        <Chart key={`temp-${period}`} title={t.trends.temperature} points={temp} min={range.min} max={range.max}
          format={(v) => `${Math.round(v)} °C`} dated={dated} empty={empty}
          current={system?.temp != null ? `${decimal(system.temp, locale)} °C` : "–"} />
        <div className="processes">
          <h3>{t.trends.topProcesses}</h3>
          {system && system.processes.length > 0 ? (
            <ol>
              {system.processes.map((p) => (
                <li key={p.name}>
                  <span className="process-name">{p.name}</span>
                  <span className="process-bar" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, p.cpu)}%` }} />
                  </span>
                  <span className="process-usage">{decimal(p.cpu, locale)}%</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="chart-empty">{t.trends.noData}</p>
          )}
        </div>
      </div>
      {dated && cpu.length >= 2 && <p className="chart-legend">{t.trends.monthLegend}</p>}
    </section>
  );
}
