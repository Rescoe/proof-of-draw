// compare-staging.mjs <staging-relu.bin> <original.bin> — compare le fichier de staging RELU depuis le module au binaire d'origine : taille, SHA-256, premier octet différent. Code 0 si identiques, 1 sinon.
import { readFileSync } from "node:fs"; import { createHash } from "node:crypto";
const [a, b] = process.argv.slice(2); if (!a || !b) { console.error("usage : compare-staging.mjs <staging-relu.bin> <original.bin>"); process.exit(2); }
const x = readFileSync(a), y = readFileSync(b); const h = (z) => createHash("sha256").update(z).digest("hex");
let first = -1; for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) { first = i; break; }
console.log(`staging : ${x.length} o ${h(x)}\noriginal: ${y.length} o ${h(y)}`);
if (x.length === y.length && first < 0) { console.log("IDENTIQUES"); process.exit(0); }
console.log(first >= 0 ? `DIFFÉRENTS : premier octet différent à l'offset ${first}` : `DIFFÉRENTS : tailles ${x.length} / ${y.length} (préfixe commun)`); process.exit(1);
