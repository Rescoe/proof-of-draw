// make-manifest.mjs --bin <fichier.bin> --seq N --firmware r4tft28-2.6 [--channel canary] [--notbefore 0] [--key r4-a] [--keys-dir artifacts/keys] [--out artifacts/release]
// Produit <out>/manifest.txt (manifeste R4 signé, format canonique) et <out>/firmware.bin (copie du binaire BRUT). Aucun .ota, aucune compression. Clés de TEST seulement.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { signR4Manifest, sha256Hex, R4_MAX_SIZE } from "../../../lib/otaManifestR4.ts";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const bin = arg("--bin"); if (!bin || !existsSync(bin)) { console.error("usage : make-manifest.mjs --bin <fichier.bin> --seq N --firmware <r4tft28-X.Y> [--channel canary] [--notbefore 0] [--key r4-a] [--keys-dir D] [--out D]"); process.exit(2); }
const key = arg("--key", "r4-a"), keysDir = arg("--keys-dir", join(ROOT, "artifacts", "keys")), out = arg("--out", join(ROOT, "artifacts", "release"));
const data = readFileSync(bin); if (data.length < 1 || data.length > R4_MAX_SIZE) { console.error(`taille ${data.length} hors de 1..${R4_MAX_SIZE}`); process.exit(1); }
const seedFile = join(keysDir, key + ".seed"); if (!existsSync(seedFile)) { console.error(`graine absente : ${seedFile} (lancer keygen.mjs)`); process.exit(1); }
const m = { family: arg("--family", "uno-r4-wifi-tft28"), firmware: arg("--firmware", "r4tft28-2.6"), seq: Number(arg("--seq", "1")), channel: arg("--channel", "canary"), size: data.length, sha256: sha256Hex(data), notbefore: Number(arg("--notbefore", "0")), keyid: key };
const text = signR4Manifest(m, readFileSync(seedFile, "utf8").trim()); mkdirSync(out, { recursive: true });
writeFileSync(join(out, "manifest.txt"), text); copyFileSync(bin, join(out, "firmware.bin"));
console.log(`manifeste écrit : ${join(out, "manifest.txt")} (${text.length} o)  seq=${m.seq} size=${m.size} sha256=${m.sha256.slice(0, 16)}… keyid=${key}`);
