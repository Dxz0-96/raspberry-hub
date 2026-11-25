"use client";

// The Raspberry Pi 3 Model B board seen from above: every reading is written on the component that
// produces it. Coordinates are tenths of a millimetre taken from the mechanical drawing of the board
// (85 × 56 mm). The labels on the board are in English in every language, like a real silkscreen.

import { useEffect, useRef, useState } from "react";
import { useHub } from "@/lib/hub";
import { bytes, duration } from "@/lib/format";
import type { SystemInfo } from "@/lib/types";

type Orientation = "horizontal" | "vertical";

/** Height of the centre of the cable pad, as a fraction of the height of the horizontal drawing
 *  (viewBox from y -8, 588 high; pad centred at y 14). Used by the cable towards the services. */
export const CABLE_Y = (14 + 8) / 588;
interface Rect { x: number; y: number; w: number; h: number }
type Point = [number, number];

interface Geometry {
  viewBox: string;
  board: Rect;
  holes: Point[];
  gpio: Rect;
  soc: Rect;
  ram: Rect;
  lan: Rect;
  usb: Rect[];
  eth: Rect;
  hdmi: Rect;
  pwr: Rect;
  av: Rect;
  csi: Rect;
  dsi: Rect;
  sd: Rect;
  ant: Rect;
  /** size of the small labels, in drawing units */
  label: number;
  text: Record<"model" | "gpio" | "wifi" | "dsi" | "sd" | "csi" | "av" | "pwr" | "led" | "usb" | "hdmi" | "eth", Point>;
  traces: string[];
}

const HORIZONTAL: Geometry = {
  viewBox: "-30 -8 908 588",
  board: { x: 0, y: 0, w: 850, h: 560 },
  holes: [[35, 35], [615, 35], [35, 525], [615, 525]],
  gpio: { x: 70, y: 9, w: 508, h: 52 },
  soc: { x: 205, y: 175, w: 170, h: 170 },
  ram: { x: 395, y: 190, w: 150, h: 110 },
  lan: { x: 560, y: 250, w: 90, h: 90 },
  usb: [{ x: 700, y: 24, w: 170, h: 132 }, { x: 700, y: 204, w: 170, h: 132 }],
  eth: { x: 660, y: 377, w: 210, h: 160 },
  hdmi: { x: 245, y: 492, w: 150, h: 80 },
  pwr: { x: 66, y: 492, w: 150, h: 80 },
  av: { x: 500, y: 487, w: 70, h: 85 },
  csi: { x: 437, y: 330, w: 25, h: 220 },
  dsi: { x: 28, y: 128, w: 25, h: 86 },
  sd: { x: -24, y: 222, w: 149, h: 116 },
  ant: { x: 20, y: 78, w: 12, h: 44 },
  label: 18,
  text: {
    model: [215, 92], gpio: [72, 84], wifi: [44, 112], dsi: [62, 178], sd: [6, 250], csi: [472, 398],
    av: [502, 476], pwr: [80, 522], led: [16, 414], usb: [712, 187], hdmi: [297, 540], eth: [674, 404],
  },
  traces: [
    "M350 175V154H490.1V61", "M360 175V162H515.5V61", "M370 175V170H540.9V61",
    "M375 205H395", "M375 221H395", "M375 237H395", "M375 253H395",
    "M375 318H560", "M375 330H560",
    "M590 250V110H700", "M606 250V126H700", "M650 274H700", "M650 290H700",
    "M620 340V420H660", "M604 340V436H660",
    "M290 345V492", "M304 345V492", "M318 345V492",
    "M360 345V372H437", "M348 345V384H437",
    "M140 492V428H240V345",
  ],
};

// The same board turned a quarter turn clockwise: (x, y) -> (560 - y, x).
const VERTICAL: Geometry = {
  viewBox: "-20 -32 596 912",
  board: { x: 0, y: 0, w: 560, h: 850 },
  holes: [[525, 35], [525, 615], [35, 35], [35, 615]],
  gpio: { x: 499, y: 70, w: 52, h: 508 },
  soc: { x: 215, y: 205, w: 170, h: 170 },
  ram: { x: 240, y: 395, w: 150, h: 110 },
  lan: { x: 220, y: 560, w: 90, h: 90 },
  usb: [{ x: 404, y: 700, w: 132, h: 170 }, { x: 224, y: 700, w: 132, h: 170 }],
  eth: { x: 23, y: 660, w: 160, h: 210 },
  hdmi: { x: -12, y: 245, w: 80, h: 150 },
  pwr: { x: -12, y: 66, w: 80, h: 150 },
  av: { x: -12, y: 500, w: 85, h: 70 },
  csi: { x: 10, y: 437, w: 220, h: 25 },
  dsi: { x: 346, y: 28, w: 80, h: 25 },
  sd: { x: 222, y: -24, w: 116, h: 149 },
  ant: { x: 432, y: 20, w: 44, h: 12 },
  label: 19,
  text: {
    model: [215, 152], gpio: [418, 420], wifi: [432, 52], dsi: [346, 76], sd: [230, 40], csi: [40, 428],
    av: [82, 541], pwr: [22, 204], led: [132, 24], usb: [300, 688], hdmi: [2, 326], eth: [35, 690],
  },
  traces: [
    "M385 350H406V490.1H499", "M385 360H398V515.5H499", "M385 370H390V540.9H499",
    "M260 375V395", "M276 375V395", "M292 375V395", "M308 375V395",
    "M242 375V560", "M230 375V560",
    "M310 590H450V700", "M310 606H434V700", "M286 650V700", "M270 650V700",
    "M220 620H140V660", "M220 604H124V660",
    "M215 290H68", "M215 304H68", "M215 318H68",
    "M215 360H188V437", "M215 348H176V437",
    "M68 136H132V240H215",
  ],
};

/** Makes a number glide to its new value instead of jumping. */
function useSmoothValue(value: number | null | undefined): number | null {
  const [shown, setShown] = useState<number | null>(value ?? null);
  const current = useRef<number | null>(value ?? null);
  useEffect(() => {
    if (value === null || value === undefined) {
      current.current = null;
      setShown(null);
      return;
    }
    const from = current.current;
    if (from === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      const eased = 1 - (1 - t) ** 3;
      const next = from + (value - from) * eased;
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}

/** A reading that glides to its new value. Only this text is drawn again on every frame of the glide, not the
 *  whole board: the home page has two boards (one hidden, for the other screen size). */
function Smooth({ value, format }: { value: number | null | undefined; format: (shown: number | null) => string }) {
  return <>{format(useSmoothValue(value))}</>;
}

function megabit(bps: number): string {
  const mbit = bps / 1_000_000;
  if (mbit >= 100) return mbit.toFixed(0);
  if (mbit >= 1) return mbit.toFixed(1);
  if (mbit >= 0.095) return mbit.toFixed(1);
  return mbit.toFixed(2);
}

function Drawing({ g, s, orientation, cable = false }: { g: Geometry; s: SystemInfo | null; orientation: Orientation; cable?: boolean }) {
  const vert = orientation === "vertical";
  const L = g.label;
  const used = s ? bytes(s.mem.used, "en") : null;
  const total = s ? bytes(s.mem.total, "en") : null;
  const disk = s ? bytes(s.disk.used, "en") : null;
  const diskTotal = s ? bytes(s.disk.total, "en") : null;
  const hot = s?.alerts.includes("temperature") ?? false;
  const full = s?.alerts.includes("disk") ?? false;
  const voltage = s?.power ? (s.power.undervoltage ? "undervolt" : s.power.throttled ? "throttled" : "5 V ok") : "5 V";
  const powerFault = Boolean(s?.power && (s.power.undervoltage || s.power.throttled));
  const traffic = s ? s.net.rx + s.net.tx > 2000 : false;
  const model = (s?.model ?? "Raspberry Pi 3 Model B").replace(/\s+Rev.*$/i, "");
  const revision = /Rev\s*([\d.]+)/i.exec(s?.model ?? "")?.[1];
  const [mx, my] = g.text.model;
  const [ex, ey] = g.text.eth;
  const [sx, sy] = g.text.sd;
  const [px, py] = g.text.pwr;
  const [lx, ly] = g.text.led;
  const { soc, ram, lan, eth, sd } = g;

  const description = s
    ? `Raspberry Pi board, top view. CPU ${Math.round(s.cpu.usage)} percent, ${s.temp ?? "unknown"} degrees Celsius, load ${s.cpu.load[0]}. ` +
      `Memory ${used?.value} ${used?.unit} of ${total?.value} ${total?.unit}. microSD ${disk?.value} ${disk?.unit} of ${diskTotal?.value} ${diskTotal?.unit} used. ` +
      `Ethernet in ${megabit(s.net.rx)}, out ${megabit(s.net.tx)} megabit per second. Power ${voltage}. Uptime ${duration(s.uptime, "en")}.`
    : "Raspberry Pi board, top view. Waiting for readings.";

  return (
    <svg className={`board ${orientation}`} viewBox={g.viewBox} role="img" aria-label={description}>
      <rect className="s-base" x={g.board.x} y={g.board.y} width={g.board.w} height={g.board.h} rx="30" />

      <g className="s-traces">
        {g.traces.map((d, i) => (
          <path key={d} d={d} pathLength={1} style={{ animationDelay: `${120 + i * 45}ms` }} />
        ))}
      </g>

      {g.holes.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle className="s-ring" cx={x} cy={y} r="24" />
          <circle className="s-hole" cx={x} cy={y} r="14" />
        </g>
      ))}

      {/* GPIO: 2 rows of 20 pins, 2.54 mm pitch */}
      <rect className="s-black" x={g.gpio.x} y={g.gpio.y} width={g.gpio.w} height={g.gpio.h} rx="4" />
      {Array.from({ length: 40 }, (_, i) => {
        const along = 83.7 + Math.floor(i / 2) * 25.4;
        const row = i % 2 === 0 ? 22.3 : 47.7;
        const [x, y] = vert ? [560 - row, along] : [along, row];
        return <rect key={i} className="s-gold" x={x - 6} y={y - 6} width="12" height="12" rx="2" />;
      })}

      {/* pad on the edge: the cable towards the list of services starts here */}
      {cable && !vert && <rect className="s-cable-pad" x="766" y="9" width="28" height="10" rx="2" />}

      {/* small passive components */}
      <g className="s-passives">
        {(vert
          ? [[430, 250], [430, 268], [200, 420], [200, 438], [330, 600], [330, 618], [110, 300], [110, 318], [450, 640], [150, 580]]
          : [[640, 178], [658, 178], [420, 360], [438, 360], [600, 222], [618, 222], [160, 140], [178, 140], [640, 86], [600, 470]]
        ).map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={vert ? 8 : 12} height={vert ? 12 : 8} rx="1.5" />
        ))}
      </g>

      {/* Wi-Fi antenna and ribbon connectors */}
      <rect className="s-ceramic" x={g.ant.x} y={g.ant.y} width={g.ant.w} height={g.ant.h} rx="2" />
      <text className="s-label" x={g.text.wifi[0]} y={g.text.wifi[1]} fontSize={L}>{vert ? "Wi-Fi" : "Wi-Fi, BT"}</text>
      <rect className="s-ribbon" x={g.dsi.x} y={g.dsi.y} width={g.dsi.w} height={g.dsi.h} rx="3" />
      <text className="s-label" x={g.text.dsi[0]} y={g.text.dsi[1]} fontSize={L}>DSI display</text>
      <rect className="s-ribbon" x={g.csi.x} y={g.csi.y} width={g.csi.w} height={g.csi.h} rx="3" />
      <text className="s-label" x={g.text.csi[0]} y={g.text.csi[1]} fontSize={L}>CSI camera</text>
      {vert ? (
        <>
          <text className="s-label" x={g.text.gpio[0]} y={g.text.gpio[1]} fontSize={L}>GPIO</text>
          <text className="s-label" x={g.text.gpio[0]} y={g.text.gpio[1] + 22} fontSize={L}>40 pin</text>
        </>
      ) : (
        <text className="s-label" x={g.text.gpio[0]} y={g.text.gpio[1]} fontSize={L}>GPIO, 40 pin</text>
      )}

      {/* silkscreen: model, address, uptime */}
      <text className="s-label" x={mx} y={my} fontSize={L}>{model}</text>
      <text className="s-label" x={mx} y={my + 22} fontSize={L}>
        {[s?.ip, revision ? `Rev ${revision}` : null].filter(Boolean).join(", ") || "waiting for data"}
      </text>
      {s && <text className="s-label" x={mx} y={my + 44} fontSize={L}>up {duration(s.uptime, "en")}</text>}

      {/* microSD: sits under the board and sticks out of the edge */}
      <rect className={`s-underside${full ? " fault" : ""}`} x={sd.x} y={sd.y} width={sd.w} height={sd.h} rx="6" />
      {vert ? (
        <rect className="s-chip" x={sd.x + 8} y={sd.y} width={sd.w - 16} height="22" rx="3" />
      ) : (
        <rect className="s-chip" x={sd.x} y={sd.y + 8} width="22" height={sd.h - 16} rx="3" />
      )}
      <text className="s-label" x={sx} y={sy} fontSize={L}>microSD</text>
      <text className={`s-value${full ? " fault" : ""}`} x={sx} y={sy + (vert ? 30 : 32)} fontSize={vert ? 26 : 28}>
        {disk ? `${disk.value} ${disk.unit}` : "–"}
      </text>
      <text className="s-label" x={sx} y={sy + (vert ? 50 : 54)} fontSize="17">
        {diskTotal ? `of ${diskTotal.value} ${diskTotal.unit}` : ""}
      </text>
      {!vert && s && (
        <>
          <rect className="s-bar" x={sx} y={sy + 64} width="104" height="6" rx="3" />
          <rect className={`s-bar-fill${full ? " fault" : ""}`} x={sx} y={sy + 64} width={Math.max(4, (104 * s.disk.percent_full) / 100)} height="6" rx="3" />
        </>
      )}

      {/* SoC: processor, temperature, load, one bar per core */}
      <rect className={`s-chip${hot ? " fault" : ""}`} x={soc.x} y={soc.y} width={soc.w} height={soc.h} rx="8" />
      <rect className="s-chip-edge" x={soc.x + 7} y={soc.y + 7} width={soc.w - 14} height={soc.h - 14} rx="5" />
      <text className="s-label" x={soc.x + 14} y={soc.y + 30} fontSize={L}>BCM2837 CPU</text>
      <text className="s-value" x={soc.x + 14} y={soc.y + 74} fontSize="42">
        <Smooth value={s?.cpu.usage} format={(cpu) => (cpu === null ? "–" : `${Math.round(cpu)}%`)} />
      </text>
      <text className={`s-value${hot ? " fault" : ""}`} x={soc.x + 14} y={soc.y + 105} fontSize="25">
        <Smooth value={s?.temp} format={(temp) => (temp === null ? "– °C" : `${temp.toFixed(1)} °C`)} />
      </text>
      <text className="s-label" x={soc.x + 14} y={soc.y + 129} fontSize={L}>
        {s ? `load ${s.cpu.load[0].toFixed(2)}` : ""}
      </text>
      {(s?.cpu.cores ?? [0, 0, 0, 0]).slice(0, 4).map((usage, i) => (
        <g key={i}>
          <rect className="s-bar" x={soc.x + 14 + i * 37} y={soc.y + 141} width="31" height="14" rx="2" />
          <rect className="s-bar-fill" x={soc.x + 14 + i * 37} y={soc.y + 141 + 14 * (1 - Math.min(100, usage) / 100)}
            width="31" height={(14 * Math.min(100, usage)) / 100} rx="2" />
        </g>
      ))}

      {/* RAM: soldered on the bottom side, which is why it is dashed */}
      <rect className="s-underside" x={ram.x} y={ram.y} width={ram.w} height={ram.h} rx="6" />
      <text className="s-label" x={ram.x + 11} y={ram.y + 26} fontSize={L}>LPDDR2 RAM</text>
      <text className="s-value" x={ram.x + 11} y={ram.y + 60} fontSize="30">
        {used ? `${used.value} ${used.unit}` : "–"}
      </text>
      <text className="s-label" x={ram.x + 11} y={ram.y + 84} fontSize={L}>
        {total ? `of ${total.value} ${total.unit}` : ""}
      </text>
      {s && (
        <>
          <rect className="s-bar" x={ram.x + 11} y={ram.y + 93} width={ram.w - 22} height="6" rx="3" />
          <rect className="s-bar-fill" x={ram.x + 11} y={ram.y + 93}
            width={Math.max(4, ((ram.w - 22) * s.mem.used) / Math.max(1, s.mem.total))} height="6" rx="3" />
        </>
      )}

      {/* USB and network controller */}
      <rect className="s-chip" x={lan.x} y={lan.y} width={lan.w} height={lan.h} rx="6" />
      <text className="s-label" x={lan.x + 7} y={lan.y + 52} fontSize={L - 1}>LAN9514</text>

      {/* USB ports */}
      {g.usb.map((u) => (
        <g key={`${u.x}-${u.y}`}>
          <rect className="s-tin" x={u.x} y={u.y} width={u.w} height={u.h} rx="5" />
          {vert ? (
            <>
              <rect className="s-socket" x={u.x + 18} y={u.y + 14} width="36" height={u.h - 28} rx="3" />
              <rect className="s-socket" x={u.x + 78} y={u.y + 14} width="36" height={u.h - 28} rx="3" />
            </>
          ) : (
            <>
              <rect className="s-socket" x={u.x + 14} y={u.y + 18} width={u.w - 28} height="36" rx="3" />
              <rect className="s-socket" x={u.x + 14} y={u.y + 78} width={u.w - 28} height="36" rx="3" />
            </>
          )}
        </g>
      ))}
      <text className="s-label" x={g.text.usb[0]} y={g.text.usb[1]} fontSize={L}>USB 2.0</text>

      {/* Ethernet */}
      <rect className="s-tin" x={eth.x} y={eth.y} width={eth.w} height={eth.h} rx="5" />
      <text className="s-on-tin" x={ex} y={ey} fontSize={L}>Ethernet</text>
      <text className="s-on-tin strong" x={ex} y={ey + 30} fontSize="23">in {s ? megabit(s.net.rx) : "–"}</text>
      <text className="s-on-tin strong" x={ex} y={ey + 58} fontSize="23">out {s ? megabit(s.net.tx) : "–"}</text>
      <text className="s-on-tin" x={ex} y={ey + 82} fontSize={L}>Mbit/s</text>
      <text className="s-on-tin" x={ex} y={ey + 104} fontSize={L}>
        {s ? (s.net.link_up ? `link ${s.net.mbit ?? ""}`.trim() : "no link") : ""}
      </text>
      <circle className={`s-led green${s?.net.link_up ? " on" : ""}`} cx={eth.x + eth.w - 44} cy={eth.y + eth.h - 18} r="7" />
      <circle className={`s-led amber${traffic ? " blink" : ""}`} cx={eth.x + eth.w - 20} cy={eth.y + eth.h - 18} r="7" />

      {/* HDMI, audio, power */}
      <rect className="s-tin" x={g.hdmi.x} y={g.hdmi.y} width={g.hdmi.w} height={g.hdmi.h} rx="5" />
      <text className="s-on-tin" x={g.text.hdmi[0]} y={g.text.hdmi[1]} fontSize={L}>HDMI</text>
      <rect className="s-black" x={g.av.x} y={g.av.y} width={g.av.w} height={g.av.h} rx="5" />
      <circle className="s-socket" cx={vert ? g.av.x + 16 : g.av.x + g.av.w / 2} cy={vert ? g.av.y + g.av.h / 2 : g.av.y + g.av.h - 16} r="11" />
      <text className="s-label" x={g.text.av[0]} y={g.text.av[1]} fontSize={L}>A/V</text>
      <rect className="s-tin" x={g.pwr.x} y={g.pwr.y} width={g.pwr.w} height={g.pwr.h} rx="5" />
      {vert ? (
        <g transform={`translate(${px} ${py}) rotate(-90)`}>
          <text className="s-on-tin" x="0" y="0" fontSize={L}>Power in</text>
          <text className={`s-on-tin strong${powerFault ? " fault" : ""}`} x="0" y="26" fontSize="20">{voltage}</text>
        </g>
      ) : (
        <>
          <text className="s-on-tin" x={px} y={py} fontSize={L}>Power in</text>
          <text className={`s-on-tin strong${powerFault ? " fault" : ""}`} x={px} y={py + 28} fontSize="22">{voltage}</text>
        </>
      )}

      {/* LEDs: PWR steady when the power supply is fine, ACT when the microSD is working */}
      <circle className={`s-led red${s && !powerFault ? " on" : ""}`} cx={lx} cy={ly + 34} r="7" />
      <text className="s-label" x={lx + 14} y={ly + 40} fontSize={L - 1}>PWR</text>
      <circle className={`s-led green${s && s.disk.io_rate > 0 ? " blink" : ""}`} cx={lx} cy={ly} r="7" />
      <text className="s-label" x={lx + 14} y={ly + 6} fontSize={L - 1}>ACT</text>
    </svg>
  );
}

/** The detailed board. "auto" turns it vertical on narrow screens; "cable" adds the pad the connection
 *  to the list of services starts from (home page only). */
export function Board({ orientation = "horizontal", cable = false }: { orientation?: Orientation | "auto"; cable?: boolean }) {
  const { system } = useHub();
  if (orientation === "auto") {
    return (
      <>
        <div className="wide-only"><Drawing g={HORIZONTAL} s={system} orientation="horizontal" /></div>
        <div className="narrow-only"><Drawing g={VERTICAL} s={system} orientation="vertical" /></div>
      </>
    );
  }
  return <Drawing g={orientation === "vertical" ? VERTICAL : HORIZONTAL} s={system} orientation={orientation} cable={cable} />;
}
