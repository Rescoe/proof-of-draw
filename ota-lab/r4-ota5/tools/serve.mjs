// serve.mjs [--dir artifacts/release] [--port 8081] — sert LOCALEMENT /manifest.txt et /firmware.bin (binaire BRUT) d'un dossier de release, avec Content-Length. HTTP en clair (laboratoire) ; rien d'autre n'est servi ;
// aucun .ota. Chaque requête est journalisée dans logs/serve-r4b.log. Les cas négatifs ne sont PAS servis par cet outil : ils sont jugés sur l'hôte.
import http from "node:http"; import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
export function makeHandler({ dir, log = () => {} }) {
  return (req, res) => {
    const p = (req.url ?? "/").split("?")[0]; const name = p === "/manifest.txt" ? "manifest.txt" : p === "/firmware.bin" ? "firmware.bin" : null;
    if (req.method !== "GET" && req.method !== "HEAD") { log(`${req.method} ${p} -> 405`); res.writeHead(405); return res.end(); }
    if (!name || !existsSync(join(dir, name))) { log(`GET ${p} -> 404`); res.writeHead(404); return res.end("introuvable"); }
    const body = readFileSync(join(dir, name)); log(`${req.method} ${p} -> ${body.length} o`);
    res.writeHead(200, { "Content-Type": name.endsWith(".txt") ? "text/plain" : "application/octet-stream", "Content-Length": String(body.length) }); return res.end(req.method === "HEAD" ? undefined : body);
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = arg("--dir", join(ROOT, "artifacts", "release")), port = Number(arg("--port", "8081")); mkdirSync(join(ROOT, "logs"), { recursive: true });
  const log = (s) => { const l = `${new Date().toISOString()} ${s}`; console.log(l); appendFileSync(join(ROOT, "logs", "serve-r4b.log"), l + "\n"); };
  http.createServer(makeHandler({ dir, log })).listen(port, "0.0.0.0", () => log(`serveur R4-B sur le port ${port}, dossier ${dir}`));
}
