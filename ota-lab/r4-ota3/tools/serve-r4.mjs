// serve-r4.mjs [--dir artifacts/serve] [--logs logs] [--http 8080]
// Serveur de test LOCAL pour la sonde R4 (HTTP en clair, aucune sortie vers Internet). Sert <dir>/<nom>.ota (nom = [a-z0-9-]+).
//   /<nom>.ota        fichier TEL QUEL, avec Content-Length
//   /slow/<nom>.ota   idem, débit limité (2 Ko / 100 ms) : laisse le temps de couper le courant PENDANT le téléchargement du module
//   /chunked/<nom>.ota  sans Content-Length (Transfer-Encoding: chunked) : le module doit refuser (HttpHeaderError -7)
// Chaque requête est journalisée (logs/serve-r4.log) : c'est la preuve INDÉPENDANTE de ce que le module a réellement demandé.
import http from "node:http"; import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
export function makeHandler({ dir, log = () => {} }) {
  return (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const m = /^\/(slow\/|chunked\/)?([a-z0-9-]+)\.ota$/.exec(path);
    if (!m || !existsSync(join(dir, m[2] + ".ota"))) { log(`${req.method} ${path} -> 404`); res.writeHead(404); return res.end("introuvable"); }
    const body = readFileSync(join(dir, m[2] + ".ota")); const mode = m[1] ? m[1].replace("/", "") : "plain";
    log(`GET ${path} depuis ${req.socket.remoteAddress} -> ${mode} ${body.length} o`);
    if (mode === "chunked") { res.writeHead(200, { "Content-Type": "application/octet-stream", "Transfer-Encoding": "chunked" }); res.write(body.subarray(0, 4096)); return res.end(body.subarray(4096)); }
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(body.length) });
    if (mode === "plain") return res.end(body);
    let off = 0; const t = setInterval(() => { if (off >= body.length || res.destroyed) { clearInterval(t); return res.end(); } res.write(body.subarray(off, off + 2048)); off += 2048; }, 100);
    res.on("close", () => clearInterval(t));
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = arg("--dir", join(ROOT, "artifacts", "serve")), logs = arg("--logs", join(ROOT, "logs")), port = Number(arg("--http", "8080")); mkdirSync(logs, { recursive: true });
  const log = (s) => { const l = `${new Date().toISOString()} ${s}`; console.log(l); appendFileSync(join(logs, "serve-r4.log"), l + "\n"); };
  http.createServer(makeHandler({ dir, log })).listen(port, "0.0.0.0", () => log(`HTTP sur ${port} (dossier ${dir})`));
}
