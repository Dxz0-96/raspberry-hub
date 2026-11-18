import { defineConfig, devices } from "@playwright/test";

// End-to-end tests of the hub: the built site (out/) served by the mock Raspberry Pi (dev/mock-server.mjs),
// with a small map of Rome (tests/fixtures/rome.pmtiles, OpenStreetMap data) and a fake Wikipedia.
// The browser language is English; tests/i18n.spec.ts covers Italian.
//   npm run build && npm test
const PORT = 8795;

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // every map page draws with software WebGL: more than a few at once exhaust it and crash the browser
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "en-US",
    timezoneId: "Europe/Rome",
    trace: "retain-on-failure",
    // the map draws with WebGL: without a graphics card it needs Chromium's software renderer
    launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node dev/mock-server.mjs",
    url: `http://localhost:${PORT}/services.json`,
    env: { PORT: String(PORT), MOCK_OFF: "", MOCK_TILES: "tests/fixtures/rome.pmtiles" },
    reuseExistingServer: !process.env.CI,
  },
});
