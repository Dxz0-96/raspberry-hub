"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { useHub } from "@/lib/hub";
import { decimale, ora } from "@/lib/formati";

interface Punto { t: number; v: number }

/** Un grafico a linea per una sola misura: valore attuale in chiaro, valore sotto il cursore al passaggio. */
function Grafico({
  titolo,
  punti,
  min,
  max,
  formato,
  attuale,
}: {
  titolo: string;
  punti: Punto[];
  min: number;
  max: number;
  formato: (v: number) => string;
  attuale: string;
}) {
  const [cursore, setCursore] = useState<number | null>(null);
  const t0 = punti[0]?.t ?? 0;
  const t1 = punti[punti.length - 1]?.t ?? 1;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * 100;
  const y = (v: number) => 100 - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
  const tracciato = useMemo(
    () => punti.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(2)} ${y(p.v).toFixed(2)}`).join(""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [punti, min, max],
  );

  function muovi(evento: PointerEvent<HTMLDivElement>) {
    if (punti.length < 2) return;
    const riquadro = evento.currentTarget.getBoundingClientRect();
    const quota = Math.min(1, Math.max(0, (evento.clientX - riquadro.left) / riquadro.width));
    const bersaglio = t0 + quota * (t1 - t0);
    let vicino = 0;
    for (let i = 1; i < punti.length; i++) {
      if (Math.abs(punti[i].t - bersaglio) < Math.abs(punti[vicino].t - bersaglio)) vicino = i;
    }
    setCursore(vicino);
  }

  const scelto = cursore !== null ? punti[cursore] : null;
  return (
    <figure className="grafico">
      <figcaption>
        <span className="grafico-titolo">{titolo}</span>
        <span className="grafico-valore">{scelto ? `${formato(scelto.v)} alle ${ora(scelto.t)}` : attuale}</span>
      </figcaption>
      <div className="grafico-corpo">
        <div className="grafico-asse" aria-hidden="true">
          <span>{formato(max)}</span>
          <span>{formato((max + min) / 2)}</span>
          <span>{formato(min)}</span>
        </div>
        <div className="grafico-area" onPointerMove={muovi} onPointerDown={muovi} onPointerLeave={() => setCursore(null)}>
          {punti.length >= 2 ? (
            <>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
                aria-label={`${titolo}: ora ${attuale}. Tra ${ora(t0)} e ${ora(t1)} da ${formato(Math.min(...punti.map((p) => p.v)))} a ${formato(Math.max(...punti.map((p) => p.v)))}.`}>
                <line className="grafico-griglia" x1="0" x2="100" y1="0.5" y2="0.5" />
                <line className="grafico-griglia" x1="0" x2="100" y1="50" y2="50" />
                <line className="grafico-griglia" x1="0" x2="100" y1="99.5" y2="99.5" />
                <path className="grafico-linea" d={tracciato} />
              </svg>
              {scelto && (
                <>
                  <span className="grafico-cursore" style={{ left: `${x(scelto.t)}%` }} />
                  <span className="grafico-punto" style={{ left: `${x(scelto.t)}%`, top: `${y(scelto.v)}%` }} />
                </>
              )}
            </>
          ) : (
            <p className="grafico-vuoto">Lo storico si riempie man mano: torna tra qualche minuto.</p>
          )}
        </div>
      </div>
      {punti.length >= 2 && (
        <div className="grafico-tempi" aria-hidden="true">
          <span>{ora(t0)}</span>
          <span>{ora((t0 + t1) / 2)}</span>
          <span>{ora(t1)}</span>
        </div>
      )}
    </figure>
  );
}

const TESTI_AVVISO = {
  temperatura: (t: string) => `Temperatura alta: ${t} °C. Controlla che il Raspberry abbia aria attorno.`,
  disco: (p: string) => `microSD quasi piena: ${p}% occupato. Libera spazio o passa a una scheda più capiente.`,
  alimentazione: () => "Alimentazione insufficiente: il Raspberry rallenta per proteggersi. Usa un alimentatore da 2,5 A e un cavo corto.",
  carico: (c: string) => `Carico alto da più di cinque minuti: ${c} su 4 core.`,
};

/** Avvisi sull'hardware: compaiono solo quando c'è qualcosa che richiede attenzione. */
export function Avvisi() {
  const { sistema } = useHub();
  if (!sistema || sistema.avvisi.length === 0) return null;
  return (
    <ul className="avvisi-hardware">
      {sistema.avvisi.map((tipo) => (
        <li key={tipo}>
          <TriangleAlert size={18} aria-hidden="true" />
          <span>
            {tipo === "temperatura" && TESTI_AVVISO.temperatura(decimale(sistema.temp ?? 0))}
            {tipo === "disco" && TESTI_AVVISO.disco(Math.round(sistema.disco.pieno).toString())}
            {tipo === "alimentazione" && TESTI_AVVISO.alimentazione()}
            {tipo === "carico" && TESTI_AVVISO.carico(decimale(sistema.cpu.carico[1]))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Andamento di processore e temperatura, più i processi che lavorano di più. */
export function Andamento() {
  const { storico, sistema } = useHub();
  const [periodo, setPeriodo] = useState<"ora" | "giorno">("ora");
  const grezzi = periodo === "ora" ? storico?.recente.punti : storico?.giorno.punti;
  const cpu = useMemo<Punto[]>(() => (grezzi ?? []).map((p) => ({ t: p[0], v: p[1] })), [grezzi]);
  const temp = useMemo<Punto[]>(
    () => (grezzi ?? []).filter((p) => p[2] !== null).map((p) => ({ t: p[0], v: p[2] as number })),
    [grezzi],
  );
  const estremi = useMemo(() => {
    if (temp.length === 0) return { min: 30, max: 70 };
    const valori = temp.map((p) => p.v);
    return {
      min: Math.floor((Math.min(...valori) - 4) / 10) * 10,
      max: Math.ceil((Math.max(...valori) + 4) / 10) * 10,
    };
  }, [temp]);
  const tabella = useMemo(() => {
    const righe = grezzi ?? [];
    const passo = Math.max(1, Math.floor(righe.length / 12));
    return righe.filter((_, i) => i % passo === 0 || i === righe.length - 1).slice(-13);
  }, [grezzi]);

  return (
    <section className="andamento" aria-labelledby="andamento-titolo">
      <div className="andamento-testa">
        <h2 id="andamento-titolo">Andamento</h2>
        <div className="periodo" role="group" aria-label="Periodo">
          <button type="button" aria-pressed={periodo === "ora"} onClick={() => setPeriodo("ora")}>
            Ultima ora
          </button>
          <button type="button" aria-pressed={periodo === "giorno"} onClick={() => setPeriodo("giorno")}>
            24 ore
          </button>
        </div>
      </div>
      <div className="andamento-griglia">
        <Grafico titolo="Processore" punti={cpu} min={0} max={100} formato={(v) => `${Math.round(v)}%`}
          attuale={sistema ? `${Math.round(sistema.cpu.uso)}%` : "–"} />
        <Grafico titolo="Temperatura" punti={temp} min={estremi.min} max={estremi.max} formato={(v) => `${Math.round(v)} °C`}
          attuale={sistema?.temp != null ? `${decimale(sistema.temp)} °C` : "–"} />
        <div className="processi">
          <h3>Processi più attivi</h3>
          {sistema && sistema.processi.length > 0 ? (
            <ol>
              {sistema.processi.map((p) => (
                <li key={p.nome}>
                  <span className="processo-nome">{p.nome}</span>
                  <span className="processo-barra" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, p.cpu)}%` }} />
                  </span>
                  <span className="processo-uso">{decimale(p.cpu)}%</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="grafico-vuoto">Nessun dato dal Raspberry.</p>
          )}
        </div>
      </div>
      {tabella.length > 1 && (
        <details className="tabella-dati">
          <summary>Gli stessi dati in tabella</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Ora</th>
                <th scope="col">Processore</th>
                <th scope="col">Temperatura</th>
              </tr>
            </thead>
            <tbody>
              {tabella.map((riga) => (
                <tr key={riga[0]}>
                  <td>{ora(riga[0])}</td>
                  <td>{Math.round(riga[1])}%</td>
                  <td>{riga[2] === null ? "–" : `${decimale(riga[2])} °C`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
