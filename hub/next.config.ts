import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// Versione, licenza e indirizzo del codice vengono da package.json; il commit da git, se c'e'.
// Finiscono nel pie' di pagina dell'hub.
const pacchetto = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  version: string;
  license?: string;
  repository?: string | { url?: string };
};
const repo = (typeof pacchetto.repository === "string" ? pacchetto.repository : pacchetto.repository?.url ?? "")
  .replace(/^git\+/, "")
  .replace(/\.git$/, "");

function commit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

// L'hub e' un sito statico: si compila sul PC e si copia sul Raspberry, dove lo serve Caddy.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_VERSIONE: pacchetto.version,
    NEXT_PUBLIC_LICENZA: pacchetto.license ?? "",
    NEXT_PUBLIC_REPO: repo,
    NEXT_PUBLIC_COMMIT: commit(),
    NEXT_PUBLIC_COMPILATO: new Date().toISOString(),
  },
};

export default config;
