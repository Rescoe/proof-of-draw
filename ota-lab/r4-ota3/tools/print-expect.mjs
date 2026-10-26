// print-expect.mjs <cases.json> — imprime les deux commandes « e » à coller dans le moniteur (aller vers B, retour vers A).
import { readFileSync } from "node:fs";
const m = JSON.parse(readFileSync(process.argv[2], "utf8"));
console.log();
console.log(`À COLLER dans le moniteur (aller, vers B)  : e ${m.imageB.sha256} ${m.imageB.bytes}`);
if (m.imageA) console.log(`À COLLER dans le moniteur (retour, vers A) : e ${m.imageA.sha256} ${m.imageA.bytes}`);
