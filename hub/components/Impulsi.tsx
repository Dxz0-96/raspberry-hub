"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useHub } from "@/lib/hub";
import type { Servizio, StatoVivo } from "@/lib/tipi";
import { CAVO_Y } from "./Scheda";

/** Quanti impulsi mandare verso un servizio (0-3), in base alle visite al minuto. */
export function impulsiPer(s: Servizio, vivo: StatoVivo | undefined): number {
  const al_minuto = vivo?.attivita ?? 0;
  if (!vivo || vivo.stato !== "acceso" || al_minuto <= 0) return 0;
  // Pi-hole risponde sempre a qualcuno: le soglie sono più alte
  const soglie = s.tipo === "pihole" ? [1, 120, 400] : [1, 20, 90];
  return soglie.filter((soglia) => al_minuto >= soglia).length;
}

/** Pixel al secondo: con più traffico gli impulsi sono più fitti e più veloci. */
const VELOCITA = [0, 170, 240, 330];

type Percorso = { d: string; lunghezza: number; fineX: number; fineY: number };
type Misure = { larghezza: number; altezza: number; percorsi: Record<string, Percorso> };

const n = (v: number) => v.toFixed(1);

/** Misura le piste in coordinate di .casa: dalla piazzola sulla scheda, lungo il cavo e la dorsale,
 *  fino al terminale di ogni servizio. Con scheda e servizi uno sopra l'altro il cavo non c'e' e
 *  gli impulsi partono dall'inizio della dorsale. */
function misura(casa: HTMLElement): Misure | null {
  const c = casa.getBoundingClientRect();
  const piste = Array.from(casa.querySelectorAll<HTMLElement>(".riga[data-servizio] > .pista"));
  if (!piste.length || !c.width) return null;
  // la pista (derivazione) parte dalla dorsale; il terminale e' il cerchio di 10 px che sporge di 9 px a destra
  const punti = piste.map((p) => {
    const r = p.getBoundingClientRect();
    const x = r.left - c.left + 1;
    return { id: p.parentElement!.dataset.servizio!, x, y: r.top + r.height / 2 - c.top, fine: x - 1 + p.offsetWidth + 4 };
  });
  const scheda = casa.querySelector<HTMLElement>(".casa-scheda");
  const piazzola = casa.querySelector(".s-piazzola-cavo")?.getBoundingClientRect();
  const conCavo = Boolean(scheda && piazzola?.width && getComputedStyle(scheda, "::after").display !== "none");

  const percorsi: Record<string, Percorso> = {};
  for (const p of punti) {
    let d: string;
    let lunghezza: number;
    if (conCavo && piazzola) {
      const px = piazzola.left + piazzola.width / 2 - c.left;
      const py = piazzola.top + piazzola.height / 2 - c.top;
      d = `M${n(px)} ${n(py)}H${n(p.x)}V${n(p.y)}H${n(p.fine)}`;
      lunghezza = Math.abs(p.x - px) + Math.abs(p.y - py) + (p.fine - p.x);
    } else {
      const inizio = punti[0].y;
      d = `M${n(p.x)} ${n(inizio)}V${n(p.y)}H${n(p.fine)}`;
      lunghezza = p.y - inizio + (p.fine - p.x);
    }
    percorsi[p.id] = { d, lunghezza, fineX: p.fine, fineY: p.y };
  }
  return { larghezza: c.width, altezza: c.height, percorsi };
}

/**
 * Gli impulsi del traffico: ogni punto parte dalla piazzola d'oro sul bordo della scheda, corre lungo
 * il cavo e la dorsale e arriva al terminale del suo servizio, che si illumina all'arrivo.
 * Va messo dentro .casa (posizionata). Con "riduci animazioni" il foglio di stile lo nasconde.
 */
export function Flusso() {
  const { servizi, stati } = useHub();
  const rif = useRef<SVGSVGElement>(null);
  const [misure, setMisure] = useState<Misure | null>(null);

  useEffect(() => {
    const casa = rif.current?.parentElement;
    if (!casa) return;
    let attesa: ReturnType<typeof setTimeout> | undefined;
    let ultima = "";
    const aggiorna = () => {
      attesa = undefined;
      // il cavo deve uscire dal centro della piazzola: la quota (--cavo-y) serve a scheda e servizi
      const disegno = casa.querySelector<SVGSVGElement>(".solo-largo svg");
      if (disegno) casa.style.setProperty("--cavo-y", `${(disegno.getBoundingClientRect().height * CAVO_Y).toFixed(1)}px`);
      const nuove = misura(casa);
      const firma = JSON.stringify(nuove);
      if (firma !== ultima) {
        ultima = firma;
        setMisure(nuove);
      }
    };
    const pianifica = () => {
      // un solo calcolo per raffica di cambiamenti (setTimeout: funziona anche a scheda del browser nascosta)
      if (attesa === undefined) attesa = setTimeout(aggiorna, 30);
    };
    pianifica();
    const osservatore = new ResizeObserver(pianifica);
    osservatore.observe(casa);
    // righe aggiunte, tolte o andate a capo
    const mutazioni = new MutationObserver(pianifica);
    mutazioni.observe(casa, { childList: true, subtree: true });
    void document.fonts?.ready.then(pianifica);
    return () => {
      osservatore.disconnect();
      mutazioni.disconnect();
      clearTimeout(attesa);
    };
  }, []);

  return (
    <svg ref={rif} className="flusso" aria-hidden="true" width={misure?.larghezza ?? 0} height={misure?.altezza ?? 0}>
      {misure &&
        servizi?.map((s, indice) => {
          const quanti = impulsiPer(s, stati?.[s.id]);
          const p = misure.percorsi[s.id];
          if (!quanti || !p) return null;
          const durata = Math.max(1.2, p.lunghezza / VELOCITA[quanti]);
          return Array.from({ length: quanti }, (_, i) => {
            // punti dello stesso servizio equidistanti; servizi diversi sfasati tra loro
            const tempi = { dur: `${durata.toFixed(2)}s`, begin: `-${((i * durata) / quanti + indice * 0.37).toFixed(2)}s`, repeatCount: "indefinite" };
            return (
              <Fragment key={`${s.id}-${quanti}-${i}`}>
                {/* all'arrivo (inizio di ogni giro) il terminale manda un'onda */}
                <circle className="flusso-arrivo" cx={n(p.fineX)} cy={n(p.fineY)} r="5" opacity="0">
                  <animate attributeName="r" values="5;12;12" keyTimes="0;0.16;1" {...tempi} />
                  <animate attributeName="opacity" values="0.75;0;0" keyTimes="0;0.16;1" {...tempi} />
                </circle>
                <circle className="flusso-punto" r="3.5" opacity="0">
                  <animateMotion path={p.d} calcMode="paced" {...tempi} />
                  <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.04;0.96;1" {...tempi} />
                </circle>
              </Fragment>
            );
          });
        })}
    </svg>
  );
}
