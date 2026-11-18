import Link from "next/link";
import { Andamento, Avvisi } from "@/components/Andamento";
import { ReteESpazio } from "@/components/Diagrammi";
import { Flusso } from "@/components/Impulsi";
import { Scheda, SchedaCompatta } from "@/components/Scheda";
import { PiePagina } from "@/components/PiePagina";
import { Servizi } from "@/components/Servizi";
import { Testata } from "@/components/Testata";

export default function Casa() {
  return (
    <>
      <Testata />
      <main className="pagina">
      <Avvisi />
      <div className="casa">
        <div className="casa-scheda">
          <div className="solo-largo">
            <Scheda cavo />
          </div>
          <Link href="/hardware/" className="solo-stretto scheda-tocco" aria-label="Apri il dettaglio dell'hardware">
            <SchedaCompatta />
          </Link>
        </div>
        <Servizi />
        <Flusso />
      </div>
      <ReteESpazio />
      <Andamento />
      </main>
      <PiePagina />
    </>
  );
}
