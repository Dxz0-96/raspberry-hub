"use client";

import { Check, CircleAlert, X } from "lucide-react";
import { useHub } from "@/lib/hub";

/** Messaggio breve in fondo alla pagina: l'esito di un'azione, o cosa fare se non è riuscita. */
export function AvvisoInBasso() {
  const { avviso, chiudiAvviso } = useHub();
  return (
    <div className="avviso-zona" aria-live="polite">
      {avviso && (
        <div className={`avviso ${avviso.tono}`} role={avviso.tono === "errore" ? "alert" : "status"}>
          {avviso.tono === "errore" ? (
            <CircleAlert size={18} aria-hidden="true" />
          ) : (
            <Check size={18} aria-hidden="true" />
          )}
          <span>{avviso.testo}</span>
          <button type="button" className="bottone-icona" aria-label="Chiudi il messaggio" onClick={chiudiAvviso}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
