// make-keys-header.mjs [--keys-dir artifacts/keys] --out <chemin/pod_ota_r4_keys.h> — écrit le en-tête des clés PUBLIQUES de publication (r4-a, r4-b) compilées dans un firmware R4.
// Sans cet en-tête, le firmware n'accepte AUCUNE mise à jour (échec fermé). Les clés de ce dépôt (artifacts/keys) sont des clés de TEST ; l'en-tête produit est ignoré par git. Aucune graine privée n'y figure.
import { readFileSync, writeFileSync, existsSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const kd = arg("--keys-dir", join(ROOT, "artifacts", "keys")), out = arg("--out"); if (!out) { console.error("usage : make-keys-header.mjs [--keys-dir D] --out <pod_ota_r4_keys.h>"); process.exit(2); }
const pub = (id) => { const f = join(kd, id + ".pub"); return existsSync(f) ? readFileSync(f, "utf8").trim() : null; };
const a = pub("r4-a"), b = pub("r4-b"); if (!a || !/^[0-9a-f]{64}$/.test(a)) { console.error("clé r4-a absente ou mal formée (lancer keygen.mjs)"); process.exit(1); }
let t = `// pod_ota_r4_keys.h — GÉNÉRÉ (make-keys-header.mjs) : clés publiques de publication OTA R4. NE PAS COMMITER (ignoré par git).\n#pragma once\n#define OTAR4_PUB_A_HEX "${a}"\n`;
if (b && /^[0-9a-f]{64}$/.test(b)) t += `#define OTAR4_PUB_B_HEX "${b}"\n`;
writeFileSync(out, t); console.log(`écrit ${out} (r4-a ${a.slice(0, 12)}…${b ? ", r4-b " + b.slice(0, 12) + "…" : ""})`);
