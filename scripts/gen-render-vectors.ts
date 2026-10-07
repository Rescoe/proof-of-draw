// scripts/gen-render-vectors.ts — VECTEURS D'OR du rasteriseur de rendu (lot 8A) : consensus-pod/test-vectors/render-vectors.txt, produits par lib/renderLayout.ts.
// Usage : node --import tsx scripts/gen-render-vectors.ts — déterministe ; tests/renderCore.test.ts exige que le fichier commité soit identique à cette sortie
// et que le port C++ (consensus-pod/host/render_harness.cpp) retrouve CHAQUE valeur.
import fs from "node:fs";
import path from "node:path";
import { buildRenderVectors } from "../tests/helpers/renderVectors";

const out = path.join(__dirname, "..", "consensus-pod", "test-vectors", "render-vectors.txt");
const { vectorsTxt, lines } = buildRenderVectors();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, vectorsTxt);
console.log(`écrit ${out} : ${lines} lignes`);
