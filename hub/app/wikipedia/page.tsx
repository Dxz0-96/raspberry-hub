import type { Metadata } from "next";
import { PiePagina } from "@/components/PiePagina";
import { Testata } from "@/components/Testata";
import Wikipedia from "@/components/Wikipedia";

export const metadata: Metadata = { title: "Wikipedia" };

export default function PaginaWikipedia() {
  return (
    <>
      <Testata titolo="Wikipedia" indietro />
      {/* barra di ricerca (sotto la testata, larga quanto la finestra) e contenuto */}
      <Wikipedia />
      <PiePagina />
    </>
  );
}
