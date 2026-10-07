// scripts/gen-anim-v3-vectors.ts — VECTEURS du noyau C++ « pod-anim-v3 » (consensus-pod/src/podAnimV3.h), produits par la RÉFÉRENCE TypeScript (lib/animV3.ts).
// Écrit : consensus-pod/test-vectors/anim-vectors.txt (une ligne = une vérification). Usage : node --import tsx scripts/gen-anim-v3-vectors.ts — déterministe ;
// tests/animV3Core.test.ts exige que le fichier commité soit identique à cette sortie et que host/anim_harness.cpp (le NOYAU C++ compilé avec g++) retrouve CHAQUE valeur.
import fs from "node:fs";
import path from "node:path";
import { buildAnimVectors } from "../tests/helpers/animV3Vectors";

const out = path.join(__dirname, "..", "consensus-pod", "test-vectors", "anim-vectors.txt");
const { vectorsTxt, clips, lines } = buildAnimVectors();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, vectorsTxt);
console.log(`écrit ${out} : ${lines} lignes dont ${clips.length} clips`);
