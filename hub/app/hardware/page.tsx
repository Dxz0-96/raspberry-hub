import type { Metadata } from "next";
import { Andamento, Avvisi } from "@/components/Andamento";
import { ReteESpazio } from "@/components/Diagrammi";
import { PiePagina } from "@/components/PiePagina";
import { Scheda } from "@/components/Scheda";
import { Testata } from "@/components/Testata";

export const metadata: Metadata = { title: "Hardware" };

export default function Hardware() {
  return (
    <>
      <Testata titolo="Hardware" indietro />
      <main className="pagina">
      <Avvisi />
      <div className="hardware-scheda">
        <Scheda verso="auto" />
      </div>
      <ReteESpazio />
      <Andamento />
      </main>
      <PiePagina />
    </>
  );
}
