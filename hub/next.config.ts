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

// The hub is a static site: it is built on the PC and copied to the Raspberry Pi, where Caddy serves it.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_VERSION: pkg.version,
    NEXT_PUBLIC_LICENSE: pkg.license ?? "",
    NEXT_PUBLIC_REPO: repo,
    NEXT_PUBLIC_COMMIT: commit(),
    NEXT_PUBLIC_BUILT: new Date().toISOString(),
  },
};

export default config;
