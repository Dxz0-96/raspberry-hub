"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useHub } from "@/lib/hub";
import type { LiveState, Service } from "@/lib/types";
import { CABLE_Y } from "./Board";

/** How many pulses to send towards a service (0-3), based on the visits per minute. */
export function pulsesFor(s: Service, live: LiveState | undefined): number {
  const perMinute = live?.activity ?? 0;
  if (!live || live.state !== "on" || perMinute <= 0) return 0;
  // Pi-hole always answers somebody: higher thresholds
  const thresholds = s.type === "pihole" ? [1, 120, 400] : [1, 20, 90];
  return thresholds.filter((threshold) => perMinute >= threshold).length;
}

/** Pixels per second: with more traffic the pulses are denser and faster. */
const SPEED = [0, 170, 240, 330];

type Path = { d: string; length: number; endX: number; endY: number };
type Layout = { width: number; height: number; paths: Record<string, Path> };

const n = (v: number) => v.toFixed(1);

/** Measures the traces in .home-grid coordinates: from the pad on the board, along the cable and the
 *  backbone, to the terminal of each service. With board and services stacked there is no cable and
 *  the pulses start at the top of the backbone. */
function measure(grid: HTMLElement): Layout | null {
  const c = grid.getBoundingClientRect();
  const branches = Array.from(grid.querySelectorAll<HTMLElement>(".row[data-service] > .branch"));
  if (!branches.length || !c.width) return null;
  // the branch starts from the backbone; the terminal is the 10 px circle sticking out 9 px to the right
  const points = branches.map((b) => {
    const r = b.getBoundingClientRect();
    const x = r.left - c.left + 1;
    return { id: b.parentElement!.dataset.service!, x, y: r.top + r.height / 2 - c.top, end: x - 1 + b.offsetWidth + 4 };
  });
  const board = grid.querySelector<HTMLElement>(".home-board");
  const pad = grid.querySelector(".s-cable-pad")?.getBoundingClientRect();
  const withCable = Boolean(board && pad?.width && getComputedStyle(board, "::after").display !== "none");

  const paths: Record<string, Path> = {};
  for (const p of points) {
    let d: string;
    let length: number;
    if (withCable && pad) {
      const px = pad.left + pad.width / 2 - c.left;
      const py = pad.top + pad.height / 2 - c.top;
      d = `M${n(px)} ${n(py)}H${n(p.x)}V${n(p.y)}H${n(p.end)}`;
      length = Math.abs(p.x - px) + Math.abs(p.y - py) + (p.end - p.x);
    } else {
      const start = points[0].y;
      d = `M${n(p.x)} ${n(start)}V${n(p.y)}H${n(p.end)}`;
      length = p.y - start + (p.end - p.x);
    }
    paths[p.id] = { d, length, endX: p.end, endY: p.y };
  }
  return { width: c.width, height: c.height, paths };
}

/**
 * The traffic pulses: each dot starts from the gold pad on the edge of the board, runs along the cable
 * and the backbone and reaches the terminal of its service, which lights up on arrival.
 * Goes inside .home-grid (positioned). With "reduce motion" the stylesheet hides it.
 */
export function TrafficFlow() {
  const { services, states } = useHub();
  const ref = useRef<SVGSVGElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);

  useEffect(() => {
    const grid = ref.current?.parentElement;
    if (!grid) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let last = "";
    const update = () => {
      pending = undefined;
      // the cable must leave from the centre of the pad: the height (--cable-y) is used by board and services
      const drawing = grid.querySelector<SVGSVGElement>(".wide-only svg");
      if (drawing) grid.style.setProperty("--cable-y", `${(drawing.getBoundingClientRect().height * CABLE_Y).toFixed(1)}px`);
      const next = measure(grid);
      const signature = JSON.stringify(next);
      if (signature !== last) {
        last = signature;
        setLayout(next);
      }
    };
    const schedule = () => {
      // one measurement per burst of changes (setTimeout: works even with the browser tab hidden)
      if (pending === undefined) pending = setTimeout(update, 30);
    };
    schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(grid);
    // rows added, removed or wrapped
    const mutations = new MutationObserver(schedule);
    mutations.observe(grid, { childList: true, subtree: true });
    void document.fonts?.ready.then(schedule);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      clearTimeout(pending);
    };
  }, []);

  return (
    <svg ref={ref} className="flow" aria-hidden="true" width={layout?.width ?? 0} height={layout?.height ?? 0}>
      {layout &&
        services?.map((s, index) => {
          const count = pulsesFor(s, states?.[s.id]);
          const p = layout.paths[s.id];
          if (!count || !p) return null;
          const seconds = Math.max(1.2, p.length / SPEED[count]);
          return Array.from({ length: count }, (_, i) => {
            // dots of the same service evenly spaced; different services out of phase
            const timing = { dur: `${seconds.toFixed(2)}s`, begin: `-${((i * seconds) / count + index * 0.37).toFixed(2)}s`, repeatCount: "indefinite" };
            return (
              <Fragment key={`${s.id}-${count}-${i}`}>
                {/* on arrival (start of every lap) the terminal sends a ripple */}
                <circle className="flow-arrival" cx={n(p.endX)} cy={n(p.endY)} r="5" opacity="0">
                  <animate attributeName="r" values="5;12;12" keyTimes="0;0.16;1" {...timing} />
                  <animate attributeName="opacity" values="0.75;0;0" keyTimes="0;0.16;1" {...timing} />
                </circle>
                <circle className="flow-dot" r="3.5" opacity="0">
                  <animateMotion path={p.d} calcMode="paced" {...timing} />
                  <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.04;0.96;1" {...timing} />
                </circle>
              </Fragment>
            );
          });
        })}
    </svg>
  );
}
