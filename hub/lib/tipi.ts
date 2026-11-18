// Le forme dei dati che l'hub riceve dal Raspberry (hub-control.py, hub-search.py, hub-update.sh).

export type StatoServizio =
  | "acceso"
  | "spento"
  | "pausa"
  | "mancante"
  | "irraggiungibile"
  | "errore"
  | "sconosciuto";

export interface Servizio {
  id: string;
  nome: string;
  descrizione?: string;
  url: string;
  icona?: string;
  tipo?: "pihole" | "unita" | "link";
  aggiunto?: boolean;
}

export interface StatoVivo {
  stato: StatoServizio;
  dettaglio: string;
  interruttore: boolean;
  /** Visite al minuto (per Pi-hole: richieste DNS al minuto); null se non misurabile. */
  attivita?: number | null;
}

/** Riepilogo DNS letto da Pi-hole: i totali si riferiscono alle ultime 24 ore. */
export interface Dns {
  al_minuto: number;
  totale: number;
  bloccate: number;
  percentuale_bloccate: number;
  dalla_cache: number;
  inoltrate: number;
  client: number | null;
  domini_bloccati: number | null;
  a_monte: { nome: string; cifrato: boolean };
}

export interface RispostaStato {
  ora: number;
  autenticato: boolean;
  utente: string | null;
  configurato: boolean;
  servizi: Record<string, StatoVivo>;
  dns?: Dns | null;
}

export interface Sistema {
  ora: number;
  nome: string;
  modello: string;
  ip: string;
  cpu: { uso: number; core: number[]; carico: number[]; mhz: number | null; n: number };
  temp: number | null;
  mem: { totale: number; usata: number; swap_totale: number; swap_usata: number };
  disco: {
    totale: number;
    usato: number;
    pieno: number;
    attivita: number;
    contenuti: { wikipedia: number; mappe: number; indirizzi: number };
  };
  rete: { interfaccia: string; giu: number; su: number; collegata: boolean; mbit: number | null };
  alimentazione: {
    sottotensione: boolean;
    rallentato: boolean;
    sottotensione_passata: boolean;
    rallentato_passato: boolean;
  } | null;
  acceso_da: number;
  processi: { nome: string; cpu: number }[];
  avvisi: ("temperatura" | "disco" | "alimentazione" | "carico")[];
}

export interface Storico {
  /** [secondi, cpu %, temperatura °C] ogni 5 secondi, ultima ora */
  recente: { passo: number; punti: [number, number, number | null][] };
  /** [secondi, cpu %, temperatura °C, memoria %, carico] ogni minuto, ultime 24 ore */
  giorno: { passo: number; punti: [number, number, number, number, number][] };
}

export interface Contenuti {
  aggiornato: string;
  wikipedia: { edizione: string | null; byte: number | null; esito: string | null; in_corso: boolean };
  mappe: { build: string | null; byte: number | null; esito: string | null; in_corso: boolean };
  indirizzi: { dati: string | null; byte: number | null; esito: string | null; in_corso: boolean };
}

export interface RisultatoRicerca {
  tipo: "via" | "civico" | "luogo" | "poi";
  nome: string;
  dettaglio: string;
  lat: number;
  lon: number;
  /** ovest, sud, est, nord */
  riquadro: [number, number, number, number] | null;
  civico_mancante?: string;
  civico_esatto?: boolean;
}

export interface CampiServizio {
  nome: string;
  descrizione: string;
  url: string;
  icona?: { dati: string };
}
