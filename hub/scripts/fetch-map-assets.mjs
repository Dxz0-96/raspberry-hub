// Downloads into the site the fonts and icons the map needs, so the hub asks nothing from the internet
// while in use. Run it on the PC before the build: npm run assets
//
// Source: https://github.com/protomaps/basemaps-assets (the same files used by the Protomaps style).
// Font ranges: Latin, Greek and Cyrillic for Italy and the nearby countries; Arabic and Tifinagh for the
// names of the places on the African coast that fall inside the map box.
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://protomaps.github.io/basemaps-assets";
// MAP_ASSETS_DIR: somewhere else, for .github/scripts/check-sources.sh, which checks that everything still downloads
const DESTINATION = process.env.MAP_ASSETS_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "public", "map-assets");
const FONTS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
const RANGES = [
  0, 256, 512, 768, 1024, 1280, 1536, 1792, 7680, 7936, 8192, 8448, 8704, 11520, 64256, 64512, 64768, 65024, 65280,
];
const THEMES = ["light", "dark"];

const files = [];
for (const font of FONTS) {
  for (const start of RANGES) files.push(`fonts/${font}/${start}-${start + 255}.pbf`);
}
for (const theme of THEMES) {
  for (const suffix of ["", "@2x"]) {
    files.push(`sprites/v4/${theme}${suffix}.json`, `sprites/v4/${theme}${suffix}.png`);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

let downloaded = 0;
let present = 0;
let size = 0;
const missing = [];
async function download(relative) {
  const destination = join(DESTINATION, relative);
  if (await exists(destination)) {
    present++;
    return;
  }
  const response = await fetch(`${SOURCE}/${relative.split("/").map(encodeURIComponent).join("/")}`);
  if (response.status === 404 && relative.startsWith("fonts/")) {
    missing.push(relative);                  // the font has no glyphs in that range
    return;
  }
  if (!response.ok) throw new Error(`${relative}: status ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, data);
  downloaded++;
  size += data.length;
}

const queue = [...files];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) await download(queue.shift());
  }),
);
// Every font has Basic Latin glyphs: when that range is missing too, the files have moved, and the map would
// have no labels at all.
const lost = FONTS.filter((font) => missing.includes(`fonts/${font}/0-255.pbf`));
if (lost.length) throw new Error(`no Basic Latin glyphs for ${lost.join(", ")}: have the files moved from ${SOURCE}?`);
console.log(
  `Map assets: ${downloaded} downloaded (${(size / 1048576).toFixed(1)} MB), ${present} already present, ` +
    `${missing.length} ranges without glyphs, in ${process.env.MAP_ASSETS_DIR || "public/map-assets"}`,
);
