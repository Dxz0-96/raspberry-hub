"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronLeft, CircleAlert, KeyRound, Lock, LogOut, Monitor, Moon, Sun, UserRound } from "lucide-react";
import { ErroreApi, useHub } from "@/lib/hub";
import { durata } from "@/lib/formati";
import { useTema, type SceltaTema } from "@/lib/tema";
import { Finestra } from "./Finestra";

const TEMI: { scelta: SceltaTema; nome: string; Icona: typeof Sun }[] = [
  { scelta: "browser", nome: "Come il browser", Icona: Monitor },
  { scelta: "chiaro", nome: "Chiaro", Icona: Sun },
  { scelta: "scuro", nome: "Scuro", Icona: Moon },
];

function SceltaDelTema() {
  const { scelta, imposta } = useTema();
  return (
    <div className="tema" role="group" aria-label="Tema">
      {TEMI.map(({ scelta: valore, nome, Icona }) => (
        <button
          key={valore}
          type="button"
          aria-pressed={scelta === valore}
          aria-label={`Tema: ${nome.toLowerCase()}`}
          title={nome}
          onClick={() => imposta(valore)}
        >
          <Icona size={17} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function CambiaPassword({ aperta, alChiudere }: { aperta: boolean; alChiudere: () => void }) {
  const { cambiaPassword } = useHub();
  const [attuale, setAttuale] = useState("");
  const [nuova, setNuova] = useState("");
  const [ripetuta, setRipetuta] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);

  useEffect(() => {
    if (aperta) {
      setAttuale("");
      setNuova("");
      setRipetuta("");
      setErrore(null);
    }
  }, [aperta]);

  async function invia(evento: FormEvent) {
    evento.preventDefault();
    if (!attuale) return setErrore("Scrivi la password attuale.");
    if (nuova.length < 8) return setErrore("La nuova password deve avere almeno 8 caratteri.");
    if (nuova !== ripetuta) return setErrore("Le due password nuove sono diverse.");
    setInvio(true);
    setErrore(null);
    try {
      await cambiaPassword(attuale, nuova);
      alChiudere();
    } catch (problema) {
      setErrore(
        problema instanceof ErroreApi && problema.stato === 401
          ? "La sessione è scaduta. Chiudi questa finestra e accedi di nuovo."
          : problema instanceof Error
            ? problema.message
            : "Password non cambiata. Riprova.",
      );
    } finally {
      setInvio(false);
    }
  }

  return (
    <Finestra aperta={aperta} alChiudere={alChiudere} titolo="Cambia password">
      <form onSubmit={invia} noValidate>
        <div className="campo">
          <label htmlFor="pw-attuale">Password attuale</label>
          <input id="pw-attuale" type="password" autoComplete="current-password" value={attuale}
            onChange={(e) => { setAttuale(e.target.value); setErrore(null); }} />
        </div>
        <div className="campo">
          <label htmlFor="pw-nuova">Nuova password</label>
          <input id="pw-nuova" type="password" autoComplete="new-password" value={nuova}
            aria-describedby="pw-nuova-guida" onChange={(e) => { setNuova(e.target.value); setErrore(null); }} />
          <p className="campo-guida" id="pw-nuova-guida">Almeno 8 caratteri.</p>
        </div>
        <div className="campo">
          <label htmlFor="pw-ripetuta">Ripeti la nuova password</label>
          <input id="pw-ripetuta" type="password" autoComplete="new-password" value={ripetuta}
            onChange={(e) => { setRipetuta(e.target.value); setErrore(null); }} />
        </div>
        {errore && (
          <p className="riquadro-errore" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{errore}</span>
          </p>
        )}
        <div className="finestra-azioni">
          <button type="button" className="bottone" onClick={alChiudere}>Annulla</button>
          <button type="submit" className="bottone pieno" disabled={invio}>
            {invio ? "Salvataggio in corso" : "Cambia password"}
          </button>
        </div>
      </form>
    </Finestra>
  );
}

function Sessione() {
  const { autenticato, utente, apriAccesso, esci } = useHub();
  const [menu, setMenu] = useState(false);
  const [password, setPassword] = useState(false);
  const rif = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const fuori = (evento: PointerEvent) => {
      if (!rif.current?.contains(evento.target as Node)) setMenu(false);
    };
    const tasto = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", fuori);
    document.addEventListener("keydown", tasto);
    return () => {
      document.removeEventListener("pointerdown", fuori);
      document.removeEventListener("keydown", tasto);
    };
  }, [menu]);

  if (!autenticato) {
    return (
      <button type="button" className="bottone" onClick={() => apriAccesso()}>
        <Lock size={17} aria-hidden="true" />
        Accedi
      </button>
    );
  }
  return (
    <div className="sessione" ref={rif}>
      <button type="button" className="bottone" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        <UserRound size={17} aria-hidden="true" />
        {utente}
      </button>
      {menu && (
        <div className="menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenu(false); setPassword(true); }}>
            <KeyRound size={17} aria-hidden="true" />
            Cambia password
          </button>
          <button type="button" role="menuitem" onClick={() => { setMenu(false); void esci(); }}>
            <LogOut size={17} aria-hidden="true" />
            Esci
          </button>
        </div>
      )}
      <CambiaPassword aperta={password} alChiudere={() => setPassword(false)} />
    </div>
  );
}

/** La testata di ogni pagina: nome del Raspberry, a che punto è, accesso e tema. */
export function Testata({ titolo, indietro = false }: { titolo?: string; indietro?: boolean }) {
  const { sistema } = useHub();
  const modello = sistema?.modello.replace(/^Raspberry\s+/i, "").replace(/\s+Rev.*$/i, "");
  return (
    <header className="testata">
      <div className="testata-dentro">
        {indietro && (
          <Link href="/" className="indietro">
            <ChevronLeft size={18} aria-hidden="true" />
            Hub
          </Link>
        )}
        <div className="testata-nome">
          <h1>{titolo ?? "raspberry"}</h1>
          <p className="testata-sotto">
            {sistema
              ? `${modello}, ${sistema.ip}, acceso da ${durata(sistema.acceso_da)}`
              : "In attesa dei dati dal Raspberry"}
          </p>
        </div>
        <div className="testata-azioni">
          <Sessione />
          <SceltaDelTema />
        </div>
      </div>
    </header>
  );
}
