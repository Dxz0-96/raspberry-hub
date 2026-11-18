import Link from "next/link";

export default function NonTrovata() {
  return (
    <main className="pagina pagina-messaggio">
      <h1>Questa pagina non esiste</h1>
      <p>L&apos;indirizzo non corrisponde a nessuna pagina dell&apos;hub né a un servizio agganciato.</p>
      <Link href="/" className="bottone pieno">
        Torna all&apos;hub
      </Link>
    </main>
  );
}
