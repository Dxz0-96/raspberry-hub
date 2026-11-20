// Builds the demo of the hub for GitHub Pages into out-demo/ (npm run demo): the static site with
// NEXT_PUBLIC_DEMO=1, under HUB_BASE_PATH (default /raspberry-hub), plus what Caddy would serve next to it on a
// Raspberry Pi: the services of a new installation (pi/services.json) with their icons, and a small map of
// central Rome (tests/fixtures/rome.pmtiles). Run npm run assets first, for the map fonts and icons.
//
// The demo is built into its own folder (out-demo: with a static export, Next.js writes the site to its distDir),
// so out/, the site copied to a Raspberry Pi, is never touched.
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HUB = join(dirname(fileURLToPath(import.meta.url)), "..");
const PI = join(HUB, "..", "pi");
const DEMO = join(HUB, "out-demo");
const basePath = process.env.HUB_BASE_PATH ?? "/raspberry-hub";

rmSync(DEMO, { recursive: true, force: true });
const next = join(HUB, "node_modules", "next", "dist", "bin", "next");
const build = spawnSync(process.execPath, [next, "build"], {
  cwd: HUB,
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_DEMO: "1", HUB_BASE_PATH: basePath, HUB_DIST_DIR: "out-demo" },
});
if (build.status !== 0) process.exit(build.status ?? 1);

cpSync(join(PI, "icons"), join(DEMO, "icons"), { recursive: true });
copyFileSync(join(PI, "services.json"), join(DEMO, "services.json"));
mkdirSync(join(DEMO, "tiles"), { recursive: true });
copyFileSync(join(HUB, "tests", "fixtures", "rome.pmtiles"), join(DEMO, "tiles", "basemap.pmtiles"));
writeFileSync(join(DEMO, ".nojekyll"), "");
console.log(`Demo built in out-demo/, for ${basePath}/`);
