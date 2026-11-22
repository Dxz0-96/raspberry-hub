// Takes the screenshots shown in the README (docs/screenshots/), from the built site served by the mock
// Raspberry Pi. Run after a visible change to the interface:
//
//   npm run assets && npm run build && npm run screenshots
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "@playwright/test";

const HUB = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(HUB, "..", "docs", "screenshots");
const PORT = 8797;
const BASE = `http://localhost:${PORT}`;

const server = spawn(process.execPath, ["dev/mock-server.mjs"], {
  cwd: HUB,
  env: { ...process.env, PORT: String(PORT), MOCK_OFF: "", MOCK_TILES: "tests/fixtures/rome.pmtiles" },
  stdio: "ignore",
});

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/services.json`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the mock Raspberry Pi did not start");
}

/** Opens a page and waits until React has taken over and the readings have arrived. */
async function open(page, path) {
  await page.goto(BASE + path);
  await page.locator('html[data-i18n="ready"]').waitFor({ state: "attached" });
  await page.waitForTimeout(2500);         // board animations, first readings, map tiles
}

const shots = [
  { file: "home-light.png", path: "/", context: { viewport: { width: 1440, height: 1000 }, colorScheme: "light" }, full: false },
  { file: "home-dark.png", path: "/", context: { viewport: { width: 1440, height: 1000 }, colorScheme: "dark" }, full: false },
  { file: "phone.png", path: "/", context: { ...devices["Pixel 7"], colorScheme: "dark" }, full: false },
  { file: "hardware.png", path: "/hardware/", context: { viewport: { width: 1280, height: 900 }, colorScheme: "light" }, full: false },
  { file: "maps.png", path: "/maps/#position=15.2/41.8986/12.4768", context: { viewport: { width: 1280, height: 800 }, colorScheme: "light" },
    search: "roma" },
  { file: "wikipedia.png", path: "/wikipedia/#search=garibaldi", context: { viewport: { width: 1280, height: 800 }, colorScheme: "dark" } },
];

/** home-languages.png: the header and the services of the hub in each language, side by side, as a browser in that
 *  language gets them. Each part is a screenshot of its own; a small page lays them out and is photographed. */
const LANGUAGES = [["en-US", "English"], ["it-IT", "Italiano"], ["es-ES", "Español"], ["fr-FR", "Français"], ["de-DE", "Deutsch"]];

async function languages(browser) {
  const parts = [];
  for (const [locale, name] of LANGUAGES) {
    const context = await browser.newContext({ locale, timezoneId: "Europe/Rome", viewport: { width: 560, height: 1400 },
      colorScheme: "light", deviceScaleFactor: 1 });
    const page = await context.newPage();
    await open(page, "/");
    const header = await page.locator(".topbar").screenshot();
    const services = await page.locator("section.services").screenshot();
    parts.push({ name, images: [header, services].map((b) => `data:image/png;base64,${b.toString("base64")}`) });
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1720, height: 400 }, colorScheme: "light" });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html><body style="margin:0;padding:24px;background:#f3f5f1;
    font:600 20px/1.3 'IBM Plex Sans',system-ui,sans-serif;color:#16201a">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;align-items:start">
    ${parts.map((p) => `<figure style="margin:0;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px #0002">
      <figcaption style="padding:10px 16px">${p.name}</figcaption>
      ${p.images.map((src) => `<img src="${src}" style="display:block;width:100%">`).join("")}</figure>`).join("")}
    </div></body></html>`);
  await page.screenshot({ path: join(OUT, "home-languages.png"), fullPage: true });
  console.log("docs/screenshots/home-languages.png");
  await context.close();
}

try {
  await waitForServer();
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
  for (const shot of shots) {
    const context = await browser.newContext({ locale: "en-US", timezoneId: "Europe/Rome", ...shot.context });
    const page = await context.newPage();
    await open(page, shot.path);
    if (shot.search) {
      await page.getByRole("combobox").fill(shot.search);
      await page.getByRole("listbox").waitFor();
    }
    await page.screenshot({ path: join(OUT, shot.file), fullPage: shot.full ?? false });
    console.log(`docs/screenshots/${shot.file}`);
    await context.close();
  }
  await languages(browser);
  await browser.close();
} finally {
  server.kill();
}
