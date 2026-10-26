// serve-latest.mjs — lance le serveur local sur le dossier de service de la DERNIÈRE préparation (artifacts/canary/latest.json). Sert uniquement good.ota et to-a.ota. Ctrl+C pour l'arrêter.
import { readFileSync, existsSync } from "node:fs"; import { createServer } from "node:http"; import { appendFileSync, mkdirSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { makeHandler } from "../tools/serve-r4.mjs";
const LAB = join(dirname(fileURLToPath(import.meta.url)), ".."); const f = join(LAB, "artifacts", "canary", "latest.json");
if (!existsSync(f)) { console.log("Aucune préparation : lancer CANARY-1-PREPARER.cmd d'abord."); process.exit(1); }
const p = JSON.parse(readFileSync(f, "utf8")); const pi = process.argv.indexOf("--port"); const port = pi > 0 ? Number(process.argv[pi + 1]) : p.serverPort;
mkdirSync(join(LAB, "logs"), { recursive: true });
const log = (s) => { const l = `${new Date().toISOString()} ${s}`; console.log(l); appendFileSync(join(LAB, "logs", "canary-serve.log"), l + "\n"); };
const srv = createServer(makeHandler({ dir: p.serveDir, log }));
srv.on("error", (e) => { console.log(e.code === "EADDRINUSE" ? `Le port ${port} est déjà utilisé (un ancien serveur tourne ?) : le fermer, puis relancer.` : String(e)); process.exit(1); });
srv.listen(port, "0.0.0.0", () => log(`Serveur du canari (build ${p.commit}) sur le port ${port} — dossier ${p.serveDir} — Ctrl+C pour arrêter`));
