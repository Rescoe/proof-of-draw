// serve-tls.mjs [--dir artifacts/release-tls] [--port 8443] [--cert artifacts/tls/cert.pem --key artifacts/tls/key.pem] — HTTPS de LABORATOIRE (certificat auto-signé, jamais en production) : sert /manifest.txt et /firmware.bin avec Content-Length.
// Le client R4 ne vérifie pas le certificat (TLS non authentifié : la preuve est la signature du manifeste + le SHA-256 du binaire). Journal : logs/serve-tls.log.
import https from "node:https"; import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg("--dir", join(ROOT, "artifacts", "release-tls")), port = Number(arg("--port", "8443")); mkdirSync(join(ROOT, "logs"), { recursive: true });
const log = (s) => { const l = `${new Date().toISOString()} ${s}`; console.log(l); appendFileSync(join(ROOT, "logs", "serve-tls.log"), l + "\n"); };
const opts = { cert: readFileSync(arg("--cert", join(ROOT, "artifacts", "tls", "cert.pem"))), key: readFileSync(arg("--key", join(ROOT, "artifacts", "tls", "key.pem"))) };
https.createServer(opts, (req, res) => {
  const p = (req.url ?? "/").split("?")[0]; const name = p === "/manifest.txt" ? "manifest.txt" : p === "/firmware.bin" ? "firmware.bin" : null;
  if (!name || !existsSync(join(dir, name))) { log(`GET ${p} -> 404`); res.writeHead(404); return res.end("introuvable"); }
  const body = readFileSync(join(dir, name)); log(`GET ${p} -> ${body.length} o`);
  res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(body.length) }); res.end(body);
}).on("tlsClientError", (e) => log("tlsClientError " + e.message)).listen(port, "0.0.0.0", () => log(`HTTPS de laboratoire sur le port ${port}, dossier ${dir}`));
