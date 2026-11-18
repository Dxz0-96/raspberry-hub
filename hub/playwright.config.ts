import { defineConfig, devices } from "@playwright/test";

// Test end-to-end dell'hub: il sito compilato (out/) servito dal finto Raspberry (dev/mock-server.mjs),
// con una piccola mappa di Roma (tests/fixtures/roma.pmtiles, dati OpenStreetMap) e una Wikipedia finta.
//   npm run build && npm test
const PORTA = 8795;

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORTA}`,
    locale: "it-IT",
    timezoneId: "Europe/Rome",
    trace: "retain-on-failure",
    // la mappa disegna con WebGL: senza scheda grafica serve quello software di Chromium
    launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] },
  },
  projects: [
    { name: "computer", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "telefono", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node dev/mock-server.mjs",
    url: `http://localhost:${PORTA}/servizi.json`,
    env: { PORT: String(PORTA), MOCK_SPENTI: "", MOCK_TILES: "tests/fixtures/roma.pmtiles" },
    reuseExistingServer: !process.env.CI,
  },
});
