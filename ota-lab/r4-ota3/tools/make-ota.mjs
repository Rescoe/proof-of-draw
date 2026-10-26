// make-ota.mjs --b <build-B.bin> [--a <build-A.bin>] [--out artifacts/serve]
// Fabrique les fichiers .ota de laboratoire à partir du binaire de la sonde (build « B ») : good, badcrc, badpayload, badmagic, trunc, lenlie, sigbit, pad200, pad400,
// et to-a.ota (retour à la build « A » si --a est donné). Écrit aussi cases.json (attendus + SHA-256 du binaire décodé). Aucune clé, aucune signature : le format n'en a pas.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { makeCases, buildOta, lzssEncodeLiterals, sha256 } from "./ota-format.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
export function writeCases({ bBin, aBin, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const cases = makeCases(bBin); const index = {};
  for (const [name, c] of Object.entries(cases)) { writeFileSync(join(outDir, name + ".ota"), c.file); index[name] = { bytes: c.file.length, sha256File: sha256(c.file), expect: c.expect }; }
  if (aBin) { const f = buildOta(lzssEncodeLiterals(aBin)); writeFileSync(join(outDir, "to-a.ota"), f); index["to-a"] = { bytes: f.length, sha256File: sha256(f), expect: { download: "decoded-size", verify: 0, flashable: true, note: "retour à la build A" } }; }
  const meta = { imageB: { bytes: bBin.length, sha256: sha256(bBin) }, imageA: aBin ? { bytes: aBin.length, sha256: sha256(aBin) } : null, cases: index };
  writeFileSync(join(outDir, "cases.json"), JSON.stringify(meta, null, 2));
  return meta;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const b = arg("--b"); if (!b) { console.error("usage : make-ota.mjs --b <B.bin> [--a <A.bin>] [--out dir]"); process.exit(2); }
  const meta = writeCases({ bBin: readFileSync(b), aBin: arg("--a") ? readFileSync(arg("--a")) : undefined, outDir: arg("--out") ?? join(ROOT, "artifacts", "serve") });
  console.log(`image B : ${meta.imageB.bytes} o, SHA-256 ${meta.imageB.sha256}`); if (meta.imageA) console.log(`image A : ${meta.imageA.bytes} o, SHA-256 ${meta.imageA.sha256}`);
  for (const [n, c] of Object.entries(meta.cases)) console.log(`${n.padEnd(11)} ${String(c.bytes).padStart(8)} o  verify attendu : ${c.expect.verify}  — ${c.expect.note}`);
}
