// scripts/gen-vote-format-matrix.ts — écrit docs/MATRICE_VALIDATEUR_X_FORMAT_2026_10_28.md (le tableau est GÉNÉRÉ depuis le code des sketchs : tests/voteFormatMatrix.test.ts le compare au fichier).
// Usage : node --import tsx scripts/gen-vote-format-matrix.ts
import fs from "node:fs";
import path from "node:path";
import { renderMatrix, verifyFamilies } from "../tests/helpers/voteFormatMatrix";

const bad = verifyFamilies();
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
const out = [
  "# Matrice « famille de firmware × format du candidat » (28/10/2026, générée)",
  "",
  "> Règle produit : toute carte qui embarque le moteur de vote relit et recalcule TOUS les formats, quel que soit son écran. Ce tableau est **déduit du code des sketchs** par `tests/helpers/voteFormatMatrix.ts` (jamais écrit à la main) et comparé au fichier par `tests/voteFormatMatrix.test.ts`. Régénérer : `node --import tsx scripts/gen-vote-format-matrix.ts`.",
  "",
  "**Niveau de preuve : `C`** (le chemin de vote compilé peut relire le format : le tampon exigé est couvert) + **`H`** (flux et métriques de CHAQUE format égaux à la référence TypeScript sur l'hôte, `tests/podMetrics.test.ts`). **Aucun `M` ni `V2` ici** : « oui » ne dit ni que la mémoire d'une carte réelle suffit pendant un TLS, ni qu'un vote croisé a été observé. Le vote croisé observé sur carte reste à produire (protocole d'essai du plan).",
  "",
  "Tampon exigé par le format : OLED 1 024 o, e-ink 2,9″ BWR 4 736 o, e-ink 2,7″ / TFT 1,8″ / TFT 2,8″ aucun.",
  "",
  "<!-- MATRIX:BEGIN -->",
  renderMatrix(),
  "<!-- MATRIX:END -->",
  "",
  "Lecture : une famille « au tas » prend 1 024 o ou 4 736 o le temps de la lecture ; un échec d'allocation est une **abstention explicite** (`memoire`), jamais un refus signé. Les profils capteurs seuls ne figurent pas : ils sont exclus du quorum aujourd'hui (capacité de validation explicite : `lib/voteCapability.ts`, aucune famille autorisée).",
  "",
].join("\n");
fs.writeFileSync(path.join(__dirname, "..", "docs", "MATRICE_VALIDATEUR_X_FORMAT_2026_10_28.md"), out);
console.log("écrit");
