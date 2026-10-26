// keygen.mjs [--dir artifacts/keys] — crée DEUX paires Ed25519 de TEST (r4-a, r4-b). Écrit <id>.seed (graine privée, 64 hex) et <id>.pub (clé publique, 64 hex) + keys.json (public seulement).
// Refuse d'écraser une paire existante. Les clés de ce dossier sont des clés de LABORATOIRE : jamais de production, jamais commitées (dossier ignoré par git).
import { existsSync, mkdirSync, writeFileSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { generateTestKeyPair } from "../../../lib/otaManifestR4.ts";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); const di = process.argv.indexOf("--dir"); const dir = di > 0 ? process.argv[di + 1] : join(ROOT, "artifacts", "keys");
mkdirSync(dir, { recursive: true }); const pubs = {};
for (const id of ["r4-a", "r4-b"]) {
  const seed = join(dir, id + ".seed"), pub = join(dir, id + ".pub");
  if (existsSync(seed) || existsSync(pub)) { console.error(`${id} existe déjà dans ${dir} : refus d'écraser`); process.exit(1); }
  const k = generateTestKeyPair(); writeFileSync(seed, k.seedHex + "\n", { mode: 0o600 }); writeFileSync(pub, k.publicHex + "\n"); pubs[id] = k.publicHex;
}
writeFileSync(join(dir, "keys.json"), JSON.stringify(pubs, null, 2) + "\n"); console.log(`clés de TEST écrites dans ${dir} (graines privées : ne jamais commiter) ; clés publiques :`); for (const [k, v] of Object.entries(pubs)) console.log(`  ${k} ${v}`);
