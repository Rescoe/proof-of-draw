// serve-cases.mjs [--dir artifacts/negatives] [--port 8082] — serveur de LABORATOIRE des cas négatifs (S2) : sert /manifest.txt et /firmware.bin du cas COURANT ; GET /__case/<nom> change de cas (127.0.0.1 seulement).
// HTTP en clair, aucune route publique. Journal : logs/serve-cases.log.
import http from "node:http"; import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg("--dir", join(ROOT, "artifacts", "negatives")), port = Number(arg("--port", "8082")); mkdirSync(join(ROOT, "logs"), { recursive: true });
let current = ""; const log = (s) => { const l = `${new Date().toISOString()} [${current}] ${s}`; console.log(l); appendFileSync(join(ROOT, "logs", "serve-cases.log"), l + "\n"); };
http.createServer((req, res) => {
  const p = (req.url ?? "/").split("?")[0]; const local = req.socket.remoteAddress === "127.0.0.1" || req.socket.remoteAddress === "::1" || req.socket.remoteAddress === "::ffff:127.0.0.1";
  if (p.startsWith("/__case/")) { if (!local) { res.writeHead(403); return res.end(); } const n = decodeURIComponent(p.slice(8)); if (!/^[a-z0-9-]+$/.test(n) || !existsSync(join(dir, n))) { res.writeHead(404); return res.end("cas inconnu"); } current = n; log("cas courant"); res.writeHead(200); return res.end("ok"); }
  const name = p === "/manifest.txt" ? "manifest.txt" : p === "/firmware.bin" ? "firmware.bin" : null;
  if (!name || !current || !existsSync(join(dir, current, name))) { log(`GET ${p} -> 404`); res.writeHead(404); return res.end("introuvable"); }
  const body = readFileSync(join(dir, current, name)); log(`GET ${p} -> ${body.length} o`);
  res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(body.length) }); res.end(body);
}).listen(port, "0.0.0.0", () => log(`serveur de cas négatifs sur le port ${port}`));
