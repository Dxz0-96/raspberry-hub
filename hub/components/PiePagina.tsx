import { Download, GitBranch, Scale } from "lucide-react";

const VERSIONE = process.env.NEXT_PUBLIC_VERSIONE ?? "";
const LICENZA = process.env.NEXT_PUBLIC_LICENZA ?? "";
const REPO = process.env.NEXT_PUBLIC_REPO ?? "";
const COMMIT = process.env.NEXT_PUBLIC_COMMIT ?? "";
const COMPILATO = process.env.NEXT_PUBLIC_COMPILATO ?? "";

/** Il pie' di pagina: che cos'e' l'hub, versione, codice sorgente e da dove vengono i dati. */
export function PiePagina() {
  const data = COMPILATO
    ? new Date(COMPILATO).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" })
    : "";
  return (
    <footer className="piede">
      <div className="piede-dentro">
        <div className="piede-progetto">
          <p className="piede-nome">
            raspberry hub
            {VERSIONE && (
              <span className="piede-versione" title={COMMIT ? `commit ${COMMIT}` : undefined}>
                v{VERSIONE}
                {COMMIT && ` · ${COMMIT}`}
              </span>
            )}
          </p>
          <p>
            L&apos;hub di casa per Raspberry Pi: Pi-hole, Wikipedia e mappe dell&apos;Italia offline, stato dell&apos;hardware.
            Tutto gira sul Raspberry, senza servizi esterni.
          </p>
          {data && <p className="piede-piccolo">Versione compilata il {data}</p>}
        </div>
        <ul className="piede-collegamenti">
          {REPO && (
            <li>
              <a href={REPO} target="_blank" rel="noopener noreferrer">
                <GitBranch size={17} aria-hidden="true" />
                <span>Codice su GitHub</span>
                <span className="solo-lettori"> (si apre in una nuova scheda)</span>
              </a>
            </li>
          )}
          {LICENZA && (
            <li>
              {REPO ? (
                <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
                  <Scale size={17} aria-hidden="true" />
                  <span>Licenza {LICENZA}</span>
                  <span className="solo-lettori"> (si apre in una nuova scheda)</span>
                </a>
              ) : (
                <span className="piede-voce">
                  <Scale size={17} aria-hidden="true" />
                  <span>Licenza {LICENZA}</span>
                </span>
              )}
            </li>
          )}
          <li>
            <a href="/ca.crt" download="ca-di-casa.crt">
              <Download size={17} aria-hidden="true" />
              <span>Certificato di casa</span>
            </a>
          </li>
        </ul>
      </div>
      <p className="piede-fonti">
        Mappe: © contributori di <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (ODbL), Protomaps.
        Indirizzi: Photon, dati OpenStreetMap. Wikipedia: testi in licenza CC BY-SA 4.0, archivio Kiwix.
      </p>
    </footer>
  );
}
