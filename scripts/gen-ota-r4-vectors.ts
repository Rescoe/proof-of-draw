// scripts/gen-ota-r4-vectors.ts — consensus-pod/test-vectors/ota-r4-vectors.txt (déterministe : signatures Ed25519 déterministes, graines de TEST dérivées d'un libellé). node --import tsx scripts/gen-ota-r4-vectors.ts
import fs from "node:fs"; import path from "node:path";
import { buildOtaR4Vectors } from "../tests/helpers/otaR4Vectors";
const out = path.join(__dirname, "..", "consensus-pod", "test-vectors", "ota-r4-vectors.txt"); const { txt, lines } = buildOtaR4Vectors();
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, txt); console.log(`écrit ${out} : ${lines} lignes`);
