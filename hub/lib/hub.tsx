"use client";

// Lo stato dell'hub: servizi, sessione, misure dell'hardware. Un solo punto che parla con il Raspberry.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  CampiServizio,
  Contenuti,
  Dns,
  RispostaStato,
  Servizio,
  Sistema,
  StatoVivo,
  Storico,
} from "./tipi";

/** Vuoto in produzione (stessa origine). In sviluppo punta al finto Raspberry: vedi dev/mock-server.mjs. */
export const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export class ErroreApi extends Error {
  constructor(
    public stato: number,
    public sigla: string,
    messaggio: string,
    public dati: Record<string, unknown> = {},
  ) {
    super(messaggio);
  }
}

export async function api<T>(percorso: string, opzioni: { metodo?: string; corpo?: unknown } = {}): Promise<T> {
  const scrive = opzioni.metodo !== undefined && opzioni.metodo !== "GET";
  let risposta: Response;
  try {
    risposta = await fetch(BASE + percorso, {
      method: opzioni.metodo ?? "GET",
      credentials: BASE ? "include" : "same-origin",
      cache: "no-store",
      headers: scrive ? { "Content-Type": "application/json", "X-Hub": "1" } : undefined,
      body: scrive ? JSON.stringify(opzioni.corpo ?? {}) : undefined,
    });
  } catch {
    throw new ErroreApi(0, "rete", "Il Raspberry non risponde. Controlla di essere collegato alla rete di casa.");
  }
  let dati: Record<string, unknown> | null = null;
  try {
    dati = await risposta.json();
  } catch {
    dati = null;
  }
  if (!risposta.ok) {
    throw new ErroreApi(
      risposta.status,
      typeof dati?.errore === "string" ? dati.errore : "errore",
      typeof dati?.messaggio === "string" ? dati.messaggio : "Il servizio è spento o non risponde. Riprova tra poco.",
      dati ?? {},
    );
  }
  return dati as T;
}

/** Ripete una lettura a intervalli, ma solo mentre la scheda del browser è visibile. */
export function useLetturaPeriodica(leggi: () => void, millisecondi: number) {
  const ultima = useRef(leggi);
  useEffect(() => {
    ultima.current = leggi;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const avvia = () => {
      ultima.current();
      timer = setInterval(() => ultima.current(), millisecondi);
    };
    const ferma = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const visibilita = () => {
      if (document.hidden) ferma();
      else if (!timer) avvia();
    };
    visibilita();
    document.addEventListener("visibilitychange", visibilita);
    return () => {
      ferma();
      document.removeEventListener("visibilitychange", visibilita);
    };
  }, [millisecondi]);
}

export interface Avviso {
  testo: string;
  tono: "errore" | "fatto";
}

interface Hub {
  servizi: Servizio[] | null;
  stati: Record<string, StatoVivo> | null;
  dns: Dns | null;
  contenuti: Contenuti | null;
  sistema: Sistema | null;
  storico: Storico | null;
  autenticato: boolean;
  utente: string | null;
  configurato: boolean;
  /** id dei servizi il cui interruttore sta lavorando */
  inCorso: Record<string, boolean>;
  avviso: Avviso | null;
  chiudiAvviso: () => void;
  /** Finestra di accesso: aperta finché non è null */
  accessoAperto: boolean;
  apriAccesso: (poi?: () => void) => void;
  chiudiAccesso: () => void;
  accedi: (utente: string, password: string) => Promise<void>;
  esci: () => Promise<void>;
  cambiaPassword: (attuale: string, nuova: string) => Promise<void>;
  comanda: (id: string, acceso: boolean) => Promise<void>;
  salvaServizio: (campi: CampiServizio, id?: string) => Promise<void>;
  rimuoviServizio: (id: string) => Promise<void>;
}

const Contesto = createContext<Hub | null>(null);

export function useHub(): Hub {
  const hub = useContext(Contesto);
  if (!hub) throw new Error("useHub va usato dentro <FornitoreHub>");
  return hub;
}

export function FornitoreHub({ children }: { children: ReactNode }) {
  const [servizi, setServizi] = useState<Servizio[] | null>(null);
  const [stato, setStato] = useState<RispostaStato | null>(null);
  const [contenuti, setContenuti] = useState<Contenuti | null>(null);
  const [sistema, setSistema] = useState<Sistema | null>(null);
  const [storico, setStorico] = useState<Storico | null>(null);
  const [inCorso, setInCorso] = useState<Record<string, boolean>>({});
  const [avviso, setAvviso] = useState<Avviso | null>(null);
  const [accessoAperto, setAccessoAperto] = useState(false);
  const dopoAccesso = useRef<(() => void) | undefined>(undefined);

  const leggiServizi = useCallback(async () => {
    try {
      const dati = await api<{ servizi: Servizio[] }>("/servizi.json");
      setServizi(Array.isArray(dati.servizi) ? dati.servizi : []);
    } catch {
      setServizi((prima) => prima ?? []);
    }
  }, []);

  const leggiStato = useCallback(async () => {
    try {
      setStato(await api<RispostaStato>("/controllo/stato"));
    } catch {
      setStato(null);
    }
  }, []);

  useLetturaPeriodica(() => {
    void leggiStato();
    api<Sistema>("/controllo/sistema")
      .then((dati) => setSistema(dati.cpu ? dati : null))
      .catch(() => setSistema(null));
  }, 5000);

  useLetturaPeriodica(() => {
    void leggiServizi();
    api<Contenuti>("/status.json").then(setContenuti).catch(() => setContenuti(null));
    api<Storico>("/controllo/sistema/storico").then(setStorico).catch(() => setStorico(null));
  }, 60000);

  useEffect(() => {
    if (!avviso) return;
    const timer = setTimeout(() => setAvviso(null), avviso.tono === "errore" ? 9000 : 4000);
    return () => clearTimeout(timer);
  }, [avviso]);

  const apriAccesso = useCallback((poi?: () => void) => {
    dopoAccesso.current = poi;
    setAccessoAperto(true);
  }, []);

  const chiudiAccesso = useCallback(() => {
    dopoAccesso.current = undefined;
    setAccessoAperto(false);
  }, []);

  const accedi = useCallback(
    async (utente: string, password: string) => {
      await api("/controllo/accesso", { metodo: "POST", corpo: { utente, password } });
      await leggiStato();
      const poi = dopoAccesso.current;
      dopoAccesso.current = undefined;
      setAccessoAperto(false);
      poi?.();
    },
    [leggiStato],
  );

  const esci = useCallback(async () => {
    try {
      await api("/controllo/uscita", { metodo: "POST" });
    } finally {
      await leggiStato();
    }
  }, [leggiStato]);

  /** Esegue un'azione riservata; se la sessione manca o è scaduta apre l'accesso e poi riprova. */
  const riservata = useCallback(
    async <T,>(azione: () => Promise<T>, riprova: () => void): Promise<T | undefined> => {
      try {
        return await azione();
      } catch (errore) {
        if (errore instanceof ErroreApi && errore.stato === 401) {
          await leggiStato();
          apriAccesso(riprova);
          return undefined;
        }
        throw errore;
      }
    },
    [apriAccesso, leggiStato],
  );

  const comanda = useCallback(
    async (id: string, acceso: boolean) => {
      setInCorso((prima) => ({ ...prima, [id]: true }));
      try {
        const risposta = await riservata(
          () =>
            api<{ servizi: Record<string, StatoVivo> }>(`/controllo/servizi/${id}/interruttore`, {
              metodo: "POST",
              corpo: { acceso },
            }),
          () => void comanda(id, acceso),
        );
        if (risposta?.servizi) {
          setStato((prima) => (prima ? { ...prima, servizi: risposta.servizi } : prima));
        }
      } catch (errore) {
        setAvviso({ testo: errore instanceof Error ? errore.message : "Comando non riuscito.", tono: "errore" });
        void leggiStato();
      } finally {
        setInCorso((prima) => ({ ...prima, [id]: false }));
      }
    },
    [riservata, leggiStato],
  );

  const salvaServizio = useCallback(
    async (campi: CampiServizio, id?: string) => {
      await api(id ? `/controllo/servizi/${id}` : "/controllo/servizi", { metodo: "POST", corpo: campi });
      await Promise.all([leggiServizi(), leggiStato()]);
      setAvviso({ testo: id ? "Servizio modificato" : "Servizio aggiunto", tono: "fatto" });
    },
    [leggiServizi, leggiStato],
  );

  const rimuoviServizio = useCallback(
    async (id: string) => {
      await api(`/controllo/servizi/${id}`, { metodo: "DELETE" });
      await Promise.all([leggiServizi(), leggiStato()]);
      setAvviso({ testo: "Servizio rimosso", tono: "fatto" });
    },
    [leggiServizi, leggiStato],
  );

  const cambiaPassword = useCallback(async (attuale: string, nuova: string) => {
    await api("/controllo/password", { metodo: "POST", corpo: { attuale, nuova } });
    setAvviso({ testo: "Password cambiata", tono: "fatto" });
  }, []);

  const valore = useMemo<Hub>(
    () => ({
      servizi,
      stati: stato?.servizi ?? null,
      dns: stato?.dns ?? null,
      contenuti,
      sistema,
      storico,
      autenticato: stato?.autenticato ?? false,
      utente: stato?.utente ?? null,
      configurato: stato?.configurato ?? true,
      inCorso,
      avviso,
      chiudiAvviso: () => setAvviso(null),
      accessoAperto,
      apriAccesso,
      chiudiAccesso,
      accedi,
      esci,
      cambiaPassword,
      comanda,
      salvaServizio,
      rimuoviServizio,
    }),
    [
      servizi, stato, contenuti, sistema, storico, inCorso, avviso, accessoAperto,
      apriAccesso, chiudiAccesso, accedi, esci, cambiaPassword, comanda, salvaServizio, rimuoviServizio,
    ],
  );

  return <Contesto.Provider value={valore}>{children}</Contesto.Provider>;
}
