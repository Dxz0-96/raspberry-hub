// Serves the demo (out-demo/, from npm run demo) the way GitHub Pages does: under /raspberry-hub/, with range
// requests (the map reads the tiles in pieces) and 404.html for missing pages. For npm run test:demo, and to look
// at the demo on the PC: node scripts/serve-demo.mjs, then http://localhost:8796/raspberry-hub/
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "out-demo");
const BASE = process.env.HUB_BASE_PATH ?? "/raspberry-hub";
const PORT = Number(process.env.PORT ?? 8796);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
  ".pbf": "application/x-protobuf", ".pmtiles": "application/octet-stream",
};

function send(res, path, status) {
  const size = statSync(path).size;
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  const range = /bytes=(\d+)-(\d*)/.exec(res.req.headers.range ?? "");
  if (range && status === 200) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1, "Accept-Ranges": "bytes" });
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(status, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
  createReadStream(path).pipe(res);
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (path === "/" || path === BASE) return res.writeHead(301, { Location: `${BASE}/` }).end();
  if (!path.startsWith(`${BASE}/`)) return send(res, join(ROOT, "404.html"), 404);
  const relative = normalize(path.slice(BASE.length)).replace(/^(\.\.[/\\])+/, "");
  for (const candidate of [join(ROOT, relative), join(ROOT, relative, "index.html"), join(ROOT, `${relative}.html`)]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return send(res, candidate, 200);
  }
  send(res, join(ROOT, "404.html"), 404);
}).listen(PORT, () => console.log(`Demo on http://localhost:${PORT}${BASE}/`));
