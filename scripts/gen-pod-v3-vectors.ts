// scripts/gen-pod-v3-vectors.ts — régénère tests/fixtures/pod-v3-vectors.json (vecteurs d'or du protocole v3, BROUILLON).
// Usage : node --import tsx scripts/gen-pod-v3-vectors.ts
// À ne relancer QUE pour un changement de protocole décidé et versionné : tests/podProtocolV3.test.ts échoue sinon (le fichier commité est la référence).
import fs from "node:fs";
import path from "node:path";
import { buildVectors } from "../tests/helpers/podV3Vectors";

const out = path.join(__dirname, "..", "tests", "fixtures", "pod-v3-vectors.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(buildVectors(), null, 2) + "\n");
console.log("écrit", out);
