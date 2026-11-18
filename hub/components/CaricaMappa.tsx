"use client";

import dynamic from "next/dynamic";

// La mappa usa WebGL e il browser: si carica solo lì, non durante la build del sito.
const Mappa = dynamic(() => import("./Mappa"), {
  ssr: false,
  loading: () => (
    <div className="pagina-mappa">
      <div className="mappa-messaggio" role="status">
        <p>Apro la mappa…</p>
      </div>
    </div>
  ),
});

export function CaricaMappa() {
  return <Mappa />;
}
