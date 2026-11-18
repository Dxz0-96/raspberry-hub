"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { ErroreApi, useHub } from "@/lib/hub";
import { Finestra } from "./Finestra";

/** La finestra di accesso con utente e password. Si apre quando serve: interruttori, aggiunta di servizi. */
export function Accesso() {
  const { accessoAperto, chiudiAccesso, accedi, configurato } = useHub();
  const [utente, setUtente] = useState("admin");
  const [password, setPassword] = useState("");
  const [mancaUtente, setMancaUtente] = useState(false);
  const [mancaPassword, setMancaPassword] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const campoPassword = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!accessoAperto) return;
    setPassword("");
    setErrore(null);
    setMancaUtente(false);
    setMancaPassword(false);
    try {
      const ultimo = localStorage.getItem("utente");
      if (ultimo) setUtente(ultimo);
    } catch {
      // nessun archivio: resta il nome predefinito
    }
    const timer = setTimeout(() => campoPassword.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [accessoAperto]);

  async function invia(evento: FormEvent) {
    evento.preventDefault();
    const nome = utente.trim();
    setMancaUtente(!nome);
    setMancaPassword(!password);
    if (!nome || !password) return;
    setInvio(true);
    setErrore(null);
    try {
      await accedi(nome, password);
      try {
        localStorage.setItem("utente", nome);
      } catch {
        // pazienza: la prossima volta ricompare "admin"
      }
    } catch (problema) {
      setPassword("");
      campoPassword.current?.focus();
      if (problema instanceof ErroreApi && problema.sigla === "credenziali") {
        const rimasti = Number(problema.dati.tentativi_rimasti ?? 0);
        setErrore(
          `Utente o password non corretti. ${rimasti === 1 ? "Ti resta 1 tentativo" : `Ti restano ${rimasti} tentativi`}.`,
        );
      } else if (problema instanceof ErroreApi && problema.sigla === "bloccato") {
        const minuti = Math.max(1, Math.ceil(Number(problema.dati.secondi ?? 300) / 60));
        setErrore(`Troppi tentativi sbagliati. Riprova tra ${minuti === 1 ? "un minuto" : `${minuti} minuti`}.`);
      } else {
        setErrore(problema instanceof Error ? problema.message : "Accesso non riuscito. Riprova.");
      }
    } finally {
      setInvio(false);
    }
  }

  return (
    <Finestra aperta={accessoAperto} alChiudere={chiudiAccesso} titolo="Accedi all'hub">
      {configurato ? (
        <form onSubmit={invia} noValidate>
          <p className="finestra-guida">Serve per accendere e spegnere i servizi e per aggiungerne di nuovi.</p>
          <div className="campo">
            <label htmlFor="accesso-utente">Utente</label>
            <input
              id="accesso-utente"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={utente}
              aria-invalid={mancaUtente}
              aria-describedby={mancaUtente ? "accesso-utente-errore" : undefined}
              onChange={(e) => {
                setUtente(e.target.value);
                setMancaUtente(false);
              }}
            />
            {mancaUtente && (
              <p className="campo-errore" id="accesso-utente-errore">
                Scrivi il nome utente.
              </p>
            )}
          </div>
          <div className="campo">
            <label htmlFor="accesso-password">Password</label>
            <input
              id="accesso-password"
              ref={campoPassword}
              type="password"
              autoComplete="current-password"
              value={password}
              aria-invalid={mancaPassword}
              aria-describedby={mancaPassword ? "accesso-password-errore" : undefined}
              onChange={(e) => {
                setPassword(e.target.value);
                setMancaPassword(false);
                setErrore(null);
              }}
            />
            {mancaPassword && (
              <p className="campo-errore" id="accesso-password-errore">
                Scrivi la password.
              </p>
            )}
          </div>
          {errore && (
            <p className="riquadro-errore" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <span>{errore}</span>
            </p>
          )}
          <div className="finestra-azioni">
            <button type="button" className="bottone" onClick={chiudiAccesso}>
              Annulla
            </button>
            <button type="submit" className="bottone pieno" disabled={invio}>
              {invio ? "Accesso in corso" : "Accedi"}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <p className="finestra-guida">
            La password dell&apos;hub non è ancora stata impostata. Collegati al Raspberry e lancia questo
            comando: ti chiede un nome utente e la password, poi puoi accedere da qui.
          </p>
          <pre className="comando">sudo hub-control-setpass</pre>
          <div className="finestra-azioni">
            <button type="button" className="bottone pieno" onClick={chiudiAccesso}>
              Ho capito
            </button>
          </div>
        </div>
      )}
    </Finestra>
  );
}
