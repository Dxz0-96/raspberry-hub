"use client";

import type { CSSProperties } from "react";
import { useHub } from "@/lib/hub";
import { decimale, pesoTesto } from "@/lib/formati";

const numero = new Intl.NumberFormat("it-IT");

/** Il percorso di una richiesta DNS in casa, con i numeri veri letti da Pi-hole. */
function PercorsoDns() {
  const { dns } = useHub();
  const nodi = [
    {
      nome: "Dispositivi",
      valore: dns ? numero.format(dns.al_minuto) : "–",
      dato: dns ? `richieste al minuto${dns.client != null ? `, ${dns.client} client` : ""}` : "",
    },
    { nome: "Router", dato: "inoltra le richieste", valore: "" },
    {
      nome: "Pi-hole",
      valore: dns ? `${decimale(dns.percentuale_bloccate)}%` : "–",
      dato: dns ? `bloccate, ${numero.format(dns.dalla_cache)} dalla cache` : "",
      principale: true,
    },
    {
      nome: "Unbound",
      valore: dns ? numero.format(dns.inoltrate) : "",
      dato: dns ? "inoltrate, con cache e DNSSEC" : "cache e DNSSEC",
    },
    {
      nome: dns?.a_monte.nome ?? "Internet",
      dato: dns ? (dns.a_monte.cifrato ? "DNS cifrato" : "ricorsione diretta") : "",
      valore: "",
    },
  ];
  return (
    <figure className="percorso">
      <figcaption>Come passa una richiesta DNS</figcaption>
      <ol className="percorso-nodi">
        {nodi.map((nodo) => (
          <li key={nodo.nome} className={nodo.principale ? "principale" : undefined}>
            <span className="nodo-nome">{nodo.nome}</span>
            {nodo.valore && <span className="nodo-valore">{nodo.valore}</span>}
            {nodo.dato && <span className="nodo-dato">{nodo.dato}</span>}
          </li>
        ))}
      </ol>
      <p className="diagramma-nota">
        {dns
          ? `Ultime 24 ore: ${numero.format(dns.totale)} richieste, ${numero.format(dns.bloccate)} bloccate. ` +
            `Pi-hole blocca ${numero.format(dns.domini_bloccati ?? 0)} domini.`
          : "Le statistiche di Pi-hole non arrivano: il servizio di controllo non riesce a leggerle."}
      </p>
    </figure>
  );
}

/** Come è occupata la microSD: sistema, Wikipedia, mappe, indice degli indirizzi, spazio libero. */
function BarraMicroSD() {
  const { sistema } = useHub();
  if (!sistema) {
    return (
      <figure className="microsd">
        <figcaption>microSD</figcaption>
        <p className="diagramma-nota">In attesa dei dati dal Raspberry.</p>
      </figure>
    );
  }
  const { totale, usato, contenuti } = sistema.disco;
  const contenutiTot = contenuti.wikipedia + contenuti.mappe + contenuti.indirizzi;
  const voci = [
    { chiave: "sistema", nome: "Sistema", byte: Math.max(0, usato - contenutiTot) },
    { chiave: "wiki", nome: "Wikipedia", byte: contenuti.wikipedia },
    { chiave: "mappe", nome: "Mappe", byte: contenuti.mappe },
    { chiave: "indirizzi", nome: "Indirizzi", byte: contenuti.indirizzi },
    { chiave: "libero", nome: "Libero", byte: Math.max(0, totale - usato) },
  ];
  const descrizione = voci.map((v) => `${v.nome} ${pesoTesto(v.byte)}`).join(", ");
  return (
    <figure className="microsd">
      <figcaption>
        <span>microSD</span>
        <span className="microsd-totale">
          {pesoTesto(usato)} di {pesoTesto(totale)}
        </span>
      </figcaption>
      <div className="barra" role="img" aria-label={`Spazio sulla microSD: ${descrizione}.`}>
        {voci
          .filter((v) => v.byte > 0)
          .map((v) => (
            <span
              key={v.chiave}
              className={`barra-pezzo ${v.chiave}`}
              style={{ "--quota": v.byte / Math.max(1, totale) } as CSSProperties}
              title={`${v.nome}: ${pesoTesto(v.byte)}`}
            />
          ))}
      </div>
      <ul className="legenda">
        {voci.map((v) => (
          <li key={v.chiave}>
            <span className={`legenda-segno ${v.chiave}`} aria-hidden="true" />
            <span className="legenda-nome">{v.nome}</span>
            <span className="legenda-valore">{pesoTesto(v.byte)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Sezione "Rete e spazio": il percorso DNS e la microSD. */
export function ReteESpazio() {
  return (
    <section className="rete" aria-labelledby="rete-titolo">
      <h2 id="rete-titolo">Rete e spazio</h2>
      <div className="rete-griglia">
        <PercorsoDns />
        <BarraMicroSD />
      </div>
    </section>
  );
}
