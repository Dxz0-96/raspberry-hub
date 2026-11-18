import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Servizio spento" };

// Caddy mostra questa pagina quando un servizio dietro l'hub è spento o non risponde.
export default function Spento() {
  return (
    <main className="pagina pagina-messaggio">
      <h1>Questo servizio è spento o non risponde</h1>
      <p>
        Se lo hai spento dall&apos;hub, riaccendilo con il suo interruttore e riprova. Se era acceso, dagli qualche
        secondo: dopo un riavvio del Raspberry i servizi impiegano un momento a ripartire.
      </p>
      <Link href="/" className="bottone pieno">
        Torna all&apos;hub
      </Link>
    </main>
  );
}
