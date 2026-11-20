// Smoke test of the built site: starts the mock Raspberry Pi and checks that every page and API the hub
// needs answers, before the slower Playwright suite runs. Run after npm run build:
//
//   npm run smoke
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HUB = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8798;
const BASE = `http://localhost:${PORT}`;

/** path, expected status, text the body must contain */
const CHECKS = [
  ["/", 200, "<title>raspberry</title>"],
  ["/hardware/", 200, "<title>Hardware, raspberry</title>"],
  ["/maps/", 200, "<title>Maps, raspberry</title>"],
  ["/wikipedia/", 200, "<title>Wikipedia, raspberry</title>"],
  ["/unavailable/", 200, "This service is off or not responding"],
  ["/does-not-exist/", 404, "This page does not exist"],
  ["/icon.svg", 200, "<svg"],
  ["/services.json", 200, '"services"'],
  ["/status.json", 200, '"wikipedia"'],
  ["/icons/maps.svg", 200, "<svg"],
  ["/control/status", 200, '"authenticated"'],
  ["/control/system", 200, '"cpu"'],
  ["/control/system/history", 200, '"recent"'],
  ["/control/system/history?period=month", 200, '"month"'],
  ["/search?q=milano", 200, '"results"'],
  ["/wiki/content/wikipedia_it/Main_Page", 200, "Welcome to Wikipedia"],
];

const server = spawn(process.execPath, ["dev/mock-server.mjs"], {
  cwd: HUB,
  env: { ...process.env, PORT: String(PORT), MOCK_OFF: "" },
  stdio: "ignore",
});

let failed = 0;
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${BASE}/services.json`)).ok) break;
    } catch {
      if (i > 100) throw new Error("the mock Raspberry Pi did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  for (const [path, status, text] of CHECKS) {
    const response = await fetch(BASE + path);
    const body = await response.text();
    const ok = response.status === status && body.includes(text);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"}  ${response.status}  ${path}${ok ? "" : `  (expected ${status} with ${JSON.stringify(text)})`}`);
  }
} finally {
  server.kill();
}
console.log(failed ? `\n${failed} of ${CHECKS.length} checks failed` : `\nall ${CHECKS.length} checks passed`);
process.exit(failed ? 1 : 0);
