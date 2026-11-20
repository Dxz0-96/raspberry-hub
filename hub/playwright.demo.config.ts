import { defineConfig, devices } from "@playwright/test";

// End-to-end tests of the demo for GitHub Pages: the site built by npm run demo (out-demo/), served under
// /raspberry-hub/ by scripts/serve-demo.mjs, with no mock Raspberry Pi behind it.
//   npm run demo && npm run test:demo
const PORT = 8796;

export default defineConfig({
  testDir: "demo-tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}/raspberry-hub/`,
    locale: "en-US",
    timezoneId: "Europe/Rome",
    trace: "retain-on-failure",
    launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node scripts/serve-demo.mjs",
    url: `http://localhost:${PORT}/raspberry-hub/`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
  },
});
