"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { CircleAlert, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { BASE, ErroreApi, useHub } from "@/lib/hub";
import { giornoMese, meseAnno } from "@/lib/formati";
import type { Contenuti, Servizio, StatoVivo } from "@/lib/tipi";
import { Finestra } from "./Finestra";

type Tono = "vivo" | "fermo" | "guasto";

/** Le icone stanno sul Raspberry (/icone/...): in sviluppo arrivano dal finto Raspberry. */
function indirizzoIcona(icona: string): string {
  return icona.startsWith("/icone/") ? BASE + icona : icona;
}

/** La frase sotto il nome: lo stato quando c'è qualcosa da dire, altrimenti la descrizione. */
function frase(s: Servizio, vivo: StatoVivo | undefined, contenuti: Contenuti | null): { testo: string; tono: Tono } {
  const descrizione = s.descrizione ?? "";
  if (!vivo) return { testo: descrizione, tono: "vivo" };
  const contenuto = s.id === "wikipedia" ? contenuti?.wikipedia : s.id === "mappe" ? contenuti?.mappe : null;
  switch (vivo.stato) {
    case "spento":
      return { testo: s.id === "mappe" ? "Spente" : s.id === "wikipedia" ? "Spenta" : "Spento", tono: "fermo" };
    case "pausa":
      return { testo: "Blocco in pausa: la pubblicità non viene filtrata", tono: "fermo" };
    case "mancante":
      if (contenuto?.in_corso) return { testo: "In arrivo: download in corso", tono: "fermo" };
      if (contenuto?.esito?.startsWith("errore")) {
        return { testo: "Download non riuscito: riprova con il prossimo aggiornamento", tono: "guasto" };
      }
      return { testo: "Contenuto non ancora scaricato", tono: "fermo" };
    case "irraggiungibile":
      return { testo: vivo.dettaglio || "Non risponde", tono: "guasto" };
    case "errore":
      return { testo: vivo.dettaglio || "Non funziona", tono: "guasto" };
    case "sconosciuto":
      return { testo: vivo.dettaglio || "Stato non leggibile", tono: "fermo" };
    default: {
      if (s.id === "pihole") return { testo: "Blocco attivo", tono: "vivo" };
      if (s.id === "wikipedia") {
        const edizione = meseAnno(contenuti?.wikipedia.edizione);
        const testo = edizione ? `Edizione di ${edizione}` : descrizione;
        return { testo: contenuti?.wikipedia.in_corso ? `${testo}, aggiornamento in corso` : testo, tono: "vivo" };
      }
      if (s.id === "mappe") {
        const giorno = giornoMese(contenuti?.mappe.build);
        const testo = giorno ? `Italia, aggiornate il ${giorno}` : descrizione;
        return { testo: vivo.dettaglio ? `${testo}. ${vivo.dettaglio}` : testo, tono: "vivo" };
      }
      return { testo: descrizione, tono: "vivo" };
    }
  }
}

function Icona({ servizio }: { servizio: Servizio }) {
  const [rotta, setRotta] = useState(false);
  useEffect(() => setRotta(false), [servizio.icona]);
  if (!servizio.icona || rotta) {
    return (
      <span className="icona-servizio iniziale" aria-hidden="true">
        {servizio.nome.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="icona-servizio" src={indirizzoIcona(servizio.icona)} alt="" width={48} height={48} onError={() => setRotta(true)} />;
}

function Interruttore({
  acceso,
  occupato,
  etichetta,
  alCambio,
}: {
  acceso: boolean;
  occupato: boolean;
  etichetta: string;
  alCambio: (acceso: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="interruttore"
      aria-checked={acceso}
      aria-label={etichetta}
      aria-busy={occupato}
      disabled={occupato}
      onClick={() => alCambio(!acceso)}
    >
      <span className="interruttore-pista">
        <span className="interruttore-pomello" />
      </span>
    </button>
  );
}

const TIPI_IMMAGINE = ["image/png", "image/jpeg", "image/webp"];

function ModuloServizio({ servizio, aperta, alChiudere }: { servizio: Servizio | null; aperta: boolean; alChiudere: () => void }) {
  const { salvaServizio, rimuoviServizio } = useHub();
  const [nome, setNome] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [url, setUrl] = useState("");
  const [icona, setIcona] = useState<{ dati: string; anteprima: string } | null>(null);
  const [errori, setErrori] = useState<{ nome?: string; url?: string; icona?: string; generale?: string }>({});
  const [invio, setInvio] = useState(false);
  const [conferma, setConferma] = useState(false);
  const campoFile = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aperta) return;
    setNome(servizio?.nome ?? "");
    setDescrizione(servizio?.descrizione ?? "");
    setUrl(servizio?.url ?? "");
    setIcona(null);
    setErrori({});
    setConferma(false);
  }, [aperta, servizio]);

  function scegliImmagine(file: File | undefined) {
    if (!file) return;
    if (!TIPI_IMMAGINE.includes(file.type)) {
      setErrori((e) => ({ ...e, icona: "Formato non accettato. Usa un'immagine PNG, JPEG o WebP." }));
      return;
    }
    if (file.size > 512 * 1024) {
      setErrori((e) => ({ ...e, icona: "L'immagine supera i 512 KB. Scegline una più piccola." }));
      return;
    }
    const lettore = new FileReader();
    lettore.onload = () => {
      const indirizzo = String(lettore.result);
      setIcona({ dati: indirizzo.slice(indirizzo.indexOf(",") + 1), anteprima: indirizzo });
      setErrori((e) => ({ ...e, icona: undefined }));
    };
    lettore.readAsDataURL(file);
  }

  async function invia(evento: FormEvent) {
    evento.preventDefault();
    const nuovi: typeof errori = {};
    const indirizzo = url.trim();
    if (!nome.trim()) nuovi.nome = "Scrivi il nome del servizio.";
    if (!indirizzo) nuovi.url = "Scrivi l'indirizzo del servizio.";
    else if (!/^(https?:\/\/\S+|\/\S*)$/.test(indirizzo)) {
      nuovi.url = "L'indirizzo deve iniziare con http://, https:// oppure con / per una pagina di questo Raspberry.";
    }
    setErrori(nuovi);
    if (nuovi.nome || nuovi.url) return;
    setInvio(true);
    try {
      await salvaServizio(
        { nome: nome.trim(), descrizione: descrizione.trim(), url: indirizzo, ...(icona ? { icona: { dati: icona.dati } } : {}) },
        servizio?.id,
      );
      alChiudere();
    } catch (problema) {
      setErrori({
        generale:
          problema instanceof ErroreApi && problema.stato === 401
            ? "La sessione è scaduta. Chiudi questa finestra e accedi di nuovo."
            : problema instanceof Error
              ? problema.message
              : "Servizio non salvato. Riprova.",
      });
    } finally {
      setInvio(false);
    }
  }

  async function rimuovi() {
    if (!servizio) return;
    if (!conferma) return setConferma(true);
    setInvio(true);
    try {
      await rimuoviServizio(servizio.id);
      alChiudere();
    } catch (problema) {
      setErrori({ generale: problema instanceof Error ? problema.message : "Servizio non rimosso. Riprova." });
    } finally {
      setInvio(false);
    }
  }

  const anteprima = icona?.anteprima ?? (servizio?.icona ? indirizzoIcona(servizio.icona) : undefined);
  return (
    <Finestra aperta={aperta} alChiudere={alChiudere} titolo={servizio ? "Modifica servizio" : "Aggiungi servizio"}>
      <form onSubmit={invia} noValidate>
        {!servizio && (
          <p className="finestra-guida">
            Un collegamento a un altro dispositivo o a una pagina: il NAS, il router, la stampante.
          </p>
        )}
        <div className="campo">
          <label htmlFor="servizio-nome">Nome</label>
          <input id="servizio-nome" type="text" maxLength={40} placeholder="NAS" value={nome}
            aria-invalid={Boolean(errori.nome)} aria-describedby={errori.nome ? "servizio-nome-errore" : undefined}
            onChange={(e) => { setNome(e.target.value); setErrori((x) => ({ ...x, nome: undefined })); }} />
          {errori.nome && <p className="campo-errore" id="servizio-nome-errore">{errori.nome}</p>}
        </div>
        <div className="campo">
          <label htmlFor="servizio-url">Indirizzo</label>
          <input id="servizio-url" type="url" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={280}
            placeholder="http://192.168.1.20/" value={url}
            aria-invalid={Boolean(errori.url)} aria-describedby={errori.url ? "servizio-url-errore" : undefined}
            onChange={(e) => { setUrl(e.target.value); setErrori((x) => ({ ...x, url: undefined })); }} />
          {errori.url && <p className="campo-errore" id="servizio-url-errore">{errori.url}</p>}
        </div>
        <div className="campo">
          <label htmlFor="servizio-descrizione">Descrizione, se vuoi</label>
          <input id="servizio-descrizione" type="text" maxLength={80} placeholder="Foto e documenti di casa" value={descrizione}
            onChange={(e) => setDescrizione(e.target.value)} />
        </div>
        <div className="campo">
          <span className="campo-etichetta" id="servizio-icona-etichetta">Immagine dell&apos;icona</span>
          <div className="scegli-icona">
            {anteprima ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="icona-servizio" src={anteprima} alt="" width={48} height={48} />
            ) : (
              <span className="icona-servizio iniziale" aria-hidden="true">{nome.trim().charAt(0).toUpperCase() || "?"}</span>
            )}
            <input ref={campoFile} type="file" accept={TIPI_IMMAGINE.join(",")} hidden
              onChange={(e) => scegliImmagine(e.target.files?.[0])} />
            <button type="button" className="bottone" aria-describedby="servizio-icona-guida"
              onClick={() => campoFile.current?.click()}>
              <ImagePlus size={17} aria-hidden="true" />
              {anteprima ? "Cambia immagine" : "Scegli immagine"}
            </button>
          </div>
          <p className="campo-guida" id="servizio-icona-guida">PNG, JPEG o WebP, fino a 512 KB. Senza immagine compare l&apos;iniziale del nome.</p>
          {errori.icona && <p className="campo-errore">{errori.icona}</p>}
        </div>
        {errori.generale && (
          <p className="riquadro-errore" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{errori.generale}</span>
          </p>
        )}
        <div className="finestra-azioni">
          {servizio && (
            <button type="button" className="bottone pericolo a-sinistra" disabled={invio} onClick={rimuovi}>
              <Trash2 size={17} aria-hidden="true" />
              {conferma ? "Conferma: rimuovi" : "Rimuovi"}
            </button>
          )}
          <button type="button" className="bottone" onClick={alChiudere}>Annulla</button>
          <button type="submit" className="bottone pieno" disabled={invio}>
            {servizio ? "Salva modifiche" : "Aggiungi servizio"}
          </button>
        </div>
      </form>
    </Finestra>
  );
}

/** L'elenco dei servizi: ogni riga è collegata alla scheda da una pista che ne mostra lo stato. */
export function Servizi() {
  const { servizi, stati, contenuti, autenticato, inCorso, comanda, apriAccesso } = useHub();
  const [modulo, setModulo] = useState<{ servizio: Servizio | null } | null>(null);

  function conAccesso(azione: () => void) {
    if (autenticato) azione();
    else apriAccesso(azione);
  }

  if (servizi === null) {
    return <p className="servizi-attesa">Carico i servizi…</p>;
  }

  return (
    <section className="servizi" aria-label="Servizi">
      <ul className="servizi-elenco">
        {servizi.map((s, indice) => {
          const vivo = stati?.[s.id];
          const { testo, tono } = frase(s, vivo, contenuti);
          const apribile = !vivo || !["spento", "mancante"].includes(vivo.stato);
          const esterno = /^https?:\/\//.test(s.url);
          const nomeLetto = testo ? `${s.nome}, ${testo}` : s.nome;
          const contenuto = (
            <>
              <Icona servizio={s} />
              <span className="riga-testi">
                <span className="riga-nome">{s.nome}</span>
                {testo && <span className="riga-frase">{testo}</span>}
              </span>
            </>
          );
          return (
            <li key={s.id} className={`riga ${tono}${apribile ? "" : " chiusa"}`} data-servizio={s.id}
              style={{ "--i": indice } as CSSProperties}>
              {/* la derivazione dalla dorsale: gli impulsi che ci corrono sopra li disegna Flusso */}
              <span className="pista" aria-hidden="true" />
              {!apribile ? (
                <div className="riga-apri" role="link" aria-disabled="true" aria-label={nomeLetto}>{contenuto}</div>
              ) : esterno ? (
                <a className="riga-apri" href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`${nomeLetto} (si apre in una nuova scheda)`}>{contenuto}</a>
              ) : /^\/(mappe|wikipedia|hardware)(\/|$)/.test(s.url) ? (
                <Link className="riga-apri" href={s.url} aria-label={nomeLetto}>{contenuto}</Link>
              ) : (
                <a className="riga-apri" href={s.url} aria-label={nomeLetto}>{contenuto}</a>
              )}
              {s.aggiunto && autenticato && (
                <button type="button" className="bottone-icona" aria-label={`Modifica ${s.nome}`}
                  onClick={() => setModulo({ servizio: s })}>
                  <Pencil size={17} aria-hidden="true" />
                </button>
              )}
              {vivo?.interruttore && (
                <Interruttore
                  acceso={vivo.stato === "acceso"}
                  occupato={Boolean(inCorso[s.id])}
                  etichetta={s.id === "pihole" ? "Blocco della pubblicità" : s.nome}
                  alCambio={(acceso) => conAccesso(() => void comanda(s.id, acceso))}
                />
              )}
            </li>
          );
        })}
      </ul>
      {stati === null && (
        <p className="servizi-nota">
          <CircleAlert size={16} aria-hidden="true" />
          Lo stato dei servizi non arriva: il servizio di controllo del Raspberry non risponde.
        </p>
      )}
      <button type="button" className="bottone aggiungi" onClick={() => conAccesso(() => setModulo({ servizio: null }))}>
        <Plus size={18} aria-hidden="true" />
        Aggiungi servizio
      </button>
      <ModuloServizio servizio={modulo?.servizio ?? null} aperta={modulo !== null} alChiudere={() => setModulo(null)} />
    </section>
  );
}
