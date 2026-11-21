import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// Version, license and source address come from package.json; the commit from git, when available.
// They end up in the footer of the hub.
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  version: string;
  license?: string;
  repository?: string | { url?: string };
};
const repo = (typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "")
  .replace(/^git\+/, "")
  .replace(/\.git$/, "");

function commit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

// The demo on GitHub Pages (npm run demo) lives under /<repository>/ and is built in its own folders, so it
// never mixes with the site for the Raspberry Pi, which is served from the root.
const basePath = process.env.HUB_BASE_PATH ?? "";

// The hub is a static site: it is built on the PC and copied to the Raspberry Pi, where Caddy serves it.
const config: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  distDir: process.env.HUB_DIST_DIR || ".next",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_VERSION: pkg.version,
    NEXT_PUBLIC_LICENSE: pkg.license ?? "",
    NEXT_PUBLIC_REPO: repo,
    NEXT_PUBLIC_COMMIT: commit(),
    NEXT_PUBLIC_BUILT: new Date().toISOString(),
    NEXT_PUBLIC_BASE_PATH: basePath,
    // always set, so the demo code is left out of the site for the Raspberry Pi, not only never run there
    NEXT_PUBLIC_DEMO: process.env.NEXT_PUBLIC_DEMO === "1" ? "1" : "",
  },
};

export default config;
