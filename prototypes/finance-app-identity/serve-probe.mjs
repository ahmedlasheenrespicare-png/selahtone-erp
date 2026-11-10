/**
 * TEST ONLY — tiny read-only static server for the Arena live preview.
 * Serves ONLY the two reviewed, secret-free files by an explicit allowlist.
 * Nothing else in the repository is reachable; no directory listing, no env
 * values, no database connection. Bound to 0.0.0.0 for the preview proxy.
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const allow = new Map([
  ["/app-identity-probe-standalone.mjs", "app-identity-probe-standalone.mjs"],
  ["/app-connection-probe.test-only.sql", "app-connection-probe.test-only.sql"],
]);
const port = Number(process.env.PORT || 8000);

http.createServer((req, res) => {
  const key = (req.url || "/").split("?")[0];
  const file = allow.get(key);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET" || !file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found\n");
    return;
  }
  const body = readFileSync(path.join(dir, file));
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": `attachment; filename="${file}"`,
    "Content-Length": body.length,
  });
  res.end(body);
}).listen(port, "0.0.0.0", () => console.log(`probe file server listening on 0.0.0.0:${port}`));
