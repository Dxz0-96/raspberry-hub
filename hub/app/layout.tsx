import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-ext-400.css";
import "@fontsource/ibm-plex-sans/latin-ext-500.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./globals.css";
import { FornitoreHub } from "@/lib/hub";
import { Accesso } from "@/components/Accesso";
import { AvvisoInBasso } from "@/components/AvvisoInBasso";

export const metadata: Metadata = {
  title: { default: "raspberry", template: "%s, raspberry" },
  description: "L'hub di casa: Pi-hole, Wikipedia offline, mappe e stato del Raspberry.",
  icons: { icon: "/icona.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F5F1" },
    { media: "(prefers-color-scheme: dark)", color: "#10261A" },
  ],
};

// Prima che la pagina compaia: applica il tema scelto su questo dispositivo (se c'è), così non
// lampeggia quello sbagliato. Senza scelta salvata vale il tema del browser.
const TEMA_SUBITO = `try{var t=localStorage.getItem("tema");if(t==="chiaro"||t==="scuro")document.documentElement.dataset.tema=t}catch(e){}`;

export default function Impianto({ children }: { children: ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEMA_SUBITO }} />
      </head>
      <body>
        <FornitoreHub>
          {children}
          <Accesso />
          <AvvisoInBasso />
        </FornitoreHub>
      </body>
    </html>
  );
}
