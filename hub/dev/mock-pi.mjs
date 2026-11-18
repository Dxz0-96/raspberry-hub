// Come mock-server.mjs, ma mappa, ricerca degli indirizzi e Wikipedia arrivano dal Raspberry vero.
// Prima apri il tunnel:  ssh -N -L 8443:127.0.0.1:443 utente@indirizzo-del-raspberry
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const qui = dirname(fileURLToPath(import.meta.url));
process.env.MOCK_PI ??= "https://127.0.0.1:8443";
process.env.MOCK_PI_CA ??= join(qui, "..", "..", "ca-di-casa.crt");
process.env.PORT ??= "8791";
process.env.MOCK_SPENTI ??= "";
await import("./mock-server.mjs");
