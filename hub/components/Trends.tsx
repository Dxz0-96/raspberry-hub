"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { useHub } from "@/lib/hub";
import { clock, decimal } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

interface Point { t: number; v: number }

/** A line chart for a single reading: current value in plain sight, value under the pointer on hover. */
function Chart({
  title,
  points,
  min,
  max,
  format,
  current,
}: {
  title: string;
  points: Point[];
  min: number;
  max: number;
  format: (v: number) => string;
  current: string;
}) {
  const { t, locale } = useI18n();
  const [cursor, setCursor] = useState<number | null>(null);
  const t0 = points[0]?.t ?? 0;
  const t1 = points[points.length - 1]?.t ?? 1;
  const x = (time: number) => ((time - t0) / Math.max(1, t1 - t0)) * 100;
  const y = (v: number) => 100 - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
  const line = useMemo(
    () => points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(2)} ${y(p.v).toFixed(2)}`).join(""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, min, max],
  );

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

  const picked = cursor !== null ? points[cursor] : null;
  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-title">{title}</span>
        <span className="chart-value">{picked ? t.trends.valueAt(format(picked.v), clock(picked.t, locale)) : current}</span>
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
                aria-label={t.trends.chartLabel(title, current, clock(t0, locale), clock(t1, locale),
                  format(Math.min(...points.map((p) => p.v))), format(Math.max(...points.map((p) => p.v))))}>
                <line className="chart-grid" x1="0" x2="100" y1="0.5" y2="0.5" />
                <line className="chart-grid" x1="0" x2="100" y1="50" y2="50" />
                <line className="chart-grid" x1="0" x2="100" y1="99.5" y2="99.5" />
                <path className="chart-line" d={line} />
              </svg>
              {picked && (
                <>
                  <span className="chart-cursor" style={{ left: `${x(picked.t)}%` }} />
                  <span className="chart-point" style={{ left: `${x(picked.t)}%`, top: `${y(picked.v)}%` }} />
                </>
              )}
            </>
          ) : (
            <p className="chart-empty">{t.trends.emptyHistory}</p>
          )}
        </div>
      </div>
      {points.length >= 2 && (
        <div className="chart-times" aria-hidden="true">
          <span>{clock(t0, locale)}</span>
          <span>{clock((t0 + t1) / 2, locale)}</span>
          <span>{clock(t1, locale)}</span>
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
  const { history, system } = useHub();
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState<"hour" | "day">("hour");
  const raw = period === "hour" ? history?.recent.points : history?.day.points;
  const cpu = useMemo<Point[]>(() => (raw ?? []).map((p) => ({ t: p[0], v: p[1] })), [raw]);
  const temp = useMemo<Point[]>(
    () => (raw ?? []).filter((p) => p[2] !== null).map((p) => ({ t: p[0], v: p[2] as number })),
    [raw],
  );
  const range = useMemo(() => {
    if (temp.length === 0) return { min: 30, max: 70 };
    const values = temp.map((p) => p.v);
    return {
      min: Math.floor((Math.min(...values) - 4) / 10) * 10,
      max: Math.ceil((Math.max(...values) + 4) / 10) * 10,
    };
  }, [temp]);
  const table = useMemo(() => {
    const rows = raw ?? [];
    const step = Math.max(1, Math.floor(rows.length / 12));
    return rows.filter((_, i) => i % step === 0 || i === rows.length - 1).slice(-13);
  }, [raw]);

  return (
    <section className="trends" aria-labelledby="trends-title">
      <div className="trends-head">
        <h2 id="trends-title">{t.trends.title}</h2>
        <div className="period" role="group" aria-label={t.trends.period}>
          <button type="button" aria-pressed={period === "hour"} onClick={() => setPeriod("hour")}>
            {t.trends.lastHour}
          </button>
          <button type="button" aria-pressed={period === "day"} onClick={() => setPeriod("day")}>
            {t.trends.day}
          </button>
        </div>
      </div>
      <div className="trends-grid">
        <Chart title={t.trends.cpu} points={cpu} min={0} max={100} format={(v) => `${Math.round(v)}%`}
          current={system ? `${Math.round(system.cpu.usage)}%` : "–"} />
        <Chart title={t.trends.temperature} points={temp} min={range.min} max={range.max} format={(v) => `${Math.round(v)} °C`}
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
      {table.length > 1 && (
        <details className="data-table">
          <summary>{t.trends.tableSummary}</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">{t.trends.time}</th>
                <th scope="col">{t.trends.cpu}</th>
                <th scope="col">{t.trends.temperature}</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row) => (
                <tr key={row[0]}>
                  <td>{clock(row[0], locale)}</td>
                  <td>{Math.round(row[1])}%</td>
                  <td>{row[2] === null ? "–" : `${decimal(row[2], locale)} °C`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
