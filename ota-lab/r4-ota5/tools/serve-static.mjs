// serve-static.mjs --dir <dossier> [--port 8084] — serveur de LABORATOIRE de fichiers statiques (GET /<nom>.bin|.txt|.png), Content-Length, aucune liste de dossier. Sert aux essais de capacité du staging du module (octets aléatoires).
import http from "node:http"; import { readFileSync, existsSync } from "node:fs"; import { join, basename } from "node:path";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg("--dir"), port = Number(arg("--port", "8084")); if (!dir) { console.error("usage : serve-static.mjs --dir D [--port P]"); process.exit(2); }
http.createServer((req, res) => {
  const n = basename((req.url ?? "/").split("?")[0]); const f = join(dir, n);
  if (!/^[A-Za-z0-9_.-]+$/.test(n) || !existsSync(f)) { console.log(new Date().toISOString(), "GET", req.url, "-> 404"); res.writeHead(404); return res.end("introuvable"); }
  const b = readFileSync(f); console.log(new Date().toISOString(), "GET", req.url, "->", b.length, "o"); res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(b.length) }); res.end(b);
}).listen(port, "0.0.0.0", () => console.log("static sur", port, dir));
