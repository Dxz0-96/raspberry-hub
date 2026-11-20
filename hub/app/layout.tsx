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
import { HubProvider } from "@/lib/hub";
import { I18nProvider, LANGUAGE_SCRIPT } from "@/lib/i18n";
import { DemoBanner } from "@/components/DemoBanner";
import { LoginDialog } from "@/components/LoginDialog";
import { Toast } from "@/components/Toast";

export const metadata: Metadata = {
  description: "The home hub: Pi-hole, offline Wikipedia, maps and the state of the Raspberry Pi.",
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icon.svg` },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F5F1" },
    { media: "(prefers-color-scheme: dark)", color: "#10261A" },
  ],
};

// Before the page appears: applies the theme chosen on this device (if any), so the wrong one does not
// flash. Without a saved choice the browser theme applies. ("tema" is the key used by version 1.x.)
const THEME_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem("theme");
if(t===null){var o=localStorage.getItem("tema");if(o!==null){t=o==="chiaro"?"light":o==="scuro"?"dark":null;
localStorage.removeItem("tema");if(t)localStorage.setItem("theme",t)}}
if(t==="light"||t==="dark")d.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LANGUAGE_SCRIPT }} />
      </head>
      <body>
        <I18nProvider>
          <HubProvider>
            <DemoBanner />
            {children}
            <LoginDialog />
            <Toast />
          </HubProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
