"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Finestra modale: usa <dialog>, quindi tastiera, Esc e blocco del fuoco li gestisce il browser. */
export function Finestra({
  aperta,
  alChiudere,
  titolo,
  children,
}: {
  aperta: boolean;
  alChiudere: () => void;
  titolo: string;
  children: ReactNode;
}) {
  const rif = useRef<HTMLDialogElement>(null);
  const idTitolo = useId();

  useEffect(() => {
    const finestra = rif.current;
    if (!finestra) return;
    if (aperta && !finestra.open) finestra.showModal();
    if (!aperta && finestra.open) finestra.close();
  }, [aperta]);

  return (
    <dialog
      ref={rif}
      className="finestra"
      aria-labelledby={idTitolo}
      onCancel={(evento) => {
        evento.preventDefault();
        alChiudere();
      }}
      onClick={(evento) => {
        if (evento.target === rif.current) alChiudere();
      }}
    >
      {aperta && (
        <div className="finestra-corpo">
          <div className="finestra-testa">
            <h2 id={idTitolo}>{titolo}</h2>
            <button type="button" className="bottone-icona" aria-label="Chiudi" onClick={alChiudere}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
