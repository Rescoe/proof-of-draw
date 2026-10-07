// scripts/gen-anim-selftest.ts — GÉNÈRE consensus-pod/src/podAnimV3_selftest.h (clips + valeurs attendues de l'auto-test embarqué du lot 6C) depuis la référence TypeScript (lib/animV3.ts).
// Usage : node --import tsx scripts/gen-anim-selftest.ts — déterministe ; tests/animSelfTest.test.ts exige que le fichier commité soit identique à cette sortie.
import fs from "node:fs";
import path from "node:path";
import { buildSelfTestHeader } from "../tests/helpers/animSelfTestHeader";

const out = path.join(__dirname, "..", "consensus-pod", "src", "podAnimV3_selftest.h");
const text = buildSelfTestHeader();
fs.writeFileSync(out, text);
console.log(`écrit ${out} (${text.length} caractères)`);
