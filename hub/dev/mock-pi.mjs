// Like mock-server.mjs, but the map, the address search and Wikipedia come from the real Raspberry Pi.
// First open the tunnel:  ssh -N -L 8443:127.0.0.1:443 user@raspberry-address
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
process.env.MOCK_PI ??= "https://127.0.0.1:8443";
// ca-di-casa.crt is the name used by version 1.x
process.env.MOCK_PI_CA ??= [join(root, "home-ca.crt"), join(root, "ca-di-casa.crt")].find(existsSync) ?? join(root, "home-ca.crt");
process.env.PORT ??= "8791";
process.env.MOCK_OFF ??= "";
await import("./mock-server.mjs");
