// scripts/gen-consensus-pod-vectors.ts — VECTEURS du noyau C++ consensusPoD.h, produits par la RÉFÉRENCE TypeScript (lib/podProtocolV3.ts).
// Écrit : consensus-pod/test-vectors/vectors.txt (une ligne = une vérification, jetons séparés par des espaces) et consensus-pod/src/consensusPoD_selftest.h (jeu minimal pour les sketches).
// Usage : node --import tsx scripts/gen-consensus-pod-vectors.ts   — déterministe ; tests/consensusPodCore.test.ts exige que les fichiers commités soient identiques à cette sortie
// et que host/core_harness.cpp (le NOYAU C++ compilé avec g++) retrouve CHAQUE valeur à l'octet près.
import fs from "node:fs";
import path from "node:path";
import { buildConsensusVectors } from "../tests/helpers/consensusPodVectors";

const root = path.join(__dirname, "..", "consensus-pod");
const { vectorsTxt, selftestH } = buildConsensusVectors();
fs.mkdirSync(path.join(root, "test-vectors"), { recursive: true });
fs.writeFileSync(path.join(root, "test-vectors", "vectors.txt"), vectorsTxt);
fs.writeFileSync(path.join(root, "src", "consensusPoD_selftest.h"), selftestH);
console.log("écrit", path.join(root, "test-vectors", "vectors.txt"), "et consensusPoD_selftest.h");
