"use client";

// La scheda del Raspberry Pi 3 Model B vista dall'alto: ogni misura è scritta sul componente che la
// produce. Le coordinate sono decimi di millimetro presi dal disegno meccanico della scheda (85 × 56 mm).
// Le scritte sulla scheda sono in inglese, come la serigrafia vera.

import { useEffect, useRef, useState } from "react";
import { useHub } from "@/lib/hub";
import { durataInglese, pesoInglese } from "@/lib/formati";
import type { Sistema } from "@/lib/tipi";

type Verso = "orizzontale" | "verticale";

/** Altezza del centro della piazzola del cavo, in frazione dell'altezza del disegno orizzontale
 *  (viewBox da y -8, alto 588; piazzola centrata a y 14). La usa il cavo verso i servizi. */
export const CAVO_Y = (14 + 8) / 588;
interface Ret { x: number; y: number; w: number; h: number }
type Punto = [number, number];

interface Geometria {
  vista: string;
  scheda: Ret;
  fori: Punto[];
  gpio: Ret;
  soc: Ret;
  ram: Ret;
  lan: Ret;
  usb: Ret[];
  eth: Ret;
  hdmi: Ret;
  pwr: Ret;
  av: Ret;
  csi: Ret;
  dsi: Ret;
  sd: Ret;
  ant: Ret;
  /** dimensione delle scritte piccole, in unità del disegno */
  eti: number;
  testo: Record<"modello" | "gpio" | "wifi" | "dsi" | "sd" | "csi" | "av" | "pwr" | "led" | "usb" | "hdmi" | "eth", Punto>;
  tracce: string[];
}

const ORIZZONTALE: Geometria = {
  vista: "-30 -8 908 588",
  scheda: { x: 0, y: 0, w: 850, h: 560 },
  fori: [[35, 35], [615, 35], [35, 525], [615, 525]],
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
  eti: 18,
  testo: {
    modello: [215, 92], gpio: [72, 84], wifi: [44, 112], dsi: [62, 178], sd: [6, 250], csi: [472, 398],
    av: [502, 476], pwr: [80, 522], led: [16, 414], usb: [712, 187], hdmi: [297, 540], eth: [674, 404],
  },
  tracce: [
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

// La stessa scheda girata di un quarto di giro in senso orario: (x, y) -> (560 - y, x).
const VERTICALE: Geometria = {
  vista: "-20 -32 596 912",
  scheda: { x: 0, y: 0, w: 560, h: 850 },
  fori: [[525, 35], [525, 615], [35, 35], [35, 615]],
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
  eti: 19,
  testo: {
    modello: [215, 152], gpio: [418, 420], wifi: [432, 52], dsi: [346, 76], sd: [230, 40], csi: [40, 428],
    av: [82, 541], pwr: [22, 204], led: [132, 24], usb: [300, 688], hdmi: [2, 326], eth: [35, 690],
  },
  tracce: [
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

/** Fa scorrere un numero verso il nuovo valore invece di farlo saltare. */
function useValoreMorbido(valore: number | null | undefined): number | null {
  const [mostrato, setMostrato] = useState<number | null>(valore ?? null);
  const attuale = useRef<number | null>(valore ?? null);
  useEffect(() => {
    if (valore === null || valore === undefined) {
      attuale.current = null;
      setMostrato(null);
      return;
    }
    const da = attuale.current;
    if (da === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      attuale.current = valore;
      setMostrato(valore);
      return;
    }
    const inizio = performance.now();
    let fotogramma = 0;
    const passo = (adesso: number) => {
      const t = Math.min(1, (adesso - inizio) / 700);
      const morbido = 1 - (1 - t) ** 3;
      const corrente = da + (valore - da) * morbido;
      attuale.current = corrente;
      setMostrato(corrente);
      if (t < 1) fotogramma = requestAnimationFrame(passo);
    };
    fotogramma = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(fotogramma);
  }, [valore]);
  return mostrato;
}

function megabit(bps: number): string {
  const mbit = bps / 1_000_000;
  if (mbit >= 100) return mbit.toFixed(0);
  if (mbit >= 1) return mbit.toFixed(1);
  if (mbit >= 0.095) return mbit.toFixed(1);
  return mbit.toFixed(2);
}

function Disegno({ g, s, verso, cavo = false }: { g: Geometria; s: Sistema | null; verso: Verso; cavo?: boolean }) {
  const cpu = useValoreMorbido(s?.cpu.uso);
  const temp = useValoreMorbido(s?.temp);
  const vert = verso === "verticale";
  const E = g.eti;
  const usata = s ? pesoInglese(s.mem.usata) : null;
  const totale = s ? pesoInglese(s.mem.totale) : null;
  const disco = s ? pesoInglese(s.disco.usato) : null;
  const discoTot = s ? pesoInglese(s.disco.totale) : null;
  const caldo = s?.avvisi.includes("temperatura") ?? false;
  const pieno = s?.avvisi.includes("disco") ?? false;
  const tensione = s?.alimentazione ? (s.alimentazione.sottotensione ? "undervolt" : s.alimentazione.rallentato ? "throttled" : "5 V ok") : "5 V";
  const tensioneMale = Boolean(s?.alimentazione && (s.alimentazione.sottotensione || s.alimentazione.rallentato));
  const traffico = s ? s.rete.giu + s.rete.su > 2000 : false;
  const modello = (s?.modello ?? "Raspberry Pi 3 Model B").replace(/\s+Rev.*$/i, "");
  const revisione = /Rev\s*([\d.]+)/i.exec(s?.modello ?? "")?.[1];
  const [mx, my] = g.testo.modello;
  const [ex, ey] = g.testo.eth;
  const [sx, sy] = g.testo.sd;
  const [px, py] = g.testo.pwr;
  const [lx, ly] = g.testo.led;
  const { soc, ram, lan, eth, sd } = g;

  const descrizione = s
    ? `Raspberry Pi board, top view. CPU ${Math.round(s.cpu.uso)} percent, ${s.temp ?? "unknown"} degrees Celsius, load ${s.cpu.carico[0]}. ` +
      `Memory ${usata?.valore} ${usata?.unita} of ${totale?.valore} ${totale?.unita}. microSD ${disco?.valore} ${disco?.unita} of ${discoTot?.valore} ${discoTot?.unita} used. ` +
      `Ethernet in ${megabit(s.rete.giu)}, out ${megabit(s.rete.su)} megabit per second. Power ${tensione}. Uptime ${durataInglese(s.acceso_da)}.`
    : "Raspberry Pi board, top view. Waiting for readings.";

  return (
    <svg className={`scheda ${verso}`} viewBox={g.vista} role="img" aria-label={descrizione}>
      <rect className="s-base" x={g.scheda.x} y={g.scheda.y} width={g.scheda.w} height={g.scheda.h} rx="30" />

      <g className="s-tracce">
        {g.tracce.map((d, i) => (
          <path key={d} d={d} pathLength={1} style={{ animationDelay: `${120 + i * 45}ms` }} />
        ))}
      </g>

      {g.fori.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle className="s-anello" cx={x} cy={y} r="24" />
          <circle className="s-foro" cx={x} cy={y} r="14" />
        </g>
      ))}

      {/* GPIO: 2 file da 20 piedini, passo 2,54 mm */}
      <rect className="s-nero" x={g.gpio.x} y={g.gpio.y} width={g.gpio.w} height={g.gpio.h} rx="4" />
      {Array.from({ length: 40 }, (_, i) => {
        const lungo = 83.7 + Math.floor(i / 2) * 25.4;
        const fila = i % 2 === 0 ? 22.3 : 47.7;
        const [x, y] = vert ? [560 - fila, lungo] : [lungo, fila];
        return <rect key={i} className="s-oro" x={x - 6} y={y - 6} width="12" height="12" rx="2" />;
      })}

      {/* piazzola sul bordo: da qui parte il cavo verso l'elenco dei servizi */}
      {cavo && !vert && <rect className="s-piazzola-cavo" x="766" y="9" width="28" height="10" rx="2" />}

      {/* piccoli componenti passivi */}
      <g className="s-passivi">
        {(vert
          ? [[430, 250], [430, 268], [200, 420], [200, 438], [330, 600], [330, 618], [110, 300], [110, 318], [450, 640], [150, 580]]
          : [[640, 178], [658, 178], [420, 360], [438, 360], [600, 222], [618, 222], [160, 140], [178, 140], [640, 86], [600, 470]]
        ).map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={vert ? 8 : 12} height={vert ? 12 : 8} rx="1.5" />
        ))}
      </g>

      {/* antenna Wi-Fi e connettori a nastro */}
      <rect className="s-ceramica" x={g.ant.x} y={g.ant.y} width={g.ant.w} height={g.ant.h} rx="2" />
      <text className="s-eti" x={g.testo.wifi[0]} y={g.testo.wifi[1]} fontSize={E}>{vert ? "Wi-Fi" : "Wi-Fi, BT"}</text>
      <rect className="s-nastro" x={g.dsi.x} y={g.dsi.y} width={g.dsi.w} height={g.dsi.h} rx="3" />
      <text className="s-eti" x={g.testo.dsi[0]} y={g.testo.dsi[1]} fontSize={E}>DSI display</text>
      <rect className="s-nastro" x={g.csi.x} y={g.csi.y} width={g.csi.w} height={g.csi.h} rx="3" />
      <text className="s-eti" x={g.testo.csi[0]} y={g.testo.csi[1]} fontSize={E}>CSI camera</text>
      {vert ? (
        <>
          <text className="s-eti" x={g.testo.gpio[0]} y={g.testo.gpio[1]} fontSize={E}>GPIO</text>
          <text className="s-eti" x={g.testo.gpio[0]} y={g.testo.gpio[1] + 22} fontSize={E}>40 pin</text>
        </>
      ) : (
        <text className="s-eti" x={g.testo.gpio[0]} y={g.testo.gpio[1]} fontSize={E}>GPIO, 40 pin</text>
      )}

      {/* serigrafia: modello, indirizzo, da quanto è acceso */}
      <text className="s-eti" x={mx} y={my} fontSize={E}>{modello}</text>
      <text className="s-eti" x={mx} y={my + 22} fontSize={E}>
        {[s?.ip, revisione ? `Rev ${revisione}` : null].filter(Boolean).join(", ") || "waiting for data"}
      </text>
      {s && <text className="s-eti" x={mx} y={my + 44} fontSize={E}>up {durataInglese(s.acceso_da)}</text>}

      {/* microSD: sta sotto la scheda, sporge dal bordo */}
      <rect className={`s-sotto${pieno ? " male" : ""}`} x={sd.x} y={sd.y} width={sd.w} height={sd.h} rx="6" />
      {vert ? (
        <rect className="s-chip" x={sd.x + 8} y={sd.y} width={sd.w - 16} height="22" rx="3" />
      ) : (
        <rect className="s-chip" x={sd.x} y={sd.y + 8} width="22" height={sd.h - 16} rx="3" />
      )}
      <text className="s-eti" x={sx} y={sy} fontSize={E}>microSD</text>
      <text className={`s-val${pieno ? " male" : ""}`} x={sx} y={sy + (vert ? 30 : 32)} fontSize={vert ? 26 : 28}>
        {disco ? `${disco.valore} ${disco.unita}` : "–"}
      </text>
      <text className="s-eti" x={sx} y={sy + (vert ? 50 : 54)} fontSize="17">
        {discoTot ? `of ${discoTot.valore} ${discoTot.unita}` : ""}
      </text>
      {!vert && s && (
        <>
          <rect className="s-barra" x={sx} y={sy + 64} width="104" height="6" rx="3" />
          <rect className={`s-barra-piena${pieno ? " male" : ""}`} x={sx} y={sy + 64} width={Math.max(4, (104 * s.disco.pieno) / 100)} height="6" rx="3" />
        </>
      )}

      {/* SoC: processore, temperatura, carico, un trattino per core */}
      <rect className={`s-chip${caldo ? " male" : ""}`} x={soc.x} y={soc.y} width={soc.w} height={soc.h} rx="8" />
      <rect className="s-chip-bordo" x={soc.x + 7} y={soc.y + 7} width={soc.w - 14} height={soc.h - 14} rx="5" />
      <text className="s-eti" x={soc.x + 14} y={soc.y + 30} fontSize={E}>BCM2837 CPU</text>
      <text className="s-val" x={soc.x + 14} y={soc.y + 74} fontSize="42">
        {cpu === null ? "–" : `${Math.round(cpu)}%`}
      </text>
      <text className={`s-val${caldo ? " male" : ""}`} x={soc.x + 14} y={soc.y + 105} fontSize="25">
        {temp === null ? "– °C" : `${temp.toFixed(1)} °C`}
      </text>
      <text className="s-eti" x={soc.x + 14} y={soc.y + 129} fontSize={E}>
        {s ? `load ${s.cpu.carico[0].toFixed(2)}` : ""}
      </text>
      {(s?.cpu.core ?? [0, 0, 0, 0]).slice(0, 4).map((uso, i) => (
        <g key={i}>
          <rect className="s-barra" x={soc.x + 14 + i * 37} y={soc.y + 141} width="31" height="14" rx="2" />
          <rect className="s-barra-piena" x={soc.x + 14 + i * 37} y={soc.y + 141 + 14 * (1 - Math.min(100, uso) / 100)}
            width="31" height={(14 * Math.min(100, uso)) / 100} rx="2" />
        </g>
      ))}

      {/* RAM: saldata sul lato inferiore, per questo è tratteggiata */}
      <rect className="s-sotto" x={ram.x} y={ram.y} width={ram.w} height={ram.h} rx="6" />
      <text className="s-eti" x={ram.x + 11} y={ram.y + 26} fontSize={E}>LPDDR2 RAM</text>
      <text className="s-val" x={ram.x + 11} y={ram.y + 60} fontSize="30">
        {usata ? `${usata.valore} ${usata.unita}` : "–"}
      </text>
      <text className="s-eti" x={ram.x + 11} y={ram.y + 84} fontSize={E}>
        {totale ? `of ${totale.valore} ${totale.unita}` : ""}
      </text>
      {s && (
        <>
          <rect className="s-barra" x={ram.x + 11} y={ram.y + 93} width={ram.w - 22} height="6" rx="3" />
          <rect className="s-barra-piena" x={ram.x + 11} y={ram.y + 93}
            width={Math.max(4, ((ram.w - 22) * s.mem.usata) / Math.max(1, s.mem.totale))} height="6" rx="3" />
        </>
      )}

      {/* controller USB e rete */}
      <rect className="s-chip" x={lan.x} y={lan.y} width={lan.w} height={lan.h} rx="6" />
      <text className="s-eti" x={lan.x + 7} y={lan.y + 52} fontSize={E - 1}>LAN9514</text>

      {/* porte USB */}
      {g.usb.map((u) => (
        <g key={`${u.x}-${u.y}`}>
          <rect className="s-stagno" x={u.x} y={u.y} width={u.w} height={u.h} rx="5" />
          {vert ? (
            <>
              <rect className="s-vano" x={u.x + 18} y={u.y + 14} width="36" height={u.h - 28} rx="3" />
              <rect className="s-vano" x={u.x + 78} y={u.y + 14} width="36" height={u.h - 28} rx="3" />
            </>
          ) : (
            <>
              <rect className="s-vano" x={u.x + 14} y={u.y + 18} width={u.w - 28} height="36" rx="3" />
              <rect className="s-vano" x={u.x + 14} y={u.y + 78} width={u.w - 28} height="36" rx="3" />
            </>
          )}
        </g>
      ))}
      <text className="s-eti" x={g.testo.usb[0]} y={g.testo.usb[1]} fontSize={E}>USB 2.0</text>

      {/* Ethernet */}
      <rect className="s-stagno" x={eth.x} y={eth.y} width={eth.w} height={eth.h} rx="5" />
      <text className="s-su-stagno" x={ex} y={ey} fontSize={E}>Ethernet</text>
      <text className="s-su-stagno forte" x={ex} y={ey + 30} fontSize="23">in {s ? megabit(s.rete.giu) : "–"}</text>
      <text className="s-su-stagno forte" x={ex} y={ey + 58} fontSize="23">out {s ? megabit(s.rete.su) : "–"}</text>
      <text className="s-su-stagno" x={ex} y={ey + 82} fontSize={E}>Mbit/s</text>
      <text className="s-su-stagno" x={ex} y={ey + 104} fontSize={E}>
        {s ? (s.rete.collegata ? `link ${s.rete.mbit ?? ""}`.trim() : "no link") : ""}
      </text>
      <circle className={`s-led verde${s?.rete.collegata ? " acceso" : ""}`} cx={eth.x + eth.w - 44} cy={eth.y + eth.h - 18} r="7" />
      <circle className={`s-led ambra${traffico ? " lampeggia" : ""}`} cx={eth.x + eth.w - 20} cy={eth.y + eth.h - 18} r="7" />

      {/* HDMI, audio, alimentazione */}
      <rect className="s-stagno" x={g.hdmi.x} y={g.hdmi.y} width={g.hdmi.w} height={g.hdmi.h} rx="5" />
      <text className="s-su-stagno" x={g.testo.hdmi[0]} y={g.testo.hdmi[1]} fontSize={E}>HDMI</text>
      <rect className="s-nero" x={g.av.x} y={g.av.y} width={g.av.w} height={g.av.h} rx="5" />
      <circle className="s-vano" cx={vert ? g.av.x + 16 : g.av.x + g.av.w / 2} cy={vert ? g.av.y + g.av.h / 2 : g.av.y + g.av.h - 16} r="11" />
      <text className="s-eti" x={g.testo.av[0]} y={g.testo.av[1]} fontSize={E}>A/V</text>
      <rect className="s-stagno" x={g.pwr.x} y={g.pwr.y} width={g.pwr.w} height={g.pwr.h} rx="5" />
      {vert ? (
        <g transform={`translate(${px} ${py}) rotate(-90)`}>
          <text className="s-su-stagno" x="0" y="0" fontSize={E}>Power in</text>
          <text className={`s-su-stagno forte${tensioneMale ? " male" : ""}`} x="0" y="26" fontSize="20">{tensione}</text>
        </g>
      ) : (
        <>
          <text className="s-su-stagno" x={px} y={py} fontSize={E}>Power in</text>
          <text className={`s-su-stagno forte${tensioneMale ? " male" : ""}`} x={px} y={py + 28} fontSize="22">{tensione}</text>
        </>
      )}

      {/* LED: PWR fisso se l'alimentazione è regolare, ACT quando la microSD lavora */}
      <circle className={`s-led rosso${s && !tensioneMale ? " acceso" : ""}`} cx={lx} cy={ly + 34} r="7" />
      <text className="s-eti" x={lx + 14} y={ly + 40} fontSize={E - 1}>PWR</text>
      <circle className={`s-led verde${s && s.disco.attivita > 0 ? " lampeggia" : ""}`} cx={lx} cy={ly} r="7" />
      <text className="s-eti" x={lx + 14} y={ly + 6} fontSize={E - 1}>ACT</text>
    </svg>
  );
}

/** La scheda dettagliata. "auto" la gira in verticale sugli schermi stretti; "cavo" aggiunge la
 *  piazzola da cui parte il collegamento verso l'elenco dei servizi (solo nella pagina principale). */
export function Scheda({ verso = "orizzontale", cavo = false }: { verso?: Verso | "auto"; cavo?: boolean }) {
  const { sistema } = useHub();
  if (verso === "auto") {
    return (
      <>
        <div className="solo-largo"><Disegno g={ORIZZONTALE} s={sistema} verso="orizzontale" /></div>
        <div className="solo-stretto"><Disegno g={VERTICALE} s={sistema} verso="verticale" /></div>
      </>
    );
  }
  return <Disegno g={verso === "verticale" ? VERTICALE : ORIZZONTALE} s={sistema} verso={verso} cavo={cavo} />;
}

/** La scheda compatta per il telefono: stessi componenti principali, solo le cinque misure. */
export function SchedaCompatta() {
  const { sistema: s } = useHub();
  const cpu = useValoreMorbido(s?.cpu.uso);
  const temp = useValoreMorbido(s?.temp);
  const usata = s ? pesoInglese(s.mem.usata) : null;
  const disco = s ? pesoInglese(s.disco.usato) : null;
  const caldo = s?.avvisi.includes("temperatura") ?? false;
  const pieno = s?.avvisi.includes("disco") ?? false;
  const tensioneMale = Boolean(s?.alimentazione && (s.alimentazione.sottotensione || s.alimentazione.rallentato));
  const tensione = s?.alimentazione ? (s.alimentazione.sottotensione ? "low volt" : s.alimentazione.rallentato ? "throttled" : "5 V ok") : "5 V";
  const descrizione = s
    ? `Raspberry Pi board. CPU ${Math.round(s.cpu.uso)} percent, ${s.temp ?? "unknown"} degrees Celsius. Memory ${usata?.valore} ${usata?.unita}. ` +
      `microSD ${disco?.valore} ${disco?.unita} used. Ethernet in ${megabit(s.rete.giu)}, out ${megabit(s.rete.su)} megabit per second. Power ${tensione}.`
    : "Raspberry Pi board. Waiting for readings.";
  return (
    <svg className="scheda compatta" viewBox="-1 -1 345 232" role="img" aria-label={descrizione}>
      <rect className="s-base" x="0" y="0" width="343" height="226" rx="11" />
      <g className="s-tracce sottili">
        {["M118 64V44H74V27", "M174 86H184", "M174 132H250V150H270", "M86 124H68V136H24V152", "M65 204V194H130V150", "M152 150V204"].map((d, i) => (
          <path key={d} d={d} pathLength={1} style={{ animationDelay: `${100 + i * 70}ms` }} />
        ))}
      </g>
      {[[16, 17], [246, 17], [16, 209], [246, 209]].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle className="s-anello sottile" cx={x} cy={y} r="6.5" />
          <circle className="s-foro" cx={x} cy={y} r="3.5" />
        </g>
      ))}
      <rect className="s-nero" x="30" y="8" width="204" height="18" rx="2" />
      {Array.from({ length: 40 }, (_, i) => (
        <rect key={i} className="s-oro" x={35 + Math.floor(i / 2) * 10} y={i % 2 === 0 ? 11 : 19} width="4.5" height="4.5" rx="0.8" />
      ))}

      <rect className={`s-chip${caldo ? " male" : ""}`} x="86" y="64" width="88" height="86" rx="5" />
      <text className="s-eti" x="95" y="82" fontSize="11.5">CPU</text>
      <text className="s-val" x="95" y="110" fontSize="23">{cpu === null ? "–" : `${Math.round(cpu)}%`}</text>
      <text className={`s-val${caldo ? " male" : ""}`} x="95" y="134" fontSize="15">
        {temp === null ? "– °C" : `${Math.round(temp)} °C`}
      </text>

      <rect className="s-sotto" x="184" y="64" width="78" height="54" rx="4" />
      <text className="s-eti" x="191" y="82" fontSize="11.5">RAM</text>
      <text className="s-val" x="191" y="104" fontSize="15">{usata ? `${usata.valore} ${usata.unita}` : "–"}</text>

      <rect className="s-stagno" x="282" y="32" width="62" height="34" rx="3" />
      <rect className="s-stagno" x="282" y="74" width="62" height="34" rx="3" />
      <rect className="s-stagno" x="270" y="122" width="74" height="78" rx="3" />
      <text className="s-su-stagno" x="277" y="140" fontSize="11.5">LAN</text>
      <text className="s-su-stagno forte" x="277" y="160" fontSize="13">in {s ? megabit(s.rete.giu) : "–"}</text>
      <text className="s-su-stagno forte" x="277" y="178" fontSize="13">out {s ? megabit(s.rete.su) : "–"}</text>
      <text className="s-su-stagno" x="277" y="194" fontSize="11">Mbit/s</text>

      <rect className={`s-sotto${pieno ? " male" : ""}`} x="-1" y="152" width="80" height="42" rx="3" />
      <rect className="s-chip" x="-1" y="158" width="8" height="30" rx="1.5" />
      <text className="s-eti" x="14" y="169" fontSize="11.5">microSD</text>
      <text className={`s-val${pieno ? " male" : ""}`} x="14" y="187" fontSize="15">{disco ? `${disco.valore} ${disco.unita}` : "–"}</text>

      <rect className="s-stagno" x="36" y="204" width="58" height="24" rx="3" />
      <text className={`s-su-stagno forte${tensioneMale ? " male" : ""}`} x="42" y="220" fontSize="12.5">{tensione}</text>
      <rect className="s-stagno" x="126" y="204" width="58" height="24" rx="3" />
      <text className="s-eti" x="258" y="220" fontSize="11.5">{s ? `up ${durataInglese(s.acceso_da)}` : ""}</text>
    </svg>
  );
}
